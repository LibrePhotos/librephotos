import json
import numbers
import os
import uuid
from fractions import Fraction
from io import BytesIO

import numpy as np
import PIL
from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Q
from django.db.utils import IntegrityError

import api.models
from api import date_time_extractor, face_extractor, util
from api.exif_tags import Tags
from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.models.file import File
from api.models.user import User, get_deleted_user
from api.util import get_metadata, logger


class VisiblePhotoManager(models.Manager):
    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(
                Q(hidden=False)
                & Q(thumbnail__aspect_ratio__isnull=False)
                & Q(in_trashcan=False)
                & Q(removed=False)
            )
        )


class Photo(models.Model):
    # UUID primary key (like Immich) - enables flexible asset management
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Content hash for deduplication - unique per user
    # Format: MD5 hash + user_id (e.g., "abc123def456...789" + "1")
    image_hash = models.CharField(max_length=64, db_index=True)
    
    files = models.ManyToManyField(File)
    main_file = models.ForeignKey(
        File,
        related_name="main_photo",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )

    added_on = models.DateTimeField(null=False, blank=False, db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)

    exif_json = models.JSONField(blank=True, null=True)

    geolocation_json = models.JSONField(blank=True, null=True, db_index=True)

    timestamp = models.DateTimeField(blank=True, null=True, db_index=True)
    rating = models.IntegerField(default=0, db_index=True)
    in_trashcan = models.BooleanField(default=False, db_index=True)
    removed = models.BooleanField(default=False, db_index=True)
    hidden = models.BooleanField(default=False, db_index=True)
    video = models.BooleanField(default=False)
    video_length = models.TextField(blank=True, null=True)
    size = models.BigIntegerField(default=0)
    # Metadata fields (camera, lens, fstop, etc.) moved to PhotoMetadata model
    # See migration 0103_remove_photo_metadata_fields.py

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="photo_shared_to")

    public = models.BooleanField(default=False, db_index=True)

    # Use JSONField for database compatibility (works with both PostgreSQL and SQLite)
    clip_embeddings = models.JSONField(blank=True, null=True)

    clip_embeddings_magnitude = models.FloatField(blank=True, null=True)
    last_modified = models.DateTimeField(auto_now=True)

    # Perceptual hash for duplicate detection (pHash algorithm)
    perceptual_hash = models.CharField(max_length=64, blank=True, null=True, db_index=True)

    # Organizational photo stacks (RAW+JPEG pairs, bursts, brackets, live photos, manual)
    # A photo can belong to multiple stacks of different types simultaneously
    stacks = models.ManyToManyField(
        "PhotoStack",
        blank=True,
        related_name="photos",
    )

    # Duplicate groups (exact copies, visual duplicates)
    # Separate from stacks because duplicates are about cleanup, not organization
    duplicates = models.ManyToManyField(
        "Duplicate",
        blank=True,
        related_name="photos",
    )

    # Sub-second timestamp precision for burst detection
    # Stores the fractional seconds from EXIF:SubSecTimeOriginal
    exif_timestamp_subsec = models.CharField(max_length=10, blank=True, null=True)

    # Camera image sequence number (for burst/sequence detection)
    # From EXIF:ImageNumber or MakerNotes
    image_sequence_number = models.IntegerField(blank=True, null=True)

    objects = models.Manager()
    visible = VisiblePhotoManager()

    _loaded_values = {}

    def get_clip_embeddings(self):
        """Get clip embeddings as a list, regardless of storage format"""
        if not self.clip_embeddings:
            return None

        # Handle case where embeddings might be stored as JSON string
        if isinstance(self.clip_embeddings, str):
            try:
                import json

                return json.loads(self.clip_embeddings)
            except (json.JSONDecodeError, TypeError):
                return None

        return self.clip_embeddings

    def set_clip_embeddings(self, embeddings):
        """Set clip embeddings, automatically handling storage format"""
        self.clip_embeddings = embeddings if embeddings else None

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
                ).exists()
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
                ).exists()
            ):
                old_album_date = possible_old_album_date
        return old_album_date

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

        # Update search location through PhotoSearch model
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=self)
        search_instance.update_search_location(res)
        search_instance.save()

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


    def _extract_faces(self, second_try=False):
        unknown_cluster: api.models.cluster.Cluster = (
            api.models.cluster.get_unknown_cluster(user=self.owner)
        )
        try:
            big_thumbnail_image = np.array(
                PIL.Image.open(self.thumbnail.thumbnail_big.path)
            )

            face_locations = face_extractor.extract(
                self.main_file.path, self.thumbnail.thumbnail_big.path, self.owner
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
            hasattr(self, "caption_instance")
            and self.caption_instance
            and self.caption_instance.captions_json
            and type(self.caption_instance.captions_json) is dict
            and "places365" in self.caption_instance.captions_json.keys()
        ):
            for attribute in self.caption_instance.captions_json["places365"][
                "attributes"
            ]:
                album_thing = api.models.album_thing.get_album_thing(
                    title=attribute,
                    owner=self.owner,
                )
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.thing_type = "places365_attribute"
                    album_thing.save()
            for category in self.caption_instance.captions_json["places365"][
                "categories"
            ]:
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

    def manual_delete(self):
        # Store stack references before cleanup (ManyToMany)
        photo_stacks = list(self.stacks.all())
        
        # Store duplicate group references before cleanup (ManyToMany)
        photo_duplicates = list(self.duplicates.all())
        
        # Handle file cleanup - only delete files not shared with other Photos
        for file in self.files.all():
            # Check if this file is used by other Photos (via files M2M or as main_file)
            other_photos_using_file = (
                file.photo_set.exclude(pk=self.pk).exists() or
                file.main_photo.exclude(pk=self.pk).exists()
            )
            
            if other_photos_using_file:
                # File is shared - just unlink from this photo, don't delete
                logger.info(f"File {file.path} is shared with other photos, unlinking only")
                self.files.remove(file)
            else:
                # File is only used by this photo - safe to delete
                if os.path.isfile(file.path):
                    logger.info(f"Removing photo {file.path}")
                    os.remove(file.path)
                file.delete()
        
        self.files.set([])
        self.main_file = None
        self.removed = True
        
        # Clear all stack references from this photo (ManyToMany)
        self.stacks.clear()
        
        # Clear all duplicate group references from this photo (ManyToMany)
        self.duplicates.clear()
        
        result = self.save()
        
        # Clean up stacks if they're now empty or have only one photo left
        for photo_stack in photo_stacks:
            remaining_photos = photo_stack.photos.filter(removed=False).count()
            if remaining_photos <= 1:
                # If 0 or 1 photos left, delete the stack (no longer a valid grouping)
                logger.info(f"Deleting photo stack {photo_stack.id} - only {remaining_photos} photos remaining")
                # Unlink remaining photos from stack first
                for remaining_photo in photo_stack.photos.all():
                    remaining_photo.stacks.remove(photo_stack)
                photo_stack.delete()
        
        # Clean up duplicate groups if they're now empty or have only one photo left
        for duplicate in photo_duplicates:
            remaining_photos = duplicate.photos.filter(removed=False).count()
            if remaining_photos <= 1:
                # If 0 or 1 photos left, delete the duplicate group (no longer valid)
                logger.info(f"Deleting duplicate group {duplicate.id} - only {remaining_photos} photos remaining")
                # Unlink remaining photos from duplicate first
                for remaining_photo in duplicate.photos.all():
                    remaining_photo.duplicates.remove(duplicate)
                duplicate.delete()
        
        # To-Do: Handle wrong file permissions
        return result


    def _set_embedded_media(self, obj):
        return obj.main_file.embedded_media

    def __str__(self):
        main_file_path = (
            self.main_file.path if self.main_file is not None else "No main file"
        )
        return f"{self.image_hash} - {self.owner} - {main_file_path}"
