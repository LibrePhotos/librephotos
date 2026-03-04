import secrets
import uuid
from typing import Any

import numpy as np
from django.utils import timezone
from faker import Faker

from api.models import Cluster, Face, File, Person, Photo, User

fake = Faker()

ONE_PIXEL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\xb1\x1e\x28"
    b"\x00\x00\x00\x03PLTE\xff\xff\xff\xff\xff\xff\x00\x00\x00\x00IEND\xaeB`\x82"
)


def create_password():
    return secrets.token_urlsafe(10)


def create_user_details(is_admin=False):
    return {
        "username": fake.user_name(),
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "email": fake.email(),
        "password": create_password(),
        "is_superuser": is_admin,
    }


def create_test_person(
    name: str | None = None,
    kind: str | None = Person.KIND_USER,
    cover_photo: Photo | None = None,
    cover_face: Face | None = None,
    face_count: int = 0,
    cluster_owner: User | None = None,
    **kwargs: Any,
) -> Person:
    """Create a test Person object with random data using Faker."""
    return Person.objects.create(
        name=name or fake.name(),
        kind=kind,
        cover_photo=cover_photo,
        cover_face=cover_face,
        face_count=face_count,
        cluster_owner=cluster_owner,
        **kwargs,
    )


def create_test_face(
    photo: Photo | None = None,
    image: str | None = "test.jpg",
    person: Person | None = None,
    classification_person: Person | None = None,
    classification_probability: float = 0.0,
    cluster_person: Person | None = None,
    cluster_probability: float = 0.0,
    deleted: bool = False,
    cluster: Cluster | None = None,
    location_top: int = 0,
    location_bottom: int = 0,
    location_left: int = 0,
    location_right: int = 0,
    encoding: str | None = None,
    **kwargs: Any,
) -> Face:
    """Create a test Face object with random data using Faker."""
    return Face.objects.create(
        photo=photo,
        image=image,
        person=person,
        classification_person=classification_person,
        classification_probability=classification_probability
        or fake.pyfloat(min_value=0, max_value=1),
        cluster_person=cluster_person,
        cluster_probability=cluster_probability
        or fake.pyfloat(min_value=0, max_value=1),
        deleted=deleted,
        cluster=cluster,
        location_top=location_top or fake.random_int(min=0, max=500),
        location_bottom=location_bottom or fake.random_int(min=501, max=1000),
        location_left=location_left or fake.random_int(min=0, max=500),
        location_right=location_right or fake.random_int(min=501, max=1000),
        encoding=encoding or np.random.rand(128).tobytes().hex(),
        **kwargs,
    )


def create_test_user(is_admin=False, public_sharing=False, **kwargs):
    import uuid

    # Ensure unique username by appending UUID
    username = fake.user_name() + str(uuid.uuid4())[:8]
    return User.objects.create(
        username=username,
        first_name=fake.first_name(),
        last_name=fake.last_name(),
        email=fake.email(),
        password=create_password(),
        public_sharing=public_sharing,
        is_superuser=is_admin,
        is_staff=is_admin,
        **kwargs,
    )


def create_test_photo(**kwargs):
    from api.models.thumbnail import Thumbnail
    from api.models.photo_caption import PhotoCaption
    from api.models.photo_search import PhotoSearch
    from api.models.photo_metadata import PhotoMetadata

    # Use proper UUID for primary key (Photo model now uses UUIDField)
    pk = uuid.uuid4()
    # Use MD5 for image_hash (content hash for deduplication)
    image_hash = fake.md5()

    # Extract fields that are no longer part of Photo model
    aspect_ratio = kwargs.pop("aspect_ratio", 1)
    is_video = kwargs.get("video", False)
    square_ext = ".mp4" if is_video else ".webp"
    thumbnail_big = kwargs.pop("thumbnail_big", f"thumbnails_big/{image_hash}.webp")
    square_thumbnail = kwargs.pop(
        "square_thumbnail", f"square_thumbnails/{image_hash}{square_ext}"
    )
    square_thumbnail_small = kwargs.pop(
        "square_thumbnail_small", f"square_thumbnails_small/{image_hash}{square_ext}"
    )
    dominant_color = kwargs.pop("dominant_color", None)

    # Extract caption and search fields
    captions_json = kwargs.pop("captions_json", None)
    search_captions = kwargs.pop("search_captions", None)
    search_location = kwargs.pop("search_location", None)

    # Extract metadata fields that are now in PhotoMetadata model
    # Map old field names to new PhotoMetadata field names
    metadata_field_mapping = {
        "camera": "camera_model",  # Old 'camera' -> new 'camera_model'
        "lens": "lens_model",  # Old 'lens' -> new 'lens_model'
        "iso": "iso",
        "fstop": "aperture",  # Old 'fstop' -> new 'aperture'
        "focal_length": "focal_length",
        "shutter_speed": "shutter_speed",
        "focalLength35Equivalent": "focal_length_35mm",
        "digitalZoomRatio": None,  # Not in new model, discard
        "subjectDistance": None,  # Not in new model, discard
        "width": "width",
        "height": "height",
        "orientation": "orientation",
        "gps_lat": "gps_latitude",
        "gps_lon": "gps_longitude",
        "gps_altitude": "gps_altitude",
        # Also support new field names directly
        "camera_make": "camera_make",
        "camera_model": "camera_model",
        "lens_make": "lens_make",
        "lens_model": "lens_model",
        "aperture": "aperture",
        "focal_length_35mm": "focal_length_35mm",
        "gps_latitude": "gps_latitude",
        "gps_longitude": "gps_longitude",
    }
    metadata_fields = {}
    for old_name, new_name in metadata_field_mapping.items():
        if old_name in kwargs:
            value = kwargs.pop(old_name)
            if new_name is not None:  # Skip fields that don't exist in new model
                metadata_fields[new_name] = value

    # Create the photo with remaining kwargs
    photo = Photo(pk=pk, image_hash=image_hash, **kwargs)
    file = create_test_file(f"/tmp/{image_hash}.png", photo.owner, ONE_PIXEL_PNG)
    photo.main_file = file
    if "added_on" not in kwargs.keys():
        photo.added_on = timezone.now()
    photo.save()

    # Create thumbnail for the photo
    Thumbnail.objects.create(
        photo=photo,
        aspect_ratio=aspect_ratio,
        thumbnail_big=thumbnail_big,
        square_thumbnail=square_thumbnail,
        square_thumbnail_small=square_thumbnail_small,
        dominant_color=dominant_color,
    )

    # Create PhotoCaption if captions_json is provided
    if captions_json is not None:
        PhotoCaption.objects.create(photo=photo, captions_json=captions_json)

    # Create PhotoSearch if search fields are provided
    if search_captions is not None or search_location is not None:
        PhotoSearch.objects.create(
            photo=photo,
            search_captions=search_captions,
            search_location=search_location,
        )

    # Create PhotoMetadata if metadata fields are provided
    if metadata_fields:
        PhotoMetadata.objects.create(photo=photo, **metadata_fields)

    return photo


def create_test_photos(number_of_photos=1, **kwargs):
    return [create_test_photo(**kwargs) for _ in range(0, number_of_photos)]


def create_test_photos_with_faces(number_of_photos=1, **kwargs):
    photos = create_test_photos(number_of_photos, **kwargs)
    [create_test_face(photo=photo) for photo in photos]
    return photos


def create_test_file(path: str, user: User, content: bytes):
    with open(path, "wb+") as f:
        f.write(content)
    return File.create(path, user)


def share_test_photos(photo_ids, user):
    """Share photos with a user.

    Args:
        photo_ids: Can be either photo UUIDs (pk) or image_hashes (for backward compatibility)
        user: The user to share photos with
    """
    # Handle both UUID (pk) and image_hash inputs for backward compatibility
    resolved_ids = []
    for photo_id in photo_ids:
        if isinstance(photo_id, uuid.UUID):
            resolved_ids.append(photo_id)
        elif isinstance(photo_id, str):
            # Try to find photo by image_hash
            try:
                photo = Photo.objects.get(image_hash=photo_id)
                resolved_ids.append(photo.pk)
            except Photo.DoesNotExist:
                # Maybe it's a UUID string
                try:
                    resolved_ids.append(uuid.UUID(photo_id))
                except ValueError:
                    raise ValueError(f"Could not resolve photo_id: {photo_id}")
        else:
            resolved_ids.append(photo_id)

    Photo.shared_to.through.objects.bulk_create(
        [
            Photo.shared_to.through(user_id=user.id, photo_id=photo_id)
            for photo_id in resolved_ids
        ]
    )
