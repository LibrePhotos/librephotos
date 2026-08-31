import json
import os
import uuid
from io import BytesIO

import numpy as np
import PIL
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Q
from django.db.utils import IntegrityError

import api.models
from api import date_time_extractor, face_extractor, transcode_cache, util
from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.metadata.writer import write_metadata
from api.models.file import File
from api.models.user import User, get_deleted_user
from api.util import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou, logger


_NO_PLACES365 = object()


def _overlaps_existing_face(existing_face_locations, top, right, bottom, left):
    """Return True if a new face region overlaps significantly with any
    existing face (IoU >= FACE_OVERLAP_IOU_THRESHOLD).

    *existing_face_locations* is an iterable of (top, right, bottom, left) tuples.
    """
    for ex_top, ex_right, ex_bottom, ex_left in existing_face_locations:
        iou = calculate_iou(
            top, right, bottom, left, ex_top, ex_right, ex_bottom, ex_left
        )
        if iou >= FACE_OVERLAP_IOU_THRESHOLD:
            return True
    return False


def _has_usable_coordinates(lat, lon):
    """Reject missing coordinates and the (0, 0) "null island" default that
    cameras write when there is no fix. A single zero axis (the equator or the
    prime meridian) is a valid location and must be kept.
    """
    if lat is None or lon is None:
        return False
    return not (float(lat) == 0.0 and float(lon) == 0.0)


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
    # Media category flags. ``category_source`` records who set them so a
    # rescan/backfill never clobbers a manual correction: "auto" (detector) or
    # "user" (manually corrected in the UI).
    is_screenshot = models.BooleanField(default=False, db_index=True)
    is_document = models.BooleanField(default=False, db_index=True)
    category_source = models.CharField(max_length=8, default="auto")
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
    perceptual_hash = models.CharField(
        max_length=64, blank=True, null=True, db_index=True
    )

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

    # User-controlled orientation override (EXIF Orientation code 1–8).
    # Stored as the *additional* rotation applied on top of whatever pyvips
    # auto-orientation produces from the file's own EXIF tag.  Defaults to 1
    # (identity – no extra rotation).  The value is updated by the rotate
    # endpoint and is applied when regenerating thumbnails.
    local_orientation = models.IntegerField(default=1)

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

    def _save_metadata(
        self, modified_fields=None, use_sidecar=True, metadata_types=None
    ):
        """Write metadata tags to the photo's file or sidecar.

        Args:
            modified_fields: List of changed field names (from Photo.save() diff).
                When None, writes all applicable tags unconditionally.
            use_sidecar: Write to XMP sidecar file if True, media file if False.
            metadata_types: List of metadata categories to write, e.g.
                ["ratings", "face_tags"]. When None, uses default behavior
                (ratings/timestamps only, for backward compatibility).
        """
        tags_to_write = {}

        write_ratings = metadata_types is None or "ratings" in metadata_types
        write_face_tags = metadata_types is not None and "face_tags" in metadata_types

        if write_ratings:
            if modified_fields is None or "rating" in modified_fields:
                tags_to_write[Tags.RATING] = self.rating
            if modified_fields is not None and "timestamp" in modified_fields:
                # XMP:DateCreated is used rather than an EXIF date tag because
                # EXIF tags cannot be written into an XMP sidecar (exiftool
                # silently leaves the sidecar unchanged), and because writing it
                # preserves the camera's original EXIF:DateTimeOriginal.
                # Serialized in exiftool's canonical form; ``self.timestamp`` is
                # local time carrying a UTC tzinfo, so the offset is dropped
                # rather than written out as a misleading "+00:00".
                tags_to_write[Tags.DATE_CREATED] = (
                    self.timestamp.strftime("%Y:%m:%d %H:%M:%S")
                    if self.timestamp
                    else ""
                )

        if write_face_tags:
            from api.metadata.face_regions import get_face_region_tags

            tags_to_write.update(get_face_region_tags(self))

        if tags_to_write:
            write_metadata(self.main_file.path, tags_to_write, use_sidecar=use_sidecar)

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
        if not _has_usable_coordinates(new_gps_lat, new_gps_lon):
            return
        if (
            old_gps_lat == float(new_gps_lat)
            and old_gps_lon == float(new_gps_lon)
            and old_album_places.exists()
            and self._has_current_geolocation()
        ):
            return
        self.exif_gps_lon = float(new_gps_lon)
        self.exif_gps_lat = float(new_gps_lat)
        if commit:
            self.save()

        res = self._reverse_geocode_safely(new_gps_lat, new_gps_lon)
        if not res:
            return

        self.geolocation_json = res
        self._update_search_location(res)
        self._move_to_album_places(old_album_places)

        if commit:
            self.save()

    def _has_current_geolocation(self):
        return bool(
            self.geolocation_json
            and "_v" in self.geolocation_json
            and self.geolocation_json["_v"] == GEOCODE_VERSION
        )

    def _reverse_geocode_safely(self, lat, lon):
        try:
            return reverse_geocode(lat, lon)
        except Exception as e:
            util.logger.warning(e)
            util.logger.warning("Something went wrong with geolocating")
            return None

    def _update_search_location(self, res):
        from api.models.photo_search import PhotoSearch

        search_instance, _ = PhotoSearch.objects.get_or_create(photo=self)
        search_instance.update_search_location(res)
        search_instance.save()

    def _move_to_album_places(self, old_album_places):
        # Delete photo from album places if location has changed
        if old_album_places is not None:
            for old_album_place in old_album_places:
                old_album_place.photos.remove(self)
                old_album_place.save()

        features = self.geolocation_json["features"]
        for geolocation_level, feature in enumerate(features):
            if "text" not in feature.keys() or feature["text"].isnumeric():
                continue
            album_place = api.models.album_place.get_album_place(
                feature["text"], owner=self.owner
            )
            if not album_place.photos.filter(image_hash=self.image_hash).exists():
                album_place.geolocation_level = len(features) - geolocation_level
            album_place.photos.add(self)
            album_place.save()

    def _add_location_to_album_dates(self):
        places = (self.geolocation_json or {}).get("places") or []
        if len(places) < 2:
            return

        album_date = self._find_album_date()
        city_name = places[-2]
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
        if not settings.FEATURE_FACE_DETECTION:
            logger.info("Face detection is disabled")
            return

        unknown_cluster: api.models.cluster.Cluster = (
            api.models.cluster.get_unknown_cluster(user=self.owner)
        )
        try:
            self._detect_and_save_faces(unknown_cluster)
        except IntegrityError:
            self._retry_face_extraction(second_try)
        except Exception as e:
            logger.error(f"image {self}: scan face failed")
            raise e

    def _detect_and_save_faces(self, unknown_cluster):
        big_thumbnail_image = np.array(
            PIL.Image.open(self.thumbnail.thumbnail_big.path)
        )

        face_locations = face_extractor.extract(
            self.main_file.path, self.thumbnail.thumbnail_big.path, self.owner
        )

        if len(face_locations) == 0:
            return

        # Fetch existing face locations once to avoid repeated DB queries.
        existing_face_locations = list(
            api.models.face.Face.objects.filter(photo=self).values_list(
                "location_top", "location_right", "location_bottom", "location_left"
            )
        )

        for idx_face, face_location in enumerate(face_locations):
            top, right, bottom, left, person_name = face_location
            person = self._get_or_create_named_person(person_name)

            face_image = big_thumbnail_image[top:bottom, left:right]
            face_image = PIL.Image.fromarray(face_image)

            image_path = self.image_hash + "_" + str(idx_face) + ".jpg"

            if _overlaps_existing_face(
                existing_face_locations, top, right, bottom, left
            ):
                if person is not None:
                    self._reconcile_xmp_face_name(
                        person, person_name, (top, right, bottom, left)
                    )
                continue

            self._save_detected_face(
                face_image,
                image_path,
                person,
                unknown_cluster,
                (top, right, bottom, left),
            )
            if person_name:
                person._calculate_face_count()
                person._set_default_cover_photo()
            existing_face_locations.append((top, right, bottom, left))
        logger.info(f"image {self.image_hash}: {len(face_locations)} face(s) saved")

    def _get_or_create_named_person(self, person_name):
        if not person_name:
            return None
        person = api.models.person.get_or_create_person(
            name=person_name,
            owner=self.owner,
            kind=api.models.person.Person.KIND_USER,
        )
        person.save()
        return person

    def _reconcile_xmp_face_name(self, person, person_name, location):
        top, right, bottom, left = location
        for existing_face in api.models.face.Face.objects.filter(photo=self):
            existing_location = (
                existing_face.location_top,
                existing_face.location_right,
                existing_face.location_bottom,
                existing_face.location_left,
            )
            if not _overlaps_existing_face(
                [existing_location], top, right, bottom, left
            ):
                continue
            if existing_face.person_id is None:
                existing_face.person = person
                existing_face.save(update_fields=["person"])
                person._calculate_face_count()
                person._set_default_cover_photo()
                logger.warning(
                    f"XMP face reconciliation: assigned {person_name} "
                    f"to existing face {existing_face.id}"
                )
            break

    def _save_detected_face(self, face_image, image_path, person, cluster, location):
        top, right, bottom, left = location
        face = api.models.face.Face(
            photo=self,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
            encoding="",
            person=person,
            cluster=cluster,
        )
        face_io = BytesIO()
        if face_image.mode in ("RGBA", "P"):
            face_image = face_image.convert("RGB")
        face_image.save(face_io, format="JPEG")
        face.image.save(image_path, ContentFile(face_io.getvalue()))
        face_io.close()
        face.save()

    def _retry_face_extraction(self, second_try):
        # When using multiple processes, then we can save at the same time, which leads to this error
        if self.files.exists():
            # print out the location of the image only if we have a path
            logger.info(f"image {self.main_file.path}: rescan face failed")
        if not second_try:
            self._extract_faces(True)
        elif self.files.exists():
            logger.error(f"image {self.main_file.path}: rescan face failed")
        else:
            logger.error(f"image {self}: rescan face failed")

    def _places365_captions(self):
        caption_instance = getattr(self, "caption_instance", None)
        if not caption_instance:
            return _NO_PLACES365
        captions_json = caption_instance.captions_json
        if not captions_json or type(captions_json) is not dict:
            return _NO_PLACES365
        if "places365" not in captions_json.keys():
            return _NO_PLACES365
        return captions_json["places365"]

    def _add_to_album_things(self, titles, thing_type):
        for title in titles:
            album_thing = api.models.album_thing.get_album_thing(
                title=title,
                owner=self.owner,
            )
            if not album_thing.photos.filter(image_hash=self.image_hash).exists():
                album_thing.photos.add(self)
                album_thing.thing_type = thing_type
                album_thing.save()

    def _add_to_album_thing(self):
        places365 = self._places365_captions()
        if places365 is _NO_PLACES365:
            return
        self._add_to_album_things(places365["attributes"], "places365_attribute")
        self._add_to_album_things(places365["categories"], "places365_category")

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
                file.photo_set.exclude(pk=self.pk).exists()
                or file.main_photo.exclude(pk=self.pk).exists()
            )

            if other_photos_using_file:
                # File is shared - just unlink from this photo, don't delete
                logger.info(
                    f"File {file.path} is shared with other photos, unlinking only"
                )
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

        # A cached transcode outlives the photo otherwise: it is named after the
        # image hash, which no longer belongs to anything, so nothing would ever
        # serve it and nothing would ever reclaim it until the cache filled up.
        transcode_cache.discard(self.image_hash)

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
                logger.info(
                    f"Deleting photo stack {photo_stack.id} - only {remaining_photos} photos remaining"
                )
                # Unlink remaining photos from stack first
                for remaining_photo in photo_stack.photos.all():
                    remaining_photo.stacks.remove(photo_stack)
                photo_stack.delete()

        # Clean up duplicate groups if they're now empty or have only one photo left
        for duplicate in photo_duplicates:
            remaining_photos = duplicate.photos.filter(removed=False).count()
            if remaining_photos <= 1:
                # If 0 or 1 photos left, delete the duplicate group (no longer valid)
                logger.info(
                    f"Deleting duplicate group {duplicate.id} - only {remaining_photos} photos remaining"
                )
                # Unlink remaining photos from duplicate first
                for remaining_photo in duplicate.photos.all():
                    remaining_photo.duplicates.remove(duplicate)
                duplicate.delete()

        return result

    def rotate(self, angle: int = 0, flip_horizontal: bool = False) -> None:
        """Rotate the photo non-destructively.

        Updates ``local_orientation`` and regenerates thumbnails.  The original
        file is never modified by this method; the change is stored in the DB
        and reflected in the regenerated thumbnails.

        Optionally writes the combined orientation to the photo's file (or
        sidecar) if the owner has ``save_metadata_to_disk`` enabled.

        Args:
            angle: Clockwise rotation in degrees.  Must be a multiple of 90.
                Use negative values for counter-clockwise rotation (e.g. -90
                for 90° CCW).
            flip_horizontal: If True, apply a horizontal flip on top of the
                rotation.

        Raises:
            ValueError: If ``angle`` is not a multiple of 90.
        """
        angle = int(angle) % 360  # normalise first so -90 → 270, 360 → 0

        if angle % 90 != 0:
            raise ValueError("angle must be a multiple of 90 degrees")

        if angle == 0 and not flip_horizontal:
            return

        from api.util import compose_orientation

        new_orientation = compose_orientation(
            self.local_orientation,
            delta_angle_cw=angle,
            flip_h=flip_horizontal,
        )
        self.local_orientation = new_orientation
        # Bypass _save_metadata – orientation is stored in the DB only for
        # now; writing to disk is handled separately.
        self.save(save_metadata=False)

        # Regenerate thumbnails so the UI sees the updated orientation.
        self.thumbnail._regenerate_thumbnails()

        self._write_orientation_to_disk(angle, flip_horizontal)

    def _write_orientation_to_disk(self, angle: int, flip_horizontal: bool) -> None:
        """Write the combined orientation to the file / sidecar when the user
        has opted into persisting metadata to disk."""
        user = self.owner
        if user.save_metadata_to_disk == User.SaveMetadata.OFF:
            return

        from api.util import compose_orientation

        try:
            exif_orientation = self.metadata.orientation or 1
        except Exception:
            exif_orientation = 1

        # Compose the user's local rotation with the original EXIF orientation
        # so a standards-compliant viewer shows the image correctly without
        # relying on LibrePhotos-specific DB fields.
        combined = compose_orientation(
            exif_orientation,
            delta_angle_cw=angle,
            flip_h=flip_horizontal,
        )
        write_metadata(
            self.main_file.path,
            {Tags.ORIENTATION: combined},
            use_sidecar=user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE,
        )

    def _set_embedded_media(self, obj):
        return obj.main_file.embedded_media

    def __str__(self):
        main_file_path = (
            self.main_file.path if self.main_file is not None else "No main file"
        )
        return f"{self.image_hash} - {self.owner} - {main_file_path}"
