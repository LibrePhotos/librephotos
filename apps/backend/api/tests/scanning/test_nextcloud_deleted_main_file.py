import os
import uuid

from django.test import TestCase

from api.models import File, Photo
from api.tests.utils import create_test_file, create_test_photo, create_test_user
from nextcloud import directory_watcher


class NextcloudDeletedMainFileTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.scope = os.path.join(os.sep, "nextcloud", uuid.uuid4().hex)

    def _file(self, name: str, file_type: int = File.IMAGE) -> File:
        return create_test_file(
            os.path.join(self.scope, name), self.user, file_type=file_type
        )

    def _photo(self, main_file: File, *others: File) -> Photo:
        photo = create_test_photo(owner=self.user, main_file=main_file)
        photo.files.add(main_file, *others)
        return photo

    def test_a_raw_still_on_the_server_stands_in_for_the_deleted_jpeg(self):
        jpg = self._file("IMG_1.jpg")
        raw = self._file("IMG_1.cr2", File.RAW_FILE)
        photo = self._photo(jpg, raw)

        flagged = directory_watcher.detach_deleted_files(
            self.user, self.scope, {raw.path}
        )

        self.assertEqual(flagged, 1)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertEqual(list(photo.files.all()), [raw])
        self.assertTrue(File.objects.get(pk=jpg.pk).missing)
        self.assertNotIn(photo, Photo.objects.owned_by(self.user).missing())

    def test_a_photo_with_only_its_sidecar_left_is_missing(self):
        jpg = self._file("IMG_2.jpg")
        xmp = self._file("IMG_2.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)

        directory_watcher.detach_deleted_files(self.user, self.scope, {xmp.path})

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, jpg)
        self.assertIn(photo, Photo.objects.owned_by(self.user).missing())
