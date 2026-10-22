"""``rename_photo_files``: a photo's files get a new name together, or not at all (#2773)."""

import os
import shutil
from unittest.mock import patch

from api.models import File
from api.photos.files import (
    MAX_RENAME_ATTEMPTS,
    MoveError,
    MoveOutcome,
    files_to_move,
    path_key,
    plan_rename,
    rename_photo_files,
)
from api.tests.photos.move_fixtures import LibraryTestCase


class RenamePhotoFilesTest(LibraryTestCase):
    def test_every_file_of_the_photo_gets_the_name_and_the_rows_follow(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        xmp = self.file(self.source, "IMG_1.xmp", File.METADATA_FILE)
        live = self.file(self.source, "IMG_1.MOV", File.VIDEO)
        photo = self.photo(variants=(raw, xmp, live))
        # A write-back sidecar has no row (#2505): it is renamed too.
        self.write(os.path.join(self.source, "IMG_1.jpg.xmp"))
        before = photo.last_modified

        outcome = rename_photo_files(photo, "20250601_233000")

        self.assertIs(MoveOutcome.MOVED, outcome)
        self.assertCountEqual(
            [
                "20250601_233000.jpg",
                "20250601_233000.CR2",
                "20250601_233000.xmp",
                "20250601_233000.MOV",
                "20250601_233000.jpg.xmp",
            ],
            os.listdir(self.source),
        )
        photo.refresh_from_db()
        assert photo.main_file is not None
        self.assertEqual(
            os.path.join(self.source, "20250601_233000.jpg"), photo.main_file.path
        )
        self.assertCountEqual(
            [
                os.path.join(self.source, f"20250601_233000{ext}")
                for ext in (".jpg", ".CR2", ".xmp", ".MOV")
            ],
            photo.files.values_list("path", flat=True),
        )
        self.assertGreater(photo.last_modified, before)

    def test_a_taken_name_gets_the_next_free_number(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        photo = self.photo(variants=(raw,))
        self.write(os.path.join(self.source, "new.jpg"))
        self.write(os.path.join(self.source, "new (1).CR2"))

        outcome = rename_photo_files(photo, "new")

        self.assertIs(MoveOutcome.MOVED, outcome)
        self.assertCountEqual(
            ["new.jpg", "new (1).CR2", "new (2).jpg", "new (2).CR2"],
            os.listdir(self.source),
        )

    def test_the_same_name_is_unchanged(self) -> None:
        photo = self.photo("new.jpg")
        self.assertIs(MoveOutcome.UNCHANGED, rename_photo_files(photo, "new"))
        self.assertEqual(["new.jpg"], os.listdir(self.source))

    def test_a_numbered_name_is_not_moved_along(self) -> None:
        # Renamed before next to a photo of the same second: renaming again
        # must not give it " (2)".
        self.photo("new.jpg")
        numbered = self.photo("new (1).jpg")
        self.assertIs(MoveOutcome.UNCHANGED, rename_photo_files(numbered, "new"))
        self.assertCountEqual(["new.jpg", "new (1).jpg"], os.listdir(self.source))

    def test_a_numbered_name_gets_the_plain_one_when_it_is_free(self) -> None:
        numbered = self.photo("new (1).jpg")
        self.assertIs(MoveOutcome.MOVED, rename_photo_files(numbered, "new"))
        self.assertEqual(["new.jpg"], os.listdir(self.source))

    def test_a_file_named_otherwise_keeps_its_extension(self) -> None:
        other = self.file(self.source, "DSC_9.ARW", File.RAW_FILE)
        photo = self.photo(variants=(other,))
        rename_photo_files(photo, "new")
        self.assertCountEqual(["new.jpg", "new.ARW"], os.listdir(self.source))

    def test_two_files_that_would_share_a_name_are_not_renamed(self) -> None:
        other = self.file(self.source, "DSC_9.jpg")
        photo = self.photo(variants=(other,))
        with self.assertRaises(MoveError):
            rename_photo_files(photo, "new")
        self.assertCountEqual(["IMG_1.jpg", "DSC_9.jpg"], os.listdir(self.source))

    def test_a_failure_halfway_leaves_every_file_under_its_old_name(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        photo = self.photo(variants=(raw,))
        real_move = shutil.move
        calls = []

        def fail_second(source: str, dest: str) -> str:
            calls.append(source)
            if len(calls) == 2:
                raise PermissionError(13, "Permission denied")
            return real_move(source, dest)

        with (
            patch("api.photos.files.shutil.move", side_effect=fail_second),
            self.assertRaises(MoveError),
        ):
            rename_photo_files(photo, "new")
        self.assertCountEqual(["IMG_1.jpg", "IMG_1.CR2"], os.listdir(self.source))
        photo.refresh_from_db()
        assert photo.main_file is not None
        self.assertEqual(os.path.join(self.source, "IMG_1.jpg"), photo.main_file.path)

    def test_files_not_on_disk(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        os.remove(photo.main_file.path)
        with self.assertRaises(MoveError):
            rename_photo_files(photo, "new")

    def test_reserved_names_count_as_taken(self) -> None:
        photo = self.photo()
        sources = files_to_move(photo)
        reserved = {path_key(os.path.join(self.source, "new.jpg"))}
        planned = plan_rename(photo, sources, "new", reserved)
        assert planned is not None
        plan, number = planned
        self.assertEqual(1, number)
        self.assertEqual(
            [os.path.join(self.source, "new (1).jpg")], list(plan.values())
        )

    def test_no_free_name(self) -> None:
        photo = self.photo()
        with (
            patch("api.photos.files.is_taken", return_value=True),
            self.assertRaises(MoveError),
        ):
            plan_rename(photo, files_to_move(photo), "new")
        self.assertGreater(MAX_RENAME_ATTEMPTS, 0)
