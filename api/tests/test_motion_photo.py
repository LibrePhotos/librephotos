from django.test import TestCase

from api.models.file import (
    GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES,
    JPEG_EOI_MARKER,
    SAMSUNG_MOTION_PHOTO_MARKER,
    extract_embedded_media,
    has_embedded_media,
)


def create_test_file(path: str, content: bytes):
    with open(path, "w+b") as f:
        f.write(content)


JPEG = b"\xDE\xAD\xFA\xCE" + JPEG_EOI_MARKER
MP4_DATA = b"\xCA\xFE\xFE\xED"
MP4_PREFIX = b"\x00\x00\x00\x18"
MP4 = MP4_PREFIX + b"ftypmp42" + MP4_DATA
RANDOM_BYTES = b"\x13\x37\xC0\xDE"


class MotionPhotoTest(TestCase):
    test_file_path = "/tmp/test_image.jpeg"
    embedded_file_path = "/tmp/test_image_embedded.mp4"

    def test_google_pixel_motion_photo_signatures(self):
        for signature in GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES:
            content = JPEG + MP4_PREFIX + signature + MP4_DATA
            create_test_file(self.test_file_path, content)
            actual = has_embedded_media(self.test_file_path)
            self.assertTrue(actual)

    def test_samsung_motion_photo_signature(self):
        content = JPEG + SAMSUNG_MOTION_PHOTO_MARKER + MP4_DATA
        create_test_file(self.test_file_path, content)
        actual = has_embedded_media(self.test_file_path)
        self.assertTrue(actual)

    def test_other_content_should_not_report_as_having_embedded_media(self):
        create_test_file(self.test_file_path, RANDOM_BYTES)
        actual = has_embedded_media(self.test_file_path)
        self.assertFalse(actual)

    def test_should_throw_when_file_does_not_exist_when_checking_for_embedded_media(
        self,
    ):
        def run():
            has_embedded_media("/path/does/not/exist")

        self.assertRaises(FileNotFoundError, run)

    def test_extract_embedded_media_from_google_motion_photo(self):
        for signature in GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES:
            content = JPEG + MP4_PREFIX + signature + MP4_DATA
            create_test_file(self.test_file_path, content)
            embedded_media_path = extract_embedded_media(self.test_file_path)
            self.assertEqual(self.embedded_file_path, embedded_media_path)
            with open(embedded_media_path, "rb+") as f:
                contents = f.read()
                self.assertEqual(MP4_PREFIX + signature + MP4_DATA, contents)

    def test_extract_embedded_media_from_samsung_motion_photo(self):
        content = JPEG + SAMSUNG_MOTION_PHOTO_MARKER + MP4
        create_test_file(self.test_file_path, content)
        embedded_media_path = extract_embedded_media(self.test_file_path)
        self.assertEqual(self.embedded_file_path, embedded_media_path)
        with open(embedded_media_path, "rb+") as f:
            contents = f.read()
            self.assertEqual(MP4, contents)

    def test_extract_from_file_that_does_not_have_embedded_media(self):
        create_test_file(self.test_file_path, JPEG)
        embedded_media_path = extract_embedded_media(self.test_file_path)
        self.assertIsNone(embedded_media_path)

    def test_should_throw_when_file_does_not_exist_when_extracting_embedded_media(self):
        def run():
            extract_embedded_media("/path/does/not/exist")

        self.assertRaises(Exception, run)
