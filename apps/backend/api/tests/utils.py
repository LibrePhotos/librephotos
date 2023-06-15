import secrets

from django.utils import timezone
from faker import Faker

from api.models import File, Photo, User

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
    photo = Photo(pk=pk, image_hash=pk, aspect_ratio=1, **kwargs)
    file = create_test_file(f"/tmp/{pk}.png", photo.owner, ONE_PIXEL_PNG)
    photo.main_file = file
    if "added_on" not in kwargs.keys():
        photo.added_on = timezone.now()
    photo.save()
    return photo


def create_test_photos(number_of_photos=1, **kwargs):
    return [create_test_photo(**kwargs) for _ in range(0, number_of_photos)]


def create_test_file(path: str, user: User, content: bytes):
    return File.create(path, user)


def share_test_photos(photo_ids, user):
    Photo.shared_to.through.objects.bulk_create(
        [
            Photo.shared_to.through(user_id=user.id, photo_id=photo_id)
            for photo_id in photo_ids
        ]
    )
