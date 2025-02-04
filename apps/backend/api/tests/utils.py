import secrets
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
    return User.objects.create(
        username=fake.user_name(),
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
    pk = fake.md5()
    if "aspect_ratio" not in kwargs.keys():
        kwargs["aspect_ratio"] = 1
    photo = Photo(pk=pk, image_hash=pk, **kwargs)
    file = create_test_file(f"/tmp/{pk}.png", photo.owner, ONE_PIXEL_PNG)
    photo.main_file = file
    if "added_on" not in kwargs.keys():
        photo.added_on = timezone.now()
    photo.save()
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
    Photo.shared_to.through.objects.bulk_create(
        [
            Photo.shared_to.through(user_id=user.id, photo_id=photo_id)
            for photo_id in photo_ids
        ]
    )
