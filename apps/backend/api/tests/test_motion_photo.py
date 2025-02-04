from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User
from api.models.file import (
    GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES,
    JPEG_EOI_MARKER,
    SAMSUNG_MOTION_PHOTO_MARKER,
    File,
    extract_embedded_media,
    has_embedded_media,
)
from api.tests.utils import create_test_photo, create_test_user


def create_test_file(path: str, user: User, content: bytes):
    with open(path, "wb+") as f:
        f.write(content)
    return File.create(path, user)


JPEG_MAGIC_NUMBER = b"\xff\xd8\xff"
JPEG = JPEG_MAGIC_NUMBER + b"\xde\xad\xfa\xce" + JPEG_EOI_MARKER
MP4_DATA = b"\xca\xfe\xfe\xed"
MP4_PREFIX = b"\x00\x00\x00\x18"
MP4 = MP4_PREFIX + b"ftypmp42" + MP4_DATA
RANDOM_BYTES = b"\x13\x37\xc0\xde"


@override_settings(MEDIA_ROOT="/tmp")
class MotionPhotoTest(TestCase):
    def setUp(self):
        self.test_image_path = "/tmp/test_file.jpeg"
        self.test_video_path = "/tmp/test_file.mp4"
        self.user = create_test_user()
        self.client = APIClient()

    def test_should_not_process_non_jpeg_files(self):
        file = create_test_file(self.test_video_path, self.user, MP4)
        actual = has_embedded_media(file)
        self.assertFalse(actual)

    def test_google_pixel_motion_photo_signatures(self):
        for signature in GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES:
            content = JPEG + MP4_PREFIX + signature + MP4_DATA
            file = create_test_file(self.test_image_path, self.user, content)
            actual = has_embedded_media(file)
            self.assertTrue(actual)

    def test_samsung_motion_photo_signature(self):
        content = JPEG + SAMSUNG_MOTION_PHOTO_MARKER + MP4_DATA
        file = create_test_file(self.test_image_path, self.user, content)
        actual = has_embedded_media(file)
        self.assertTrue(actual)

    def test_other_content_should_not_report_as_having_embedded_media(self):
        file = create_test_file(self.test_image_path, self.user, RANDOM_BYTES)
        actual = has_embedded_media(file)
        self.assertFalse(actual)

    def test_extract_embedded_media_from_google_motion_photo(self):
        for signature in GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES:
            content = JPEG + MP4_PREFIX + signature + MP4_DATA
            file = create_test_file(self.test_image_path, self.user, content)
            path = extract_embedded_media(file)
            expected = f"{settings.MEDIA_ROOT}/embedded_media/{file.hash}_1.mp4"
            self.assertEqual(path, expected)
            with open(path, "rb") as f:
                contents = f.read()
                self.assertEqual(MP4_PREFIX + signature + MP4_DATA, contents)

    def test_extract_embedded_media_from_samsung_motion_photo(self):
        content = JPEG + SAMSUNG_MOTION_PHOTO_MARKER + MP4
        file = create_test_file(self.test_image_path, self.user, content)
        path = extract_embedded_media(file)
        expected = f"{settings.MEDIA_ROOT}/embedded_media/{file.hash}_1.mp4"
        self.assertEqual(expected, path)
        with open(path, "rb+") as f:
            contents = f.read()
            self.assertEqual(MP4, contents)

    def test_fetch_embedded_media_as_owner(self):
        self.client.force_authenticate(user=self.user)
        embedded_media = create_test_file(self.test_video_path, self.user, MP4)
        photo = create_test_photo(owner=self.user)
        photo.main_file.embedded_media.add(embedded_media)
        response = self.client.get(f"/media/embedded_media/{photo.pk}")
        self.assertEqual(response.status_code, 200)

    def test_fetch_embedded_media_as_anonymous_when_photo_is_public(self):
        self.client.force_authenticate(user=None)
        embedded_media = create_test_file(self.test_video_path, self.user, MP4)
        photo = create_test_photo(owner=self.user, public=True)
        photo.main_file.embedded_media.add(embedded_media)

        response = self.client.get(f"/media/embedded_media/{photo.pk}")
        self.assertEqual(response.status_code, 200)

    def test_fetch_embedded_media_as_anonymous_when_photo_is_private(self):
        self.client.force_authenticate(user=None)
        embedded_media = create_test_file(self.test_video_path, self.user, MP4)
        photo = create_test_photo(owner=self.user, public=False)
        photo.main_file.embedded_media.add(embedded_media)

        response = self.client.get(f"/media/embedded_media/{photo.pk}")
        self.assertEqual(response.status_code, 404)

    def test_fetch_embedded_media_when_photo_does_not_have_embedded_media(self):
        self.client.force_authenticate(user=self.user)
        photo = create_test_photo(owner=self.user)

        response = self.client.get(f"/media/embedded_media/{photo.pk}")
        self.assertEqual(response.status_code, 404)
