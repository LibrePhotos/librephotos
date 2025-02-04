import json
import numbers
import os
from fractions import Fraction
from io import BytesIO

import numpy as np
import PIL
import requests
from django.contrib.postgres.fields import ArrayField
from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Q
from django.db.utils import IntegrityError

import api.models
from api import date_time_extractor, face_extractor, util
from api.exif_tags import Tags
from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.image_captioning import generate_caption
from api.llm import generate_prompt
from api.models.file import File
from api.models.user import User, get_deleted_user
from api.thumbnails import (
    createAnimatedThumbnail,
    createThumbnail,
    createThumbnailForVideo,
    doesStaticThumbnailExists,
    doesVideoThumbnailExists,
)
from api.util import get_metadata, logger


class VisiblePhotoManager(models.Manager):
    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(
                Q(hidden=False) & Q(aspect_ratio__isnull=False) & Q(in_trashcan=False)
            )
        )


class Photo(models.Model):
    image_hash = models.CharField(primary_key=True, max_length=64, null=False)
    files = models.ManyToManyField(File)
    main_file = models.ForeignKey(
        File,
        related_name="main_photo",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )
    thumbnail_big = models.ImageField(upload_to="thumbnails_big")
    square_thumbnail = models.ImageField(upload_to="square_thumbnails")
    square_thumbnail_small = models.ImageField(upload_to="square_thumbnails_small")

    aspect_ratio = models.FloatField(blank=True, null=True)

    added_on = models.DateTimeField(null=False, blank=False, db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)

    exif_json = models.JSONField(blank=True, null=True)

    geolocation_json = models.JSONField(blank=True, null=True, db_index=True)
    captions_json = models.JSONField(blank=True, null=True, db_index=True)

    dominant_color = models.TextField(blank=True, null=True)

    search_captions = models.TextField(blank=True, null=True, db_index=True)
    search_location = models.TextField(blank=True, null=True, db_index=True)

    timestamp = models.DateTimeField(blank=True, null=True, db_index=True)
    rating = models.IntegerField(default=0, db_index=True)
    in_trashcan = models.BooleanField(default=False, db_index=True)
    removed = models.BooleanField(default=False, db_index=True)
    hidden = models.BooleanField(default=False, db_index=True)
    video = models.BooleanField(default=False)
    video_length = models.TextField(blank=True, null=True)
    size = models.BigIntegerField(default=0)
    fstop = models.FloatField(blank=True, null=True)
    focal_length = models.FloatField(blank=True, null=True)
    iso = models.IntegerField(blank=True, null=True)
    shutter_speed = models.TextField(blank=True, null=True)
    camera = models.TextField(blank=True, null=True)
    lens = models.TextField(blank=True, null=True)
    width = models.IntegerField(default=0)
    height = models.IntegerField(default=0)
    focalLength35Equivalent = models.IntegerField(blank=True, null=True)
    subjectDistance = models.FloatField(blank=True, null=True)
    digitalZoomRatio = models.FloatField(blank=True, null=True)

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="photo_shared_to")

    public = models.BooleanField(default=False, db_index=True)
    clip_embeddings = ArrayField(
        models.FloatField(blank=True, null=True), size=512, null=True
    )
    clip_embeddings_magnitude = models.FloatField(blank=True, null=True)
    last_modified = models.DateTimeField(auto_now=True)

    objects = models.Manager()
    visible = VisiblePhotoManager()

    _loaded_values = {}

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)

        # save original values, when model is loaded from database,
        # in a separate attribute on the model
        instance._loaded_values = dict(zip(field_names, values))

        return instance

    def save(
        self,
        force_insert=False,
        force_update=False,
        using=None,
        update_fields=None,
        save_metadata=True,
    ):
        modified_fields = [
            field_name
            for field_name, value in self._loaded_values.items()
            if value != getattr(self, field_name)
        ]
        user = User.objects.get(username=self.owner)
        if save_metadata and user.save_metadata_to_disk != User.SaveMetadata.OFF:
            self._save_metadata(
                modified_fields,
                user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE,
            )
        return super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )

    def _save_metadata(self, modified_fields=None, use_sidecar=True):
        tags_to_write = {}
        if modified_fields is None or "rating" in modified_fields:
            tags_to_write[Tags.RATING] = self.rating
        if "timestamp" in modified_fields:
            # To-Do: Only works for files and not for the sidecar file
            tags_to_write[Tags.DATE_TIME] = self.timestamp
        if tags_to_write:
            util.write_metadata(
                self.main_file.path, tags_to_write, use_sidecar=use_sidecar
            )

    def _generate_captions_im2txt(self, commit=True):
        image_path = self.thumbnail_big.path
        captions = self.captions_json
        try:
            from constance import config as site_config

            if site_config.CAPTIONING_MODEL == "None":
                util.logger.info("Generating captions is disabled")
                return False
            onnx = False
            if site_config.CAPTIONING_MODEL == "im2txt_onnx":
                onnx = True
            blip = False
            if site_config.CAPTIONING_MODEL == "blip_base_capfilt_large":
                blip = True

            caption = generate_caption(image_path=image_path, blip=blip, onnx=onnx)
            caption = caption.replace("<start>", "").replace("<end>", "").strip()
            settings = User.objects.get(username=self.owner).llm_settings
            if site_config.LLM_MODEL != "None" and settings["enabled"]:
                face = api.models.Face.objects.filter(photo=self).first()
                person_name = ""
                if face and settings["add_person"]:
                    person_name = " Person: " + face.person.name
                place = ""
                if self.search_location and settings["add_location"]:
                    place = " Place: " + self.search_location
                keywords = ""
                if settings["add_keywords"]:
                    keywords = " and tags or keywords"
                prompt = (
                    "Q: Your task is to improve the following image caption: "
                    + caption
                    + ". You also know the following information about the image:"
                    + place
                    + person_name
                    + ". Stick as closely as possible to the caption, while replacing generic information with information you know about the image. Only output the caption"
                    + keywords
                    + ". \n A:"
                )
                util.logger.info(prompt)
                caption = generate_prompt(prompt)

            captions["im2txt"] = caption
            self.captions_json = captions
            self._recreate_search_captions()
            if commit:
                self.save()
            util.logger.info(
                "generated im2txt captions for image %s with SiteConfig %s with Blip: %s and Onnx: %s caption: %s"
                % (image_path, site_config.CAPTIONING_MODEL, blip, onnx, caption)
            )
            return True
        except Exception:
            util.logger.exception(
                "could not generate im2txt captions for image %s" % image_path
            )
            return False

    def _save_captions(self, commit=True, caption=None):
        image_path = self.thumbnail_big.path
        try:
            caption = caption.replace("<start>", "").replace("<end>", "").strip()
            self.captions_json["user_caption"] = caption
            self._recreate_search_captions()
            if commit:
                self.save(update_fields=["captions_json", "search_captions"])

            util.logger.info(
                "saved captions for image %s. caption: %s. captions_json: %s."
                % (image_path, caption, self.captions_json)
            )

            hashtags = [
                word
                for word in caption.split()
                if word.startswith("#") and len(word) > 1
            ]

            for hashtag in hashtags:
                album_thing = api.models.album_thing.get_album_thing(
                    title=hashtag, owner=self.owner, thing_type="hashtag_attribute"
                )
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.save()

            for album_thing in api.models.album_thing.AlbumThing.objects.filter(
                Q(photos__in=[self.image_hash])
                & Q(thing_type="hashtag_attribute")
                & Q(owner=self.owner)
            ).all():
                if album_thing.title not in caption:
                    album_thing.photos.remove(self)
                    album_thing.save()
            return True
        except Exception:
            util.logger.exception("could not save captions for image %s" % image_path)
            return False

    def _recreate_search_captions(self):
        search_captions = ""

        if self.captions_json:
            places365_captions = self.captions_json.get("places365", {})

            attributes = places365_captions.get("attributes", [])
            search_captions += " ".join(attributes) + " "

            categories = places365_captions.get("categories", [])
            search_captions += " ".join(categories) + " "

            environment = places365_captions.get("environment", "")
            search_captions += environment + " "

            user_caption = self.captions_json.get("user_caption", "")
            search_captions += user_caption + " "

        for face in api.models.face.Face.objects.filter(photo=self).all():
            if face.person:
                search_captions += face.person.name + " "

        for file in self.files.all():
            search_captions += file.path + " "

        if self.video:
            search_captions += "type: video "

        if self.camera:
            search_captions += self.camera + " "

        if self.lens:
            search_captions += self.lens + " "

        self.search_captions = search_captions.strip()  # Remove trailing space
        util.logger.debug(
            "Recreated search captions for image %s." % (self.thumbnail_big.path)
        )
        self.save()

    def _generate_captions(self, commit):
        if (
            self.captions_json is not None
            and self.captions_json.get("places365") is not None
            or self.thumbnail_big.name is None
        ):
            return

        try:
            image_path = self.thumbnail_big.path
            confidence = self.owner.confidence
            json = {
                "image_path": image_path,
                "confidence": confidence,
            }
            res_places365 = requests.post(
                "http://localhost:8011/generate-tags", json=json
            ).json()["tags"]

            if res_places365 is None:
                return
            if self.captions_json is None:
                self.captions_json = {}

            self.captions_json["places365"] = res_places365
            self._recreate_search_captions()

            for album_thing in api.models.album_thing.AlbumThing.objects.filter(
                Q(photos__in=[self.image_hash])
                & (
                    Q(thing_type="places365_attribute")
                    or Q(thing_type="places365_category")
                )
                & Q(owner=self.owner)
            ).all():
                album_thing.photos.remove(self)
                album_thing.save()

            if "attributes" in res_places365:
                for attribute in res_places365["attributes"]:
                    album_thing = api.models.album_thing.get_album_thing(
                        title=attribute,
                        owner=self.owner,
                        thing_type="places365_attribute",
                    )
                    album_thing.photos.add(self)
                    album_thing.save()

            if "categories" in res_places365:
                for category in res_places365["categories"]:
                    album_thing = api.models.album_thing.get_album_thing(
                        title=category,
                        owner=self.owner,
                        thing_type="places365_category",
                    )
                    album_thing.photos.add(self)
                    album_thing.save()

            if commit:
                self.save()
            util.logger.info(
                "generated places365 captions for image %s." % (image_path)
            )
        except Exception as e:
            util.logger.exception(
                "could not generate captions for image %s" % image_path
            )
            raise e

    def _generate_thumbnail(self, commit=True):
        try:
            if not doesStaticThumbnailExists("thumbnails_big", self.image_hash):
                if not self.video:
                    createThumbnail(
                        inputPath=self.main_file.path,
                        outputHeight=1080,
                        outputPath="thumbnails_big",
                        hash=self.image_hash,
                        fileType=".webp",
                    )
                else:
                    createThumbnailForVideo(
                        inputPath=self.main_file.path,
                        outputPath="thumbnails_big",
                        hash=self.image_hash,
                        fileType=".webp",
                    )

            if not self.video and not doesStaticThumbnailExists(
                "square_thumbnails", self.image_hash
            ):
                createThumbnail(
                    inputPath=self.main_file.path,
                    outputHeight=500,
                    outputPath="square_thumbnails",
                    hash=self.image_hash,
                    fileType=".webp",
                )
            if self.video and not doesVideoThumbnailExists(
                "square_thumbnails", self.image_hash
            ):
                createAnimatedThumbnail(
                    inputPath=self.main_file.path,
                    outputHeight=500,
                    outputPath="square_thumbnails",
                    hash=self.image_hash,
                    fileType=".mp4",
                )

            if not self.video and not doesStaticThumbnailExists(
                "square_thumbnails_small", self.image_hash
            ):
                createThumbnail(
                    inputPath=self.main_file.path,
                    outputHeight=250,
                    outputPath="square_thumbnails_small",
                    hash=self.image_hash,
                    fileType=".webp",
                )
            if self.video and not doesVideoThumbnailExists(
                "square_thumbnails_small", self.image_hash
            ):
                createAnimatedThumbnail(
                    inputPath=self.main_file.path,
                    outputHeight=250,
                    outputPath="square_thumbnails_small",
                    hash=self.image_hash,
                    fileType=".mp4",
                )
            filetype = ".webp"
            if self.video:
                filetype = ".mp4"
            self.thumbnail_big.name = os.path.join(
                "thumbnails_big", self.image_hash + ".webp"
            ).strip()
            self.square_thumbnail.name = os.path.join(
                "square_thumbnails", self.image_hash + filetype
            ).strip()
            self.square_thumbnail_small.name = os.path.join(
                "square_thumbnails_small", self.image_hash + filetype
            ).strip()
            if commit:
                self.save()
        except Exception as e:
            util.logger.exception(
                "could not generate thumbnail for image %s" % self.main_file.path
            )
            raise e

    def _find_album_place(self):
        return api.models.album_place.AlbumPlace.objects.filter(
            Q(photos__in=[self])
        ).all()

    def _find_album_date(self):
        old_album_date = None
        if self.exif_timestamp:
            possible_old_album_date = api.models.album_date.get_album_date(
                date=self.exif_timestamp.date(), owner=self.owner
            )
            if (
                possible_old_album_date is not None
                and possible_old_album_date.photos.filter(
                    image_hash=self.image_hash
                ).exists
            ):
                old_album_date = possible_old_album_date
        else:
            possible_old_album_date = api.models.album_date.get_album_date(
                date=None, owner=self.owner
            )
            if (
                possible_old_album_date is not None
                and possible_old_album_date.photos.filter(
                    image_hash=self.image_hash
                ).exists
            ):
                old_album_date = possible_old_album_date
        return old_album_date

    def _calculate_aspect_ratio(self, commit=True):
        try:
            # Relies on big thumbnail for correct aspect ratio, which is weird
            height, width = get_metadata(
                self.thumbnail_big.path,
                tags=[Tags.IMAGE_HEIGHT, Tags.IMAGE_WIDTH],
                try_sidecar=False,
            )
            self.aspect_ratio = round(width / height, 2)

            if commit:
                self.save()
        except Exception as e:
            util.logger.exception(
                "could not calculate aspect ratio for image %s"
                % self.thumbnail_big.path
            )
            raise e

    def _extract_date_time_from_exif(self, commit=True):
        def exif_getter(tags):
            return get_metadata(self.main_file.path, tags=tags, try_sidecar=True)

        datetime_config = json.loads(self.owner.datetime_rules)
        extracted_local_time = date_time_extractor.extract_local_date_time(
            self.main_file.path,
            date_time_extractor.as_rules(datetime_config),
            exif_getter,
            self.exif_gps_lat,
            self.exif_gps_lon,
            self.owner.default_timezone,
            self.timestamp,
        )

        old_album_date = self._find_album_date()
        if self.exif_timestamp != extracted_local_time:
            self.exif_timestamp = extracted_local_time

        if old_album_date is not None:
            old_album_date.photos.remove(self)
            old_album_date.save()

        album_date = None

        if self.exif_timestamp:
            album_date = api.models.album_date.get_or_create_album_date(
                date=self.exif_timestamp.date(), owner=self.owner
            )
            album_date.photos.add(self)
        else:
            album_date = api.models.album_date.get_or_create_album_date(
                date=None, owner=self.owner
            )
            album_date.photos.add(self)

        if commit:
            self.save()
        album_date.save()

    def _geolocate(self, commit=True):
        old_gps_lat = self.exif_gps_lat
        old_gps_lon = self.exif_gps_lon
        new_gps_lat, new_gps_lon = get_metadata(
            self.main_file.path,
            tags=[Tags.LATITUDE, Tags.LONGITUDE],
            try_sidecar=True,
        )
        old_album_places = self._find_album_place()
        # Skip if it hasn't changed or is null
        if not new_gps_lat or not new_gps_lon:
            return
        if (
            old_gps_lat == float(new_gps_lat)
            and old_gps_lon == float(new_gps_lon)
            and old_album_places.count() != 0
            and self.geolocation_json
            and "_v" in self.geolocation_json
            and self.geolocation_json["_v"] == GEOCODE_VERSION
        ):
            return
        self.exif_gps_lon = float(new_gps_lon)
        self.exif_gps_lat = float(new_gps_lat)
        if commit:
            self.save()
        try:
            res = reverse_geocode(new_gps_lat, new_gps_lon)
            if not res:
                return
        except Exception as e:
            util.logger.warning(e)
            util.logger.warning("Something went wrong with geolocating")
            return

        self.geolocation_json = res
        self.search_location = res["address"]

        # Delete photo from album places if location has changed
        if old_album_places is not None:
            for old_album_place in old_album_places:
                old_album_place.photos.remove(self)
                old_album_place.save()

        # Add photo to new album places
        for geolocation_level, feature in enumerate(self.geolocation_json["features"]):
            if "text" not in feature.keys() or feature["text"].isnumeric():
                continue
            album_place = api.models.album_place.get_album_place(
                feature["text"], owner=self.owner
            )
            if album_place.photos.filter(image_hash=self.image_hash).count() == 0:
                album_place.geolocation_level = (
                    len(self.geolocation_json["features"]) - geolocation_level
                )
            album_place.photos.add(self)
            album_place.save()

        if commit:
            self.save()

    def _add_location_to_album_dates(self):
        if not self.geolocation_json:
            return
        if len(self.geolocation_json["places"]) < 2:
            logger.info(self.geolocation_json)
            return

        album_date = self._find_album_date()
        city_name = self.geolocation_json["places"][-2]
        if album_date.location and len(album_date.location) > 0:
            prev_value = album_date.location
            new_value = prev_value
            if city_name not in prev_value["places"]:
                new_value["places"].append(city_name)
                new_value["places"] = list(set(new_value["places"]))
                album_date.location = new_value
        else:
            album_date.location = {"places": [city_name]}
        # Safe geolocation_json
        album_date.save()

    def _extract_exif_data(self, commit=True):
        (
            size,
            fstop,
            focal_length,
            iso,
            shutter_speed,
            camera,
            lens,
            width,
            height,
            focalLength35Equivalent,
            subjectDistance,
            digitalZoomRatio,
            video_length,
            rating,
        ) = get_metadata(  # noqa: E501
            self.main_file.path,
            tags=[
                Tags.FILE_SIZE,
                Tags.FSTOP,
                Tags.FOCAL_LENGTH,
                Tags.ISO,
                Tags.EXPOSURE_TIME,
                Tags.CAMERA,
                Tags.LENS,
                Tags.IMAGE_WIDTH,
                Tags.IMAGE_HEIGHT,
                Tags.FOCAL_LENGTH_35MM,
                Tags.SUBJECT_DISTANCE,
                Tags.DIGITAL_ZOOM_RATIO,
                Tags.QUICKTIME_DURATION,
                Tags.RATING,
            ],
            try_sidecar=True,
        )
        if size and isinstance(size, numbers.Number):
            self.size = size
        if fstop and isinstance(fstop, numbers.Number):
            self.fstop = fstop
        if focal_length and isinstance(focal_length, numbers.Number):
            self.focal_length = focal_length
        if iso and isinstance(iso, numbers.Number):
            self.iso = iso
        if shutter_speed and isinstance(shutter_speed, numbers.Number):
            self.shutter_speed = str(Fraction(shutter_speed).limit_denominator(1000))
        if camera and isinstance(camera, str):
            self.camera = camera
        if lens and isinstance(lens, str):
            self.lens = lens
        if width and isinstance(width, numbers.Number):
            self.width = width
        if height and isinstance(height, numbers.Number):
            self.height = height
        if focalLength35Equivalent and isinstance(
            focalLength35Equivalent, numbers.Number
        ):
            self.focalLength35Equivalent = focalLength35Equivalent
        if subjectDistance and isinstance(subjectDistance, numbers.Number):
            self.subjectDistance = subjectDistance
        if digitalZoomRatio and isinstance(digitalZoomRatio, numbers.Number):
            self.digitalZoomRatio = digitalZoomRatio
        if video_length and isinstance(video_length, numbers.Number):
            self.video_length = video_length
        if rating and isinstance(rating, numbers.Number):
            self.rating = rating

        if commit:
            self.save()

    def _extract_faces(self, second_try=False):
        unknown_cluster: api.models.cluster.Cluster = (
            api.models.cluster.get_unknown_cluster(user=self.owner)
        )
        try:
            big_thumbnail_image = np.array(PIL.Image.open(self.thumbnail_big.path))

            face_locations = face_extractor.extract(
                self.main_file.path, self.thumbnail_big.path, self.owner
            )

            if len(face_locations) == 0:
                return

            for idx_face, face_location in enumerate(face_locations):
                top, right, bottom, left, person_name = face_location
                if person_name:
                    person = api.models.person.get_or_create_person(
                        name=person_name, owner=self.owner
                    )
                    person.save()
                else:
                    person = None

                face_image = big_thumbnail_image[top:bottom, left:right]
                face_image = PIL.Image.fromarray(face_image)

                image_path = self.image_hash + "_" + str(idx_face) + ".jpg"

                margin = int((right - left) * 0.05)
                existing_faces = api.models.face.Face.objects.filter(
                    photo=self,
                    location_top__lte=top + margin,
                    location_top__gte=top - margin,
                    location_right__lte=right + margin,
                    location_right__gte=right - margin,
                    location_bottom__lte=bottom + margin,
                    location_bottom__gte=bottom - margin,
                    location_left__lte=left + margin,
                    location_left__gte=left - margin,
                )

                if existing_faces.count() != 0:
                    continue

                face = api.models.face.Face(
                    photo=self,
                    location_top=top,
                    location_right=right,
                    location_bottom=bottom,
                    location_left=left,
                    encoding="",
                    person=person,
                    cluster=unknown_cluster,
                )
                if person_name:
                    person._calculate_face_count()
                    person._set_default_cover_photo()
                face_io = BytesIO()
                face_image.save(face_io, format="JPEG")
                face.image.save(image_path, ContentFile(face_io.getvalue()))
                face_io.close()
                face.save()
            logger.info(f"image {self.image_hash}: {len(face_locations)} face(s) saved")
        except IntegrityError:
            # When using multiple processes, then we can save at the same time, which leads to this error
            if self.files.count() > 0:
                # print out the location of the image only if we have a path
                logger.info(f"image {self.main_file.path}: rescan face failed")
            if not second_try:
                self._extract_faces(True)
            elif self.files.count() > 0:
                logger.error(f"image {self.main_file.path}: rescan face failed")
            else:
                logger.error(f"image {self}: rescan face failed")
        except Exception as e:
            logger.error(f"image {self}: scan face failed")
            raise e

    def _add_to_album_thing(self):
        if (
            type(self.captions_json) is dict
            and "places365" in self.captions_json.keys()
        ):
            for attribute in self.captions_json["places365"]["attributes"]:
                album_thing = api.models.album_thing.get_album_thing(
                    title=attribute,
                    owner=self.owner,
                )
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.thing_type = "places365_attribute"
                    album_thing.save()
            for category in self.captions_json["places365"]["categories"]:
                album_thing = api.models.album_thing.get_album_thing(
                    title=category,
                    owner=self.owner,
                )
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing = api.models.album_thing.get_album_thing(
                        title=category, owner=self.owner
                    )
                    album_thing.photos.add(self)
                    album_thing.thing_type = "places365_category"
                    album_thing.save()

    def _check_files(self):
        for file in self.files.all():
            if not file.path or not os.path.exists(file.path):
                self.files.remove(file)
                file.missing = True
                file.save()
        self.save()

    def _get_dominant_color(self, palette_size=16):
        # Skip if it's already calculated
        if self.dominant_color:
            return
        try:
            # Resize image to speed up processing
            img = PIL.Image.open(self.square_thumbnail_small.path)
            img.thumbnail((100, 100))

            # Reduce colors (uses k-means internally)
            paletted = img.convert("P", palette=PIL.Image.ADAPTIVE, colors=palette_size)

            # Find the color that occurs most often
            palette = paletted.getpalette()
            color_counts = sorted(paletted.getcolors(), reverse=True)
            palette_index = color_counts[0][1]
            dominant_color = palette[palette_index * 3 : palette_index * 3 + 3]
            self.dominant_color = dominant_color
            self.save()
        except Exception:
            logger.info(f"Cannot calculate dominant color {self} object")

    def manual_delete(self):
        for file in self.files.all():
            if os.path.isfile(file.path):
                logger.info(f"Removing photo {file.path}")
                os.remove(file.path)
                file.delete()
            self.files.set([])
            self.main_file = None
        self.removed = True
        # To-Do: Handle wrong file permissions
        return self.save()

    def delete_duplicate(self, duplicate_path):
        # To-Do: Handle wrong file permissions
        for file in self.files.all():
            if file.path == duplicate_path:
                if not os.path.isfile(duplicate_path):
                    logger.info(f"Path does not lead to a valid file: {duplicate_path}")
                    self.files.remove(file)
                    file.delete()
                    self.save()
                    return False
                logger.info(f"Removing photo {duplicate_path}")
                os.remove(duplicate_path)
                self.files.remove(file)
                self.save()
                file.delete()
                return True
        logger.info(f"Path is not valid: {duplicate_path}")
        return False

    def _set_embedded_media(self, obj):
        return obj.main_file.embedded_media

    def __str__(self):
        main_file_path = (
            self.main_file.path if self.main_file is not None else "No main file"
        )
        return f"{self.image_hash} - {self.owner} - {main_file_path}"
