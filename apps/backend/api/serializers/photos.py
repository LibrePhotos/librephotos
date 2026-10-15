import logging
from datetime import datetime
from typing import Any

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Count, Model, OuterRef, Prefetch, QuerySet, Subquery
from django.db.models.functions import Coalesce
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field, extend_schema_serializer
from rest_framework import serializers

from api.drf.params import (
    JsonBooleanField,
    JsonIntegerField,
    JsonStringField,
    TristateFlagField,
    required_string,
)
from api.drf.request_user import request_user
from api.geocode.photo_location import GeocodeStatus, geocode_status, has_place
from api.metadata import edits
from api.metadata.library_write import WRITE_TYPES
from api.models import AlbumDate, File, Photo, User
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.models.photo_ocr import PhotoOcr
from api.models.photo_search import PhotoSearch
from api.models.photo_stack import PhotoStack
from api.models.thumbnail import Thumbnail
from api.search.similarity import search_similar_image
from api.serializers.fields import (
    loaded_count,
    prefetched,
    shared_serializer,
)
from api.serializers.photo_metadata import PhotoMetadataSummarySerializer
from api.serializers.PhotosGroupedByDate import PhotosGroupedByDate
from api.serializers.simple import SimpleUserSerializer, has_animated_preview
from api.video import color, playback

logger = logging.getLogger(__name__)


def _search_instance(obj: Photo) -> PhotoSearch | None:
    """The photo's search row, or None when it has none (reverse one-to-one)."""
    try:
        return obj.search_instance
    except ObjectDoesNotExist:
        return None


def _caption_instance(obj: Photo) -> PhotoCaption | None:
    """The photo's caption row, or None when it has none (reverse one-to-one)."""
    try:
        return obj.caption_instance
    except ObjectDoesNotExist:
        return None


class PhotoSummarySerializer(serializers.ModelSerializer):
    # UUID primary key
    id = serializers.UUIDField(read_only=True)
    # Content hash for deduplication/caching (legacy 'id' field for backwards compatibility)
    image_hash = serializers.CharField(read_only=True)
    dominantColor = serializers.SerializerMethodField()
    aspectRatio = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    birthTime = serializers.SerializerMethodField()
    video_length = serializers.SerializerMethodField()
    # For an HDR badge on the tile. False for a video the scan has not probed
    # yet as well as for an SDR one: the backfill job fills the older ones in.
    is_hdr = serializers.SerializerMethodField()
    # Whether the grid square is a clip to play or a still (#649).
    animated_preview = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    owner = SimpleUserSerializer()
    # Stack information (can be multiple stacks)
    stacks = serializers.SerializerMethodField()
    # Flag indicating if this photo has a RAW file variant (PhotoPrism-like model)
    has_raw_variant = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "id",
            "image_hash",
            "dominantColor",
            "url",
            "location",
            "date",
            "birthTime",
            "aspectRatio",
            "type",
            "video_length",
            "is_hdr",
            "animated_preview",
            "rating",
            "owner",
            "exif_gps_lat",
            "exif_gps_lon",
            "removed",
            "in_trashcan",
            # Off the timeline, still here (#545): the tile shows a mark.
            "archived",
            # When the photo went to the trash (null outside it): the trash
            # page says when the retention deletes it (#2203).
            "trashed_at",
            "stacks",
            "has_raw_variant",
            "local_orientation",
        )

    # TODO: Rename this field to aspect_ratio
    def get_aspectRatio(self, obj: Photo) -> float | None:
        return obj.thumbnail.aspect_ratio

    # TODO: Remove this field in the future (kept for backwards compatibility)
    def get_url(self, obj: Photo) -> str:
        return obj.image_hash

    def get_location(self, obj: Photo) -> str:
        search = _search_instance(obj)
        if search and search.search_location:
            return search.search_location
        else:
            return ""

    def get_date(self, obj: Photo) -> str:
        if obj.exif_timestamp:
            return obj.exif_timestamp.isoformat()
        else:
            return ""

    def get_video_length(self, obj: Photo) -> str:
        if obj.video_length:
            return obj.video_length
        else:
            return ""

    def get_is_hdr(self, obj: Photo) -> bool:
        return obj.video and obj.video_color_transfer in color.HDR_TRANSFERS

    def get_animated_preview(self, obj: Photo) -> bool:
        return has_animated_preview(obj)

    # TODO: Remove this field in the future
    def get_birthTime(self, obj: Photo) -> datetime | str:
        if obj.exif_timestamp:
            return obj.exif_timestamp
        else:
            return ""

    def get_dominantColor(self, obj: Photo) -> str:
        if obj.thumbnail.dominant_color:
            dominant_color = obj.thumbnail.dominant_color[1:-1]
            r, g, b = (int(x) for x in dominant_color.split(", "))
            return f"#{r:02x}{g:02x}{b:02x}"
        else:
            return ""

    def get_type(self, obj: Photo) -> str:
        if obj.video:
            return "video"
        # Use len() instead of .count() to leverage prefetched embedded_media
        if obj.main_file and len(obj.main_file.embedded_media.all()) > 0:
            return "motion_photo"
        return "image"

    def get_stacks(self, obj: Photo) -> list | None:
        """The photo's stacks, as ``with_photo_summary_relations`` prefetched them.

        The prefetch keeps the stack types a tile shows and annotates each
        stack's size; a photo without that prefetch raises instead of querying.
        """
        result = [
            {
                "id": str(stack.id),
                "type": stack.stack_type,
                "photo_count": loaded_count(stack, "photo_count_annotation"),
                "is_primary": stack.primary_photo_id == obj.pk,
            }
            for stack in prefetched(obj, "stacks", PhotoStack)
        ]
        return result or None

    def get_has_raw_variant(self, obj: Photo) -> bool:
        """Whether one of the photo's files (prefetched) is a RAW file."""
        return any(
            file.type == File.RAW_FILE for file in prefetched(obj, "files", File)
        )


class GroupedPhotosSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("date", "location", "items")

    def get_date(self, obj: PhotosGroupedByDate) -> datetime | str | None:
        return obj.date

    def get_location(self, obj: PhotosGroupedByDate) -> str:
        return obj.location

    @extend_schema_field(PhotoSummarySerializer(many=True))
    def get_items(self, obj: PhotosGroupedByDate) -> list[dict[str, Any]]:
        summary = shared_serializer(self, PhotoSummarySerializer)
        return [summary.to_representation(photo) for photo in obj.photos]


class PhotoMediaQuery(serializers.Serializer[None]):
    """The media filter of the Recently added, No timestamp and No location lists.

    The same flags as the per-view media filter on the date-album endpoints,
    resolved by ``api.albums.timeline_filter``. Only these four are read, so
    the user's saved timeline default (``apply_default``) never applies here.
    """

    photo = TristateFlagField(help_text="Only photos (false: no photos)")
    video = TristateFlagField(help_text="Only videos (false: no videos)")
    is_screenshot = TristateFlagField(
        help_text="Only screenshots (false: no screenshots)"
    )
    is_document = TristateFlagField(help_text="Only documents (false: no documents)")


# The two unpaginated photo lists answer one object around their rows; these
# describe it for the schema (many=False: the list action would wrap it).
@extend_schema_serializer(many=False)
class RecentlyAddedPhotosSerializer(serializers.Serializer[None]):
    """``/api/photos/recentlyadded/``: the latest upload day and its photos."""

    date = serializers.DateTimeField(allow_null=True)
    results = PhotoSummarySerializer(many=True)


@extend_schema_serializer(many=False)
class SearchResultsSerializer(serializers.Serializer[None]):
    """``/api/photos/searchlist/``: the matches grouped by date.

    With semantic search on, ``results`` is a flat list of photo summaries.
    """

    results = GroupedPhotosSerializer(many=True)


def with_photo_summary_relations(queryset: QuerySet[Photo]) -> QuerySet[Photo]:
    """Load everything ``PhotoSummarySerializer`` reads in a constant number of queries.

    The summary serializer touches the thumbnail, the search instance, the main
    file's embedded media, the photo's stacks and its files for every photo it
    renders. Without these joins an album detail response costs a handful of
    extra round trips *per photo*, which is why large albums took seconds before
    showing their first thumbnail (issue #619).
    """
    # Filter the stacks to valid types and annotate photo_count so that
    # get_stacks() never has to fall back to a query of its own.
    valid_stack_types = PhotoStack.VALID_STACK_TYPES + [
        PhotoStack.StackType.RAW_JPEG_PAIR,
        PhotoStack.StackType.LIVE_PHOTO,
    ]
    # A subquery, not Count("photos"): the prefetch filters the stacks through
    # that same join, so a count over it saw only the photo being prefetched
    # and every tile said its stack held one photo.
    stack_size = (
        Photo.objects.filter(stacks=OuterRef("pk"))
        .order_by()
        .values("stacks")
        .annotate(total=Count("pk"))
        .values("total")
    )
    stacks_prefetch = Prefetch(
        "stacks",
        queryset=PhotoStack.objects.filter(stack_type__in=valid_stack_types).annotate(
            photo_count_annotation=Coalesce(Subquery(stack_size), 0)
        ),
    )

    return (
        queryset.prefetch_related(
            Prefetch(
                "owner",
                queryset=User.objects.only("id", "username", "first_name", "last_name"),
            ),
            Prefetch(
                "main_file__embedded_media",
                queryset=File.objects.only("hash"),
            ),
            stacks_prefetch,
            "files",  # Prefetch files for get_has_raw_variant()
        )
        .select_related("thumbnail", "search_instance", "main_file")
        .only(
            "image_hash",
            "thumbnail__aspect_ratio",
            "thumbnail__dominant_color",
            # Its name says whether a video's square is a clip (animated_preview).
            "thumbnail__square_thumbnail",
            "video",
            "main_file",
            "search_instance__search_location",
            "public",
            "rating",
            "hidden",
            "exif_timestamp",
            "owner",
            "video_length",
            "video_color_transfer",
            "exif_gps_lat",
            "exif_gps_lon",
            "removed",
            "in_trashcan",
            "archived",
            "trashed_at",
            "local_orientation",
            # Read by filter_photos_by_media_type for ?is_screenshot / ?is_document.
            "is_screenshot",
            "is_document",
        )
    )


GPS_FIELDS = ("exif_gps_lat", "exif_gps_lon")


class PhotoEditSerializer(serializers.ModelSerializer):
    geocoded = serializers.SerializerMethodField()
    geocode_status = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "image_hash",
            "hidden",
            "rating",
            "in_trashcan",
            "removed",
            "video",
            "exif_timestamp",
            "timestamp",
            # Allow updating GPS location
            "exif_gps_lat",
            "exif_gps_lon",
            # Media-category manual override
            "is_screenshot",
            "is_document",
            "category_source",
            "geocoded",
            "geocode_status",
        )
        # category_source is server-managed: it is set to "user" whenever a
        # category flag is written through the API, and is never client-settable.
        read_only_fields = ("category_source",)
        # Both null removes the location (#2209); see validate().
        extra_kwargs = {
            "exif_gps_lat": {"min_value": -90, "max_value": 90},
            "exif_gps_lon": {"min_value": -180, "max_value": 180},
        }

    def get_geocoded(self, obj: Photo) -> bool:
        """Whether the photo's coordinates have a place name.

        False after a location edit that found no place name; `geocode_status`
        says whether the lookup failed or there is no place there.
        """
        # #2253: the edit used to answer 200 and keep the old place.
        return has_place(obj)

    def get_geocode_status(self, obj: Photo) -> GeocodeStatus | None:
        """How the place lookup for the photo's position went.

        "found": it has a place name. "no_place": the lookup worked, but
        there is no place there (open sea); not a failure. "failed": no place
        name because the lookup failed or reverse geocoding is off. Null for
        a photo without a position.
        """
        # #2589: `geocoded` is false for "no place there" and a failure alike.
        return geocode_status(obj)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """A location edit names both coordinates: two numbers move the photo,
        two nulls remove its location (#2209). One of them alone, or a number
        with a null, is a 400 rather than half an edit."""
        sent = [attrs[key] for key in GPS_FIELDS if key in attrs]
        if len(sent) == 1 or sent.count(None) == 1:
            raise serializers.ValidationError(
                {
                    key: "Send exif_gps_lat and exif_gps_lon together, both "
                    "numbers or both null."
                    for key in GPS_FIELDS
                }
            )
        return attrs

    def update(self, instance: Photo, validated_data: dict[str, Any]) -> Photo:
        self._apply_category_override(instance, validated_data)
        # The view only hands out the requester's own photos; without a
        # request (a direct call) the edit is the owner's.
        request = self.context.get("request")
        user = request_user(request) if request is not None else instance.owner

        if "exif_timestamp" in validated_data:
            edits.set_capture_time(instance, validated_data.pop("exif_timestamp"), user)

        if "exif_gps_lat" in validated_data:
            self._apply_location_edit(
                instance,
                validated_data.pop("exif_gps_lat"),
                validated_data.pop("exif_gps_lon"),
                user,
            )
        return instance

    @staticmethod
    def _apply_location_edit(
        instance: Photo, lat: float | None, lon: float | None, user: User
    ) -> None:
        # validate() let through both numbers or both None.
        if lat is None and instance.exif_gps_lat is None:
            # Nothing to remove: the photo's position stays the file's to
            # give, rather than becoming "no location, set by the user".
            return
        edits.set_location(instance, lat, lon, user)

    def _apply_category_override(
        self, instance: Photo, validated_data: dict[str, Any]
    ) -> None:
        # Media-category manual override. Any explicit write to a category flag
        # marks the photo as user-corrected so rescans and the classify_media
        # backfill (which skip category_source == "user") never clobber it.
        category_fields = [
            field
            for field in ("is_screenshot", "is_document")
            if field in validated_data
        ]
        if not category_fields:
            return
        for field in category_fields:
            setattr(instance, field, validated_data.pop(field))
        instance.category_source = "user"
        instance.save(update_fields=[*category_fields, "category_source"])


class PhotoHashListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ("image_hash", "video")


class PhotoDetailsSummarySerializer(serializers.ModelSerializer):
    photo_summary = serializers.SerializerMethodField()
    album_date_id = serializers.SerializerMethodField()
    processing = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("photo_summary", "album_date_id", "processing")

    # The view passes a queryset of photos (many=False), not a single photo.
    @extend_schema_field(PhotoSummarySerializer)
    def get_photo_summary(self, obj: QuerySet[Photo]) -> dict[str, Any]:
        return PhotoSummarySerializer(with_photo_summary_relations(obj).get()).data

    def get_processing(self, obj: QuerySet[Photo]) -> bool:
        return obj.get().thumbnail.aspect_ratio is None

    def get_album_date_id(self, obj: QuerySet[Photo]) -> int | None:
        return (
            AlbumDate.objects.filter(photos__in=obj)
            .values_list("id", flat=True)
            .first()
        )


class PhotoSerializer(serializers.ModelSerializer):
    square_thumbnail_url = serializers.SerializerMethodField()
    big_thumbnail_url = serializers.SerializerMethodField()
    small_square_thumbnail_url = serializers.SerializerMethodField()
    similar_photos = serializers.SerializerMethodField()
    captions_json = serializers.SerializerMethodField()
    search_captions = serializers.SerializerMethodField()
    search_location = serializers.SerializerMethodField()
    people = serializers.SerializerMethodField()
    shared_to: "serializers.PrimaryKeyRelatedField[User]" = (
        serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    )
    image_path = serializers.SerializerMethodField()
    owner = SimpleUserSerializer(many=False, read_only=True)
    embedded_media = serializers.SerializerMethodField()
    # File variants (RAW, JPEG, video for Live Photos, etc.)
    # PhotoPrism-like model where one Photo can have multiple file variants
    file_variants = serializers.SerializerMethodField()
    # Stack information (bursts, brackets, manual stacks) - can be multiple
    stacks = serializers.SerializerMethodField()
    # Structured metadata with edit history support
    metadata = serializers.SerializerMethodField()
    # OCR text and normalized block geometry for the "live text" overlay
    ocr = serializers.SerializerMethodField()
    # What the video is, in the form the browser's canPlayType() takes, so the
    # frontend asks for a conversion only when this browser cannot play it.
    video_playback_type = serializers.SerializerMethodField()
    # Whether exif_timestamp is a date the user set by hand, which overrides
    # the date rules until the user removes it (#2254, #2280).
    date_set_by_user = serializers.SerializerMethodField()

    # Backwards-compatible fields from PhotoMetadata (for API compatibility)
    height = serializers.SerializerMethodField()
    width = serializers.SerializerMethodField()
    focal_length = serializers.SerializerMethodField()
    fstop = serializers.SerializerMethodField()
    iso = serializers.SerializerMethodField()
    shutter_speed = serializers.SerializerMethodField()
    lens = serializers.SerializerMethodField()
    camera = serializers.SerializerMethodField()
    focalLength35Equivalent = serializers.SerializerMethodField()
    digitalZoomRatio = serializers.SerializerMethodField()
    subjectDistance = serializers.SerializerMethodField()
    # The rest of the exposure the camera recorded (#2276), null where the file
    # does not say.
    exposure_compensation = serializers.SerializerMethodField()
    flash_fired = serializers.SerializerMethodField()
    metering_mode = serializers.SerializerMethodField()
    white_balance = serializers.SerializerMethodField()
    # Height above sea level from the GPS: location-derived, so the owner's
    # only, like ``ocr``.
    gps_altitude = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "id",
            "exif_gps_lat",
            "exif_gps_lon",
            "exif_timestamp",
            "date_set_by_user",
            "captions_json",
            "search_captions",
            "search_location",
            "big_thumbnail_url",
            "square_thumbnail_url",
            "small_square_thumbnail_url",
            "geolocation_json",
            "people",
            "image_hash",
            "image_path",
            "rating",
            "hidden",
            "public",
            "removed",
            "in_trashcan",
            "archived",
            "trashed_at",
            "shared_to",
            "similar_photos",
            "video",
            # Media category, and whether the user set it ("user") or the
            # detector did ("auto"); the lightbox shows and changes it.
            "is_screenshot",
            "is_document",
            "category_source",
            "owner",
            "size",
            "height",
            "width",
            "focal_length",
            "fstop",
            "iso",
            "shutter_speed",
            "lens",
            "camera",
            "focalLength35Equivalent",
            "digitalZoomRatio",
            "subjectDistance",
            "exposure_compensation",
            "flash_fired",
            "metering_mode",
            "white_balance",
            "gps_altitude",
            # A video's duration in seconds (as a string, like the grid's) and
            # its codec as ffprobe names it ("" once probed without an answer).
            "video_length",
            "video_codec",
            "embedded_media",
            "video_playback_type",
            "file_variants",
            "stacks",
            "metadata",
            "ocr",
            "local_orientation",
        )
        # Shown, never written here: a category change goes through
        # /api/photosedit/category/ (or the PhotoEditSerializer), which pins
        # category_source="user"; category_source is server-managed.
        read_only_fields = (
            "is_screenshot",
            "is_document",
            "category_source",
            "video_length",
            "video_codec",
        )
        extra_kwargs = {"rating": {"min_value": 0, "max_value": edits.MAX_RATING}}

    def update(self, instance: Photo, validated_data: dict[str, Any]) -> Photo:
        # A rating is a metadata edit: recorded and written back by the edit
        # service, not by Photo.save(), which no longer writes (#2295).
        rating = validated_data.pop("rating", None)
        instance = super().update(instance, validated_data)
        if rating is not None:
            request = self.context.get("request")
            user = request_user(request) if request is not None else instance.owner
            edits.set_rating(Photo.objects.filter(pk=instance.pk), rating, user)
            instance.refresh_from_db(fields=["rating", "last_modified"])
        return instance

    def _get_metadata(self, obj: Photo) -> PhotoMetadata | None:
        """Helper to get PhotoMetadata, with caching."""
        if not hasattr(obj, "_cached_metadata"):
            try:
                setattr(obj, "_cached_metadata", obj.metadata)
            except PhotoMetadata.DoesNotExist:
                setattr(obj, "_cached_metadata", None)
        cached: PhotoMetadata | None = getattr(obj, "_cached_metadata")
        return cached

    def get_video_playback_type(self, obj: Photo) -> str | None:
        return playback.playback_type(obj)

    def get_date_set_by_user(self, obj: Photo) -> bool:
        return obj.timestamp is not None

    def get_height(self, obj: Photo) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.height if metadata else 0

    def get_width(self, obj: Photo) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.width if metadata else 0

    def get_focal_length(self, obj: Photo) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.focal_length if metadata else None

    def get_fstop(self, obj: Photo) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.aperture if metadata else None

    def get_iso(self, obj: Photo) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.iso if metadata else None

    def get_shutter_speed(self, obj: Photo) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.shutter_speed if metadata else None

    def get_lens(self, obj: Photo) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.lens_display if metadata else None

    def get_camera(self, obj: Photo) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.camera_display if metadata else None

    def get_focalLength35Equivalent(self, obj: Photo) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.focal_length_35mm if metadata else None

    def get_digitalZoomRatio(self, obj: Photo) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.digital_zoom_ratio if metadata else None

    def get_subjectDistance(self, obj: Photo) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.subject_distance if metadata else None

    def get_exposure_compensation(self, obj: Photo) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.exposure_compensation if metadata else None

    def get_flash_fired(self, obj: Photo) -> bool | None:
        metadata = self._get_metadata(obj)
        return metadata.flash_fired if metadata else None

    def get_metering_mode(self, obj: Photo) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.metering_mode if metadata else None

    def get_white_balance(self, obj: Photo) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.white_balance if metadata else None

    def get_gps_altitude(self, obj: Photo) -> float | None:
        request = self.context.get("request")
        if request is None or request.user != obj.owner:
            return None
        metadata = self._get_metadata(obj)
        return metadata.gps_altitude if metadata else None

    def get_ocr(self, obj: Photo) -> dict | None:
        """OCR text plus block geometry normalized to [0, 1], owner-only.

        OCR text is privacy-sensitive (receipts, letters, IDs), so it is served
        exclusively to the photo's owner: the detail endpoint also answers for
        shared and public photos (even anonymously), and those viewers must not
        receive the extracted text. Without a request in the serializer context
        the owner cannot be verified, so nothing is exposed.

        The stored boxes are pixel coordinates in the OCR source image (the
        original file or the big thumbnail, whichever was fed to the sidecar).
        Both share the photo's aspect ratio, so dividing by the stored source
        dimensions yields display-agnostic fractions the frontend can lay over
        any rendition. Rows written before the dimensions were stored get their
        text but no blocks (no overlay is possible without a reference frame).
        """
        request = self.context.get("request")
        if request is None or request.user != obj.owner:
            return None

        try:
            ocr = obj.ocr
        except PhotoOcr.DoesNotExist:
            return None

        blocks = []
        width = ocr.source_width or 0
        height = ocr.source_height or 0
        if width > 0 and height > 0 and isinstance(ocr.blocks, list):
            for block in ocr.blocks:
                box = block.get("box") if isinstance(block, dict) else None
                text = block.get("text") if isinstance(block, dict) else None
                if not text or not isinstance(box, list) or len(box) != 4:
                    continue
                try:
                    normalized = [
                        [
                            min(1.0, max(0.0, float(x) / width)),
                            min(1.0, max(0.0, float(y) / height)),
                        ]
                        for x, y in box
                    ]
                except (TypeError, ValueError):
                    continue
                blocks.append(
                    {
                        "text": text,
                        "box": normalized,
                        "confidence": block.get("confidence"),
                    }
                )

        return {"text": ocr.text or "", "blocks": blocks}

    def get_similar_photos(self, obj: Photo) -> list:
        res = search_similar_image(obj.owner, obj)
        arr: list[str] = []
        # The sidecar answers with its JSON object; without an index it is [].
        if isinstance(res, dict) and len(res) > 0:
            arr.extend(res["result"])
            # The index is per owner; of the owner's matches, list only those
            # the requester may see (a share recipient is not shown the rest).
            request = self.context.get("request")
            viewer = getattr(request, "user", None) if request else obj.owner
            photos = (
                Photo.objects.owned_by(obj.owner)
                .visible_to(viewer)
                .filter(image_hash__in=arr)
                .distinct()
            )
            matches: list[dict[str, str]] = []
            for photo in photos:
                type = "image"
                if photo.video:
                    type = "video"
                matches.append({"image_hash": photo.image_hash, "type": type})
            return matches
        else:
            return []

    def get_captions_json(self, obj: Photo) -> dict:
        caption = _caption_instance(obj)
        if caption and caption.captions_json and len(caption.captions_json) > 0:
            return caption.captions_json
        else:
            # Tags live under the active tagging model's key when present.
            return {"im2txt": ""}

    def get_search_captions(self, obj: Photo) -> str:
        search = _search_instance(obj)
        if search:
            return search.search_captions or ""
        return ""

    def get_search_location(self, obj: Photo) -> str:
        search = _search_instance(obj)
        if search:
            return search.search_location or ""
        return ""

    def get_image_path(self, obj: Photo) -> list[str]:
        try:
            paths = []
            for file in obj.files.all():
                paths.append(file.path)
            return paths
        except Exception:
            return ["Missing"]

    def get_square_thumbnail_url(self, obj: Photo) -> str:
        return (
            obj.thumbnail.square_thumbnail.url if obj.thumbnail.square_thumbnail else ""
        )

    def get_small_square_thumbnail_url(self, obj: Photo) -> str:
        return (
            obj.thumbnail.square_thumbnail_small.url
            if obj.thumbnail.square_thumbnail_small
            else ""
        )

    def get_big_thumbnail_url(self, obj: Photo) -> str:
        return obj.thumbnail.thumbnail_big.url if obj.thumbnail.thumbnail_big else ""

    def get_people(self, obj: Photo) -> list:
        return [
            {
                "name": (
                    f.person.name
                    if f.person
                    else (
                        f.cluster_person.name
                        if f.cluster_person
                        else (
                            f.classification_person.name
                            if f.classification_person
                            else ""
                        )
                    )
                ),
                "type": (
                    "user"
                    if f.person
                    else (
                        "cluster"
                        if f.cluster_person
                        else ("classification" if f.classification_person else "")
                    )
                ),
                "probability": (
                    1
                    if f.person
                    else (
                        f.cluster_probability
                        if f.cluster_person
                        else (
                            f.classification_probability
                            if f.classification_person
                            else 0
                        )
                    )
                ),
                "location": {
                    "top": f.location_top,
                    "bottom": f.location_bottom,
                    "left": f.location_left,
                    "right": f.location_right,
                },
                # A face without a crop (legacy rows) has no URL to show.
                "face_url": f.crop_url or "",
                "face_id": f.id,
            }
            for f in obj.faces.all()
            # A deleted face is hidden everywhere else in LibrePhotos -- the face
            # dashboard and the person's face list both filter it out -- so it must
            # not come back in the photo's own face list either.
            if not f.deleted
        ]

    def get_embedded_media(self, obj: Photo) -> list[dict]:
        def serialize_file(file: File) -> dict[str, str]:
            return {
                "id": file.hash,
                "type": "video" if file.type == File.VIDEO else "image",
            }

        if obj.main_file is None:
            return []
        embedded_media = obj.main_file.embedded_media.all()
        if len(embedded_media) == 0:
            return []
        # Filtered in Python: the files are prefetched for the detail view.
        return [
            serialize_file(file)
            for file in embedded_media
            if file.type in (File.VIDEO, File.IMAGE)
        ]

    @extend_schema_field(PhotoMetadataSummarySerializer(allow_null=True))
    def get_metadata(self, obj: Photo) -> dict | None:
        """
        Return structured metadata from PhotoMetadata if available.

        This provides:
        - Normalized field names (aperture, iso, shutter_speed, etc.)
        - Computed display strings (camera_display, lens_display)
        - Resolution and megapixel info
        - Edit tracking (version, source, has_edits)

        Falls back to None if PhotoMetadata doesn't exist (backwards compatible).
        """
        try:
            metadata = obj.metadata
            return PhotoMetadataSummarySerializer(metadata).data
        except PhotoMetadata.DoesNotExist:
            return None

    def get_file_variants(self, obj: Photo) -> list | None:
        """Return file variants for this photo (RAW, JPEG, video for Live Photos, etc.).

        This implements the PhotoPrism-like model where one Photo can have multiple
        file variants representing the same capture moment.
        """
        from api.models.file import File

        files = obj.files.all()
        if files.count() <= 1:
            # Only main file, no additional variants
            return None

        variants = []
        for f in files:
            # Determine file type label
            file_type_map = {
                File.IMAGE: "image",
                File.VIDEO: "video",
                File.RAW_FILE: "raw",
                File.METADATA_FILE: "metadata",
                File.UNKNOWN: "unknown",
            }
            file_type = file_type_map.get(f.type, "unknown")

            # Check if this is the main file
            is_main = obj.main_file_id == f.hash if obj.main_file_id else False

            variants.append(
                {
                    "hash": f.hash,
                    "path": f.path,
                    "type": file_type,
                    "type_id": f.type,
                    "is_main": is_main,
                    "filename": f.path.split("/")[-1] if f.path else None,
                }
            )

        return variants

    def get_stacks(self, obj: Photo) -> list | None:
        """Return detailed stack info for photo detail view (supports multiple stacks)."""
        from api.models.photo_stack import PhotoStack

        # Use model-defined valid stack types, plus deprecated types for backwards compatibility
        valid_stack_types = PhotoStack.VALID_STACK_TYPES + [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ]
        # Filtered in Python: the detail view prefetches the stacks.
        stacks = [s for s in obj.stacks.all() if s.stack_type in valid_stack_types]
        if not stacks:
            return None

        result = []
        for stack in stacks:
            stack_photos = [
                self._serialize_stack_photo(photo, stack)
                for photo in stack.photos.select_related("thumbnail").all()
            ]
            result.append(
                {
                    "id": str(stack.id),
                    "type": stack.stack_type,
                    "type_display": stack.get_stack_type_display(),
                    "photo_count": len(stack_photos),
                    "is_primary": (
                        stack.primary_photo_id == obj.pk
                        if stack.primary_photo_id
                        else False
                    ),
                    "photos": stack_photos,
                }
            )

        return result

    def _serialize_stack_photo(self, photo: Photo, stack: PhotoStack) -> dict[str, Any]:
        width, height = self._stack_photo_dimensions(photo)
        thumbnail: Thumbnail | None
        try:
            thumbnail = photo.thumbnail
        except ObjectDoesNotExist:
            thumbnail = None
        has_thumbnail = bool(thumbnail and thumbnail.square_thumbnail_small)
        return {
            "id": str(photo.id),
            "image_hash": photo.image_hash,
            "is_primary": photo.pk == stack.primary_photo_id,
            "thumbnail_url": (
                f"/media/square_thumbnails_small/{photo.image_hash}"
                if has_thumbnail
                else None
            ),
            "size": photo.size,
            "width": width,
            "height": height,
        }

    def _stack_photo_dimensions(self, photo: Photo) -> tuple[int, int]:
        try:
            metadata = photo.metadata
            return metadata.width or 0, metadata.height or 0
        except PhotoMetadata.DoesNotExist:
            return 0, 0


class SharedFromMePhotoThroughSerializer(serializers.ModelSerializer):
    photo = serializers.SerializerMethodField()
    user = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo.shared_to.through
        fields = ("user_id", "user", "photo")

    @extend_schema_field(PhotoSummarySerializer)
    def get_photo(self, obj: Model) -> dict[str, Any]:
        # obj is an instance of the auto-created shared_to through model.
        return PhotoSummarySerializer(getattr(obj, "photo")).data


class PublicPhotoPersonSerializer(serializers.Serializer[None]):
    """A person on a photo of a public album, when the album shares faces."""

    name = serializers.CharField()
    face_url = serializers.CharField(
        allow_null=True, help_text="The face crop; null without one"
    )
    face_id = serializers.IntegerField()


class PublicPhotoDetailSerializer(serializers.ModelSerializer):
    """Serializer for photo details in public albums.

    Conditionally includes metadata based on sharing settings passed in context.
    Context must include 'sharing_settings' dict with keys:
    - share_location: bool
    - share_camera_info: bool
    - share_timestamps: bool
    - share_captions: bool
    - share_faces: bool
    """

    # Always included
    square_thumbnail_url = serializers.SerializerMethodField()
    big_thumbnail_url = serializers.SerializerMethodField()
    small_square_thumbnail_url = serializers.SerializerMethodField()
    video = serializers.BooleanField(read_only=True)
    image_hash = serializers.CharField(read_only=True)

    # Conditionally included based on sharing settings
    exif_timestamp = serializers.SerializerMethodField()
    exif_gps_lat = serializers.SerializerMethodField()
    exif_gps_lon = serializers.SerializerMethodField()
    geolocation_json = serializers.SerializerMethodField()
    search_location = serializers.SerializerMethodField()

    # Camera info
    camera = serializers.SerializerMethodField()
    lens = serializers.SerializerMethodField()
    focal_length = serializers.SerializerMethodField()
    fstop = serializers.SerializerMethodField()
    iso = serializers.SerializerMethodField()
    shutter_speed = serializers.SerializerMethodField()
    width = serializers.SerializerMethodField()
    height = serializers.SerializerMethodField()

    # Captions
    search_captions = serializers.SerializerMethodField()
    captions_json = serializers.SerializerMethodField()

    # People/faces
    people = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "image_hash",
            "video",
            "square_thumbnail_url",
            "big_thumbnail_url",
            "small_square_thumbnail_url",
            "exif_timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "geolocation_json",
            "search_location",
            "camera",
            "lens",
            "focal_length",
            "fstop",
            "iso",
            "shutter_speed",
            "width",
            "height",
            "search_captions",
            "captions_json",
            "people",
        )

    def _get_sharing_settings(self) -> dict:
        """Get sharing settings from context."""
        return self.context.get("sharing_settings", {})

    def _get_metadata(self, obj: Photo) -> PhotoMetadata | None:
        """Helper to get PhotoMetadata."""
        if not hasattr(obj, "_cached_metadata"):
            try:
                setattr(obj, "_cached_metadata", obj.metadata)
            except PhotoMetadata.DoesNotExist:
                setattr(obj, "_cached_metadata", None)
        cached: PhotoMetadata | None = getattr(obj, "_cached_metadata")
        return cached

    def _shared_camera_metadata(self, obj: Photo) -> PhotoMetadata | None:
        """PhotoMetadata, but only when camera info sharing is enabled."""
        if not self._get_sharing_settings().get("share_camera_info", False):
            return None
        return self._get_metadata(obj)

    # Always available
    def get_square_thumbnail_url(self, obj: Photo) -> str:
        thumbnail = obj.thumbnail
        return thumbnail.square_thumbnail.url if thumbnail.square_thumbnail else ""

    def get_small_square_thumbnail_url(self, obj: Photo) -> str:
        thumbnail = obj.thumbnail
        return (
            thumbnail.square_thumbnail_small.url
            if thumbnail.square_thumbnail_small
            else ""
        )

    def get_big_thumbnail_url(self, obj: Photo) -> str:
        thumbnail = obj.thumbnail
        return thumbnail.thumbnail_big.url if thumbnail.thumbnail_big else ""

    # Timestamp - conditional
    def get_exif_timestamp(self, obj: Photo) -> datetime | None:
        if self._get_sharing_settings().get("share_timestamps", False):
            return obj.exif_timestamp
        return None

    # Location - conditional
    def get_exif_gps_lat(self, obj: Photo) -> float | None:
        if self._get_sharing_settings().get("share_location", False):
            return obj.exif_gps_lat
        return None

    def get_exif_gps_lon(self, obj: Photo) -> float | None:
        if self._get_sharing_settings().get("share_location", False):
            return obj.exif_gps_lon
        return None

    def get_geolocation_json(self, obj: Photo) -> dict | None:
        if self._get_sharing_settings().get("share_location", False):
            return obj.geolocation_json
        return None

    def get_search_location(self, obj: Photo) -> str:
        if self._get_sharing_settings().get("share_location", False):
            search = _search_instance(obj)
            if search:
                return search.search_location or ""
        return ""

    # Camera info - conditional
    def get_camera(self, obj: Photo) -> str | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.camera_display if metadata else None

    def get_lens(self, obj: Photo) -> str | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.lens_display if metadata else None

    def get_focal_length(self, obj: Photo) -> float | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.focal_length if metadata else None

    def get_fstop(self, obj: Photo) -> float | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.aperture if metadata else None

    def get_iso(self, obj: Photo) -> int | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.iso if metadata else None

    def get_shutter_speed(self, obj: Photo) -> str | None:
        metadata = self._shared_camera_metadata(obj)
        return metadata.shutter_speed if metadata else None

    # 0 also for a size the metadata does not know (stored as NULL), as when
    # camera info is not shared: the public client rejects a null here.
    def get_width(self, obj: Photo) -> int:
        metadata = self._shared_camera_metadata(obj)
        return (metadata.width or 0) if metadata else 0

    def get_height(self, obj: Photo) -> int:
        metadata = self._shared_camera_metadata(obj)
        return (metadata.height or 0) if metadata else 0

    # Captions - conditional
    def get_search_captions(self, obj: Photo) -> str:
        if self._get_sharing_settings().get("share_captions", False):
            search = _search_instance(obj)
            if search:
                return search.search_captions or ""
        return ""

    def get_captions_json(self, obj: Photo) -> dict:
        if self._get_sharing_settings().get("share_captions", False):
            caption = _caption_instance(obj)
            if caption and caption.captions_json and len(caption.captions_json) > 0:
                return caption.captions_json
        return {"im2txt": ""}

    # People/faces - conditional
    @extend_schema_field(PublicPhotoPersonSerializer(many=True))
    def get_people(self, obj: Photo) -> list[dict[str, Any]]:
        if not self._get_sharing_settings().get("share_faces", False):
            return []

        return [
            {
                "name": person.name,
                "face_url": face.crop_url,
                "face_id": face.id,
            }
            for face in obj.faces.all()
            if not face.deleted and (person := face.person or face.cluster_person)
        ]


class PhotoSelectionRequest(serializers.Serializer[None]):
    """The photos a bulk action applies to.

    Either ``image_hashes``, or ``select_all`` with a filter ``query`` (see
    ``api.photos.selection.build_photo_queryset``) minus ``excluded_hashes``.
    """

    select_all = JsonBooleanField(
        default=False, help_text="Apply to every photo the query matches"
    )
    query = serializers.DictField(
        default=dict, help_text="The photo filter, with select_all"
    )
    excluded_hashes = serializers.ListField(
        child=JsonStringField(),
        default=list,
        help_text="Photos the query matches that are left out, with select_all",
    )
    image_hashes = serializers.ListField(
        child=JsonStringField(),
        required=False,
        help_text="The photos, without select_all",
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs["select_all"] and "image_hashes" not in attrs:
            raise serializers.ValidationError(
                {"image_hashes": "Expected a list of hashes, or select_all."}
            )
        return attrs


class SetPhotosDeletedRequest(PhotoSelectionRequest):
    deleted = JsonBooleanField(help_text="true moves to the trash, false restores")


class SetPhotosFavoriteRequest(PhotoSelectionRequest):
    favorite = JsonBooleanField()


class SetPhotosHiddenRequest(PhotoSelectionRequest):
    hidden = JsonBooleanField()


class SetPhotosArchivedRequest(PhotoSelectionRequest):
    archived = JsonBooleanField(
        help_text="true takes the photos off the timeline and Memories, "
        "false puts them back"
    )


class SetPhotosPublicRequest(PhotoSelectionRequest):
    val_public = JsonBooleanField()


class SetPhotosRatingRequest(PhotoSelectionRequest):
    rating = JsonIntegerField(min_value=0, max_value=5, help_text="0 (none) to 5")


class SetPhotosCategoryRequest(PhotoSelectionRequest):
    category = serializers.ChoiceField(
        choices=["photo", "screenshot", "document", "auto"],
        help_text='"auto" hands the photos back to the detectors',
    )


class SetPhotosSharedRequest(PhotoSelectionRequest):
    val_shared = JsonBooleanField(help_text="true shares, false unshares")
    target_user_id = serializers.IntegerField()


class PhotoCaptionRequest(serializers.Serializer[None]):
    image_hash = JsonStringField()


class SavePhotoCaptionRequest(PhotoCaptionRequest):
    caption = JsonStringField()


class SetMainFileRequest(serializers.Serializer[None]):
    file_hash = required_string("file_hash is required")


#: The ``types`` of "Write metadata to files" (``api.metadata.library_write``).
METADATA_WRITE_TYPES = list(WRITE_TYPES)
#: Where it writes: "Write edits to files" as the preview names it.
METADATA_WRITE_TARGETS = ["sidecar", "media_file"]


class SaveMetadataRequest(serializers.Serializer[None]):
    """``POST /api/savemetadata/``: what the "Write metadata to files" job writes."""

    types = serializers.ListField(
        child=serializers.ChoiceField(choices=METADATA_WRITE_TYPES),
        required=False,
        allow_empty=False,
        help_text=(
            "What to write; by default everything the requester's settings write "
            '("face_tags" only with "Write face tags to image files" on)'
        ),
    )


@extend_schema_field(OpenApiTypes.INT)
class RotationAngleField(serializers.Field[int, str | int | float, int, Any]):
    """Degrees counter-clockwise, a multiple of 90; a number or a numeric string.

    Read with ``int()``, so a float is truncated (90.7 is 90).
    """

    def to_internal_value(self, data: str | int | float) -> int:
        try:
            if not isinstance(data, (str, int, float)):
                raise TypeError(data)
            angle = int(data)
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError("angle must be an integer") from error
        if angle % 90 != 0:
            raise serializers.ValidationError("angle must be a multiple of 90 degrees")
        return angle

    def to_representation(self, value: int) -> int:
        return value


class RotatePhotoRequest(serializers.Serializer[None]):
    image_hash = required_string("image_hash is required")
    angle = RotationAngleField(
        default=0,
        error_messages={"null": "angle must be an integer"},
        help_text=(
            "Degrees counter-clockwise as the photo is shown, a multiple of 90: "
            "90 turns it left, -90 right"
        ),
    )
    flip_horizontal = serializers.BooleanField(default=False)


class RotatePhotoResponse(serializers.Serializer[None]):
    """The answer of POST /api/photosedit/rotate/: the photo's new orientation."""

    status = serializers.BooleanField()
    image_hash = serializers.CharField()
    local_orientation = serializers.IntegerField(
        help_text=(
            "The new orientation code, 1 to 8. Numbered like EXIF Orientation, "
            "but 6 and 8 render swapped: 6 is a quarter turn counter-clockwise, "
            "8 clockwise"
        )
    )
    last_modified = serializers.DateTimeField()
    write_error = serializers.CharField(
        allow_null=True,
        help_text=(
            "Why the edit, saved in LibrePhotos, was not written to the file or "
            "its sidecar; null when it was written or writing is off (#2294)"
        ),
    )


class StatusResponse(serializers.Serializer[None]):
    """``{"status": true}``: done. A failure is an error status, not false.

    The answer of the caption views (generate, save)."""

    status = serializers.BooleanField(help_text="Always true")


class BulkPhotoMutationResponse(serializers.Serializer[None]):
    """The answer of the bulk photo edits (``BulkPhotoMutationView``) and of
    sharing photos with a user (``SetPhotosShared``)."""

    status = serializers.BooleanField(help_text="Always true")
    count = serializers.IntegerField(help_text="The photos changed")
    updated_hashes = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="The photos changed; for image_hashes, not for select_all or sharing",
    )
    not_updated_hashes = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="The photos that already had the value; for image_hashes, "
        "not for select_all or sharing",
    )


class DeletePhotosResponse(serializers.Serializer[None]):
    """The answer of DELETE /api/photosedit/delete/ (trashed photos deleted for
    good): the hashes for image_hashes, the counts for select_all."""

    status = serializers.BooleanField(help_text="Always true")
    deleted = serializers.ListField(
        child=serializers.CharField(), required=False, help_text="image_hashes only"
    )
    results = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="image_hashes only: the same as deleted",
    )
    not_deleted = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="image_hashes only: unknown, not the requester's, not in the "
        "trash, or the files could not be removed",
    )
    count = serializers.IntegerField(
        required=False, help_text="select_all only: the photos deleted"
    )
    failed_count = serializers.IntegerField(
        required=False,
        help_text="select_all only: the photos whose files could not be removed",
    )


class SetMainFileResponse(serializers.Serializer[None]):
    """The answer of POST /api/photos/{image_hash}/main-file/."""

    status = serializers.CharField(help_text='Always "updated"')
    main_file_hash = serializers.CharField()


class WriteMetadataStartedSerializer(serializers.Serializer[None]):
    """``POST /api/savemetadata/`` (202): the "Write metadata to files" job was queued."""

    job_id = serializers.CharField()
    types = serializers.ListField(
        child=serializers.ChoiceField(choices=METADATA_WRITE_TYPES),
        help_text="What the job writes",
    )


class WriteTypeCountSerializer(serializers.Serializer[None]):
    type = serializers.ChoiceField(choices=METADATA_WRITE_TYPES)
    photos = serializers.IntegerField(help_text="Photos with a value of this type")


class WriteMetadataPreviewSerializer(serializers.Serializer[None]):
    """``GET /api/savemetadata/``: what the job would write for the requester now."""

    target = serializers.ChoiceField(
        choices=METADATA_WRITE_TARGETS,
        allow_null=True,
        help_text='Where it writes, from "Write edits to files"; null while that is Off',
    )
    counts = WriteTypeCountSerializer(
        many=True, help_text="Each type the requester's settings write"
    )
    total = serializers.IntegerField(help_text="Photos the job would write")


SHARE_ACTIONS = ("enable", "rotate", "disable")


class SetPhotoShareRequest(serializers.Serializer[None]):
    """Create, rotate or disable the public link of one photo."""

    photo_id = JsonStringField(help_text="The photo's id or image hash")
    action = serializers.CharField(
        default="enable",
        allow_blank=True,
        allow_null=True,
        trim_whitespace=False,
        help_text="enable (the default), rotate or disable; any case",
    )

    def validate_photo_id(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError(
                "This field may not be blank.", code="blank"
            )
        return value

    def validate_action(self, value: str | None) -> str:
        action = (value or "enable").lower()
        if action not in SHARE_ACTIONS:
            raise serializers.ValidationError("Unknown action")
        return action
