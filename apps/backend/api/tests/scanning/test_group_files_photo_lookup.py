from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.directory_watcher import file_handlers
from api.directory_watcher.file_handlers import group_files_into_photo
from api.models import File, Photo
from api.tests.utils import create_test_file, create_test_photo, create_test_user

MODULE = "api.directory_watcher.file_handlers"


def _ors_across_the_files_table(queries: list[str]) -> list[str]:
    return [
        sql
        for sql in queries
        if sql.startswith("SELECT") and "api_photo_files" in sql and " OR " in sql
    ]


class GroupFilesPhotoLookupTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        for name in ("_adopt_files_into_photo", "_attach_embedded_motion_video"):
            patcher = patch(f"{MODULE}.{name}", return_value=False)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _group(self, *files: File) -> tuple[Photo | None, list[str]]:
        with CaptureQueriesContext(connection) as ctx:
            photo = group_files_into_photo(self.user, list(files), "job-712")
        return photo, [query["sql"] for query in ctx.captured_queries]

    def test_no_lookup_ors_across_the_files_table(self) -> None:
        create_test_photo(owner=self.user)

        _, queries = self._group(create_test_file(None, self.user))

        self.assertEqual([], _ors_across_the_files_table(queries))

    def test_the_photo_of_a_path_is_found_without_an_or_either(self) -> None:
        photo = create_test_photo(owner=self.user)

        with CaptureQueriesContext(connection) as ctx:
            found = file_handlers._photo_of_path(self.user, photo.main_file.path)

        self.assertEqual(photo.pk, found.pk if found else None)
        queries = [query["sql"] for query in ctx.captured_queries]
        self.assertEqual([], _ors_across_the_files_table(queries))

    def test_a_photo_holding_the_file_as_a_variant_is_found(self) -> None:
        photo = create_test_photo(owner=self.user)
        raw = create_test_file(None, self.user, file_type=File.RAW_FILE)
        photo.files.add(raw)

        found, _ = self._group(raw)

        self.assertEqual(photo.pk, found.pk if found else None)

    def test_a_photo_with_the_file_as_its_main_file_only_is_found(self) -> None:
        photo = create_test_photo(owner=self.user)
        photo.files.clear()

        found, _ = self._group(photo.main_file)

        self.assertEqual(photo.pk, found.pk if found else None)

    def test_the_first_of_several_photos_is_taken(self) -> None:
        first, second = sorted(
            (create_test_photo(owner=self.user) for _ in range(2)),
            key=lambda photo: photo.pk,
        )
        jpeg = create_test_file(None, self.user)
        raw = create_test_file(None, self.user, file_type=File.RAW_FILE)
        second.files.add(jpeg)
        first.main_file = raw
        first.save(update_fields=["main_file"])
        first.files.clear()

        found, _ = self._group(jpeg, raw)

        self.assertEqual(first.pk, found.pk if found else None)

    def test_another_users_photo_is_not_found(self) -> None:
        theirs = create_test_photo(owner=create_test_user())

        found, _ = self._group(theirs.main_file)

        self.assertNotEqual(theirs.pk, found.pk if found else None)
