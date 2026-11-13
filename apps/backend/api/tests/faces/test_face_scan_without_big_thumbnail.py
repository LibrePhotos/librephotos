"""A photo whose big thumbnail could not be made is skipped by face detection.

Its thumbnail failed earlier (an unreadable file, ffmpeg out of memory), so
the row names no big thumbnail, or names one that is not on disk. Face
detection reads that picture: it used to raise ``ValueError`` or
``FileNotFoundError`` for the photo on every Scan Faces and on the upload
path. The photo is left unscanned, and the scan that makes its thumbnail
puts it back on the next incremental Scan Faces.
"""

from unittest.mock import patch

from django.test import TestCase, override_settings

from api.faces import extractor
from api.faces.photo_faces import extract_faces
from api.models import Photo, Thumbnail
from api.runtime import sidecars
from api.tests.utils import create_test_photo, create_test_user


@override_settings(FEATURE_FACE_DETECTION=True)
class FaceScanWithoutBigThumbnailTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def _assert_skipped(self, photo: Photo) -> None:
        with (
            patch.object(extractor, "extract_from_exif") as regions,
            patch.object(sidecars.http, "post") as post,
            self.assertLogs("api.faces.photo_faces", "WARNING") as logs,
        ):
            extract_faces(photo)

        regions.assert_not_called()
        post.assert_not_called()
        self.assertIn(photo.image_hash, logs.output[0])
        self.assertIsNone(Photo.objects.get(pk=photo.pk).faces_scanned_at)

    def test_a_photo_whose_row_names_no_big_thumbnail_is_skipped(self) -> None:
        photo = create_test_photo(owner=self.user, thumbnail_big="")

        self._assert_skipped(photo)

    def test_a_photo_whose_big_thumbnail_is_not_on_disk_is_skipped(self) -> None:
        photo = create_test_photo(owner=self.user)

        self._assert_skipped(photo)

    def test_a_photo_without_a_thumbnail_row_is_skipped(self) -> None:
        photo = create_test_photo(owner=self.user)
        Thumbnail.objects.filter(photo=photo).delete()

        self._assert_skipped(Photo.objects.get(pk=photo.pk))
