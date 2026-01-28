import json

from rest_framework import serializers

from api.geocode.geocode import reverse_geocode
from api.geocode import GEOCODE_VERSION
from api import util

from api.image_similarity import search_similar_image
from api.models import AlbumDate, File, Photo
from api.models.photo_metadata import PhotoMetadata
from api.serializers.photo_metadata import PhotoMetadataSummarySerializer
from api.serializers.simple import SimpleUserSerializer


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
            "rating",
            "owner",
            "exif_gps_lat",
            "exif_gps_lon",
            "removed",
            "in_trashcan",
            "stacks",
            "has_raw_variant",
        )

    # TODO: Rename this field to aspect_ratio
    def get_aspectRatio(self, obj) -> float:
        return obj.thumbnail.aspect_ratio

    # TODO: Remove this field in the future (kept for backwards compatibility)
    def get_url(self, obj) -> str:
        return obj.image_hash

    def get_location(self, obj) -> str:
        if (
            hasattr(obj, "search_instance")
            and obj.search_instance
            and obj.search_instance.search_location
        ):
            return obj.search_instance.search_location
        else:
            return ""

    def get_date(self, obj) -> str:
        if obj.exif_timestamp:
            return obj.exif_timestamp.isoformat()
        else:
            return ""

    def get_video_length(self, obj) -> int:
        if obj.video_length:
            return obj.video_length
        else:
            return ""

    # TODO: Remove this field in the future
    def get_birthTime(self, obj) -> str:
        if obj.exif_timestamp:
            return obj.exif_timestamp
        else:
            return ""

    def get_dominantColor(self, obj) -> str:
        if obj.thumbnail.dominant_color:
            dominant_color = obj.thumbnail.dominant_color[1:-1]
            return "#%02x%02x%02x" % tuple(map(int, dominant_color.split(", ")))
        else:
            return ""

    def get_type(self, obj) -> str:
        if obj.video:
            return "video"
        if obj.main_file and obj.main_file.embedded_media.count() > 0:
            return "motion_photo"
        return "image"

    def get_stacks(self, obj) -> list | None:
        """Return stack info if photo is part of any stacks."""
        from api.models.photo_stack import PhotoStack
        # Use model-defined valid stack types, plus deprecated types for backwards compatibility
        valid_stack_types = PhotoStack.VALID_STACK_TYPES + [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ]
        stacks = obj.stacks.filter(stack_type__in=valid_stack_types)
        if not stacks.exists():
            return None
        
        result = []
        for stack in stacks:
            # Check if this photo is the primary
            is_primary = stack.primary_photo_id == obj.pk if stack.primary_photo_id else False
            
            result.append({
                "id": str(stack.id),
                "type": stack.stack_type,
                "photo_count": stack.photos.count(),
                "is_primary": is_primary,
            })
        
        return result

    def get_has_raw_variant(self, obj) -> bool:
        """Check if this photo has a RAW file variant.
        
        This implements the PhotoPrism-like file variant model.
        Returns True if any of the photo's files is a RAW file type.
        """
        # Check files for RAW type (File.RAW_FILE = 4)
        return obj.files.filter(type=4).exists()


class GroupedPhotosSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("date", "location", "items")

    def get_date(self, obj) -> str:
        return obj.date

    def get_location(self, obj) -> str:
        return obj.location

    def get_items(self, obj) -> PhotoSummarySerializer(many=True):
        return PhotoSummarySerializer(obj.photos, many=True).data


class PhotoEditSerializer(serializers.ModelSerializer):
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
        )

    def update(self, instance, validated_data):
        # photo can only update the following
        if "exif_timestamp" in validated_data:
            instance.timestamp = validated_data.pop("exif_timestamp")
            instance.save()
            instance._extract_date_time_from_exif()

        # Update GPS location if provided
        lat = validated_data.pop("exif_gps_lat", None)
        lon = validated_data.pop("exif_gps_lon", None)

        if lat is not None and lon is not None:
            try:
                # Track old places to update album place relations
                old_album_places = instance._find_album_place()

                instance.exif_gps_lat = float(lat)
                instance.exif_gps_lon = float(lon)
                instance.save()

                # Reverse geocode and update geolocation/search location
                geocode_result = reverse_geocode(
                    instance.exif_gps_lat, instance.exif_gps_lon
                )
                if geocode_result:
                    geocode_result["_v"] = GEOCODE_VERSION
                    instance.geolocation_json = geocode_result

                    # Update search location through PhotoSearch model
                    from api.models.photo_search import PhotoSearch

                    search_instance, _created = PhotoSearch.objects.get_or_create(
                        photo=instance
                    )
                    search_instance.update_search_location(geocode_result)
                    search_instance.save()

                    # Update album place relations
                    if old_album_places is not None:
                        for old_album_place in old_album_places:
                            old_album_place.photos.remove(instance)
                            old_album_place.save()

                    if "features" in geocode_result:
                        for geolocation_level, feature in enumerate(
                            geocode_result["features"]
                        ):
                            if (
                                "text" not in feature.keys()
                                or str(feature["text"]).isnumeric()
                            ):
                                continue
                            album_place = api.models.album_place.get_album_place(
                                feature["text"], owner=instance.owner
                            )
                            if (
                                album_place.photos.filter(
                                    image_hash=instance.image_hash
                                ).count()
                                == 0
                            ):
                                album_place.geolocation_level = (
                                    len(geocode_result["features"]) - geolocation_level
                                )
                            album_place.photos.add(instance)
                            album_place.save()

                    instance.save()
                else:
                    util.logger.warning(
                        "Reverse geocoding returned no result for provided coordinates"
                    )
            except Exception as e:
                util.logger.warning(e)
                util.logger.warning("Failed to update GPS location for photo")
        return instance


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

    def get_photo_summary(self, obj) -> PhotoSummarySerializer:
        return PhotoSummarySerializer(obj.get()).data

    def get_processing(self, obj) -> bool:
        return obj.get().thumbnail.aspect_ratio is None

    def get_album_date_id(self, obj) -> int:
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
    shared_to = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
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

    class Meta:
        model = Photo
        fields = (
            "id",
            "exif_gps_lat",
            "exif_gps_lon",
            "exif_timestamp",
            "captions_json",
            "search_captions",
            "search_location",
            "big_thumbnail_url",
            "square_thumbnail_url",
            "small_square_thumbnail_url",
            "geolocation_json",
            "exif_json",
            "people",
            "image_hash",
            "image_path",
            "rating",
            "hidden",
            "public",
            "removed",
            "in_trashcan",
            "shared_to",
            "similar_photos",
            "video",
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
            "embedded_media",
            "file_variants",
            "stacks",
            "metadata",
        )
    
    def _get_metadata(self, obj) -> PhotoMetadata | None:
        """Helper to get PhotoMetadata, with caching."""
        if not hasattr(obj, '_cached_metadata'):
            try:
                obj._cached_metadata = obj.metadata
            except PhotoMetadata.DoesNotExist:
                obj._cached_metadata = None
        return obj._cached_metadata
    
    def get_height(self, obj) -> int:
        metadata = self._get_metadata(obj)
        return metadata.height if metadata else 0
    
    def get_width(self, obj) -> int:
        metadata = self._get_metadata(obj)
        return metadata.width if metadata else 0
    
    def get_focal_length(self, obj) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.focal_length if metadata else None
    
    def get_fstop(self, obj) -> float | None:
        metadata = self._get_metadata(obj)
        return metadata.aperture if metadata else None
    
    def get_iso(self, obj) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.iso if metadata else None
    
    def get_shutter_speed(self, obj) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.shutter_speed if metadata else None
    
    def get_lens(self, obj) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.lens_display if metadata else None
    
    def get_camera(self, obj) -> str | None:
        metadata = self._get_metadata(obj)
        return metadata.camera_display if metadata else None
    
    def get_focalLength35Equivalent(self, obj) -> int | None:
        metadata = self._get_metadata(obj)
        return metadata.focal_length_35mm if metadata else None
    
    def get_digitalZoomRatio(self, obj) -> float | None:
        # Not stored in PhotoMetadata (rarely used field)
        return None
    
    def get_subjectDistance(self, obj) -> float | None:
        # Not stored in PhotoMetadata (rarely used field)
        return None

    def get_similar_photos(self, obj) -> list:
        res = search_similar_image(obj.owner, obj, threshold=90)
        arr = []
        if len(res) > 0:
            [arr.append(e) for e in res["result"]]
            photos = Photo.objects.filter(image_hash__in=arr).all()
            res = []
            for photo in photos:
                type = "image"
                if photo.video:
                    type = "video"
                res.append({"image_hash": photo.image_hash, "type": type})
            return res
        else:
            return []

    def get_captions_json(self, obj) -> dict:
        if (
            hasattr(obj, "caption_instance")
            and obj.caption_instance
            and obj.caption_instance.captions_json
            and len(obj.caption_instance.captions_json) > 0
        ):
            return obj.caption_instance.captions_json
        else:
            emptyArray = {
                "im2txt": "",
                "places365": {"attributes": [], "categories": [], "environment": []},
            }
            return emptyArray

    def get_search_captions(self, obj) -> str:
        if hasattr(obj, "search_instance") and obj.search_instance:
            return obj.search_instance.search_captions or ""
        return ""

    def get_search_location(self, obj) -> str:
        if hasattr(obj, "search_instance") and obj.search_instance:
            return obj.search_instance.search_location or ""
        return ""

    def get_image_path(self, obj) -> list[str]:
        try:
            paths = []
            for file in obj.files.all():
                paths.append(file.path)
            return paths
        except Exception:
            return ["Missing"]

    def get_square_thumbnail_url(self, obj) -> str:
        return (
            obj.thumbnail.square_thumbnail.url if obj.thumbnail.square_thumbnail else ""
        )

    def get_small_square_thumbnail_url(self, obj) -> str:
        return (
            obj.thumbnail.square_thumbnail_small.url
            if obj.thumbnail.square_thumbnail_small
            else ""
        )

    def get_big_thumbnail_url(self, obj) -> str:
        return obj.thumbnail.thumbnail_big.url if obj.thumbnail.thumbnail_big else ""

    def get_geolocation(self, obj) -> dict:
        if obj.geolocation_json:
            return json.loads(obj.geolocation_json)
        else:
            return None

    def get_people(self, obj) -> list:
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
                "face_url": f.image.url,
                "face_id": f.id,
            }
            for f in obj.faces.all()
        ]

    def get_embedded_media(self, obj: Photo) -> list[dict]:
        def serialize_file(file):
            return {
                "id": file.hash,
                "type": "video" if file.type == File.VIDEO else "image",
            }

        if obj.main_file is None:
            return []
        embedded_media = obj.main_file.embedded_media.all()
        if len(embedded_media) == 0:
            return []
        return list(
            map(
                serialize_file, embedded_media.filter(type__in=[File.VIDEO, File.IMAGE])
            )
        )

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
            
            variants.append({
                "hash": f.hash,
                "path": f.path,
                "type": file_type,
                "type_id": f.type,
                "is_main": is_main,
                "filename": f.path.split("/")[-1] if f.path else None,
            })
        
        return variants

    def get_stacks(self, obj: Photo) -> list | None:
        """Return detailed stack info for photo detail view (supports multiple stacks)."""
        from api.models.photo_stack import PhotoStack
        # Use model-defined valid stack types, plus deprecated types for backwards compatibility
        valid_stack_types = PhotoStack.VALID_STACK_TYPES + [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ]
        stacks = obj.stacks.filter(stack_type__in=valid_stack_types)
        if not stacks.exists():
            return None
        
        result = []
        for stack in stacks:
            is_primary = stack.primary_photo_id == obj.pk if stack.primary_photo_id else False
            
            # Get all photos in the stack for the detail view
            stack_photos = []
            for photo in stack.photos.select_related("thumbnail").all():
                # Get width/height from PhotoMetadata
                try:
                    photo_metadata = photo.metadata
                    photo_width = photo_metadata.width or 0
                    photo_height = photo_metadata.height or 0
                except PhotoMetadata.DoesNotExist:
                    photo_width = 0
                    photo_height = 0
                
                stack_photos.append({
                    "id": str(photo.id),
                    "image_hash": photo.image_hash,
                    "is_primary": photo.pk == stack.primary_photo_id,
                    "thumbnail_url": (
                        f"/media/square_thumbnails_small/{photo.image_hash}"
                        if hasattr(photo, "thumbnail") and photo.thumbnail and photo.thumbnail.square_thumbnail_small 
                        else None
                    ),
                    "size": photo.size,
                    "width": photo_width,
                    "height": photo_height,
                })
            
            result.append({
                "id": str(stack.id),
                "type": stack.stack_type,
                "type_display": stack.get_stack_type_display(),
                "photo_count": len(stack_photos),
                "is_primary": is_primary,
                "photos": stack_photos,
            })
        
        return result


class SharedFromMePhotoThroughSerializer(serializers.ModelSerializer):
    photo = serializers.SerializerMethodField()
    user = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo.shared_to.through
        fields = ("user_id", "user", "photo")

    def get_photo(self, obj) -> PhotoSummarySerializer:
        return PhotoSummarySerializer(obj.photo).data
