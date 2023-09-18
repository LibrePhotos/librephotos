import secrets

from django.utils import timezone
from faker import Faker

from api.models import Face, File, Person, Photo, User

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


def create_test_face(**kwargs):
    person = Person()
    person.save()
    face = Face(
        person=person,
        location_left=0,
        location_right=1,
        location_top=0,
        location_bottom=1,
        **kwargs,
    )
    face.save()
    return face


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
