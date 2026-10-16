"""``move_photo_files``: a photo's files move together, or not at all (#352)."""

import os
import shutil
from unittest.mock import patch

from api.models import File
from api.models.photo_search import PhotoSearch
from api.photos import indexed_mtimes
from api.photos.files import (
    MoveError,
    MoveOutcome,
    files_to_move,
    move_photo_files,
)
from api.tests.photos.move_fixtures import LibraryTestCase
from api.tests.utils import create_test_file


class MovePhotoFilesTest(LibraryTestCase):
    def test_every_file_of_the_photo_moves_and_the_rows_follow(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        xmp = self.file(self.source, "IMG_1.xmp", File.METADATA_FILE)
        live = self.file(self.source, "IMG_1.MOV", File.VIDEO)
        photo = self.photo(variants=(raw, xmp, live))
        # A write-back sidecar has no row (#2505): it moves too.
        self.write(os.path.join(self.source, "IMG_1.jpg.xmp"))
        before = photo.last_modified

        outcome = move_photo_files(photo, self.target, "skip")

        self.assertIs(MoveOutcome.MOVED, outcome)
        self.assertEqual([], os.listdir(self.source))
        self.assertCountEqual(
            ["IMG_1.jpg", "IMG_1.CR2", "IMG_1.xmp", "IMG_1.MOV", "IMG_1.jpg.xmp"],
            os.listdir(self.target),
        )
        photo.refresh_from_db()
        assert photo.main_file is not None
        self.assertEqual(os.path.join(self.target, "IMG_1.jpg"), photo.main_file.path)
        self.assertCountEqual(
            [
                os.path.join(self.target, name)
                for name in ("IMG_1.jpg", "IMG_1.CR2", "IMG_1.xmp", "IMG_1.MOV")
            ],
            photo.files.values_list("path", flat=True),
        )
        self.assertGreater(photo.last_modified, before)

    def test_a_file_outside_the_photos_folder_stays(self) -> None:
        # A Motion Photo's video, extracted into protected_media.
        elsewhere = self.file(self.folder("extracted"), "abc_motion.mp4", File.VIDEO)
        photo = self.photo(variants=(elsewhere,))

        move_photo_files(photo, self.target, "skip")

        elsewhere.refresh_from_db()
        self.assertEqual(
            os.path.join(self.root, "extracted", "abc_motion.mp4"), elsewhere.path
        )
        self.assertTrue(os.path.isfile(elsewhere.path))

    def test_a_taken_name_renames_every_file_of_the_photo_alike(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        photo = self.photo(variants=(raw,))
        self.write(os.path.join(self.source, "IMG_1.jpg.xmp"))
        self.write(os.path.join(self.target, "IMG_1.jpg"))
        self.write(os.path.join(self.target, "IMG_1 (1).CR2"))

        outcome = move_photo_files(photo, self.target, "rename")

        self.assertIs(MoveOutcome.MOVED, outcome)
        self.assertCountEqual(
            [
                "IMG_1.jpg",
                "IMG_1 (1).CR2",
                "IMG_1 (2).jpg",
                "IMG_1 (2).CR2",
                "IMG_1 (2).jpg.xmp",
            ],
            os.listdir(self.target),
        )
        photo.refresh_from_db()
        assert photo.main_file is not None
        self.assertEqual("IMG_1 (2).jpg", os.path.basename(photo.main_file.path))

    def test_a_name_recorded_in_the_library_counts_as_taken(self) -> None:
        photo = self.photo()
        # A missing file's row still holds the path (File.path is unique).
        create_test_file(
            os.path.join(self.target, "IMG_1.jpg"), self.user, missing=True
        )

        self.assertIs(MoveOutcome.SKIPPED, move_photo_files(photo, self.target, "skip"))
        self.assertTrue(os.path.isfile(os.path.join(self.source, "IMG_1.jpg")))

    def test_skip_leaves_a_photo_whose_name_is_taken(self) -> None:
        photo = self.photo()
        taken = self.write(os.path.join(self.target, "IMG_1.jpg"), b"theirs")

        outcome = move_photo_files(photo, self.target, "skip")

        self.assertIs(MoveOutcome.SKIPPED, outcome)
        with open(taken, "rb") as handle:
            self.assertEqual(b"theirs", handle.read())
        self.assertTrue(os.path.isfile(os.path.join(self.source, "IMG_1.jpg")))

    def test_a_photo_already_in_the_folder_is_unchanged(self) -> None:
        photo = self.photo()
        self.assertIs(
            MoveOutcome.UNCHANGED, move_photo_files(photo, self.source + os.sep, "skip")
        )

    def test_a_failed_file_moves_the_others_back(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        photo = self.photo(variants=(raw,))
        real_move = shutil.move
        calls: list[str] = []

        def flaky(source: str, dest: str) -> str:
            calls.append(source)
            if len(calls) == 2:
                raise PermissionError(13, "Permission denied")
            return real_move(source, dest)

        with patch("api.photos.files.shutil.move", side_effect=flaky):
            with self.assertRaisesMessage(MoveError, "Permission denied"):
                move_photo_files(photo, self.target, "skip")

        self.assertCountEqual(["IMG_1.jpg", "IMG_1.CR2"], os.listdir(self.source))
        self.assertEqual([], os.listdir(self.target))
        raw.refresh_from_db()
        self.assertEqual(os.path.join(self.source, "IMG_1.CR2"), raw.path)

    def test_a_failed_row_update_moves_the_files_back(self) -> None:
        photo = self.photo()
        with patch(
            "api.photos.files.PhotoSearch.objects.filter", side_effect=RuntimeError
        ):
            with self.assertRaises(MoveError):
                move_photo_files(photo, self.target, "skip")

        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))
        photo.refresh_from_db()
        assert photo.main_file is not None
        self.assertEqual(os.path.join(self.source, "IMG_1.jpg"), photo.main_file.path)

    def test_a_photo_without_its_files_on_disk_does_not_move(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        os.remove(photo.main_file.path)
        self.assertEqual([], files_to_move(photo))
        with self.assertRaises(MoveError):
            move_photo_files(photo, self.target, "skip")

    def test_a_scanned_file_stays_scanned_after_a_rename(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        self.write(os.path.join(self.source, "IMG_1.jpg.xmp"))
        indexed_mtimes.record(
            photo.main_file.path, indexed_mtimes.observe(photo.main_file.path)
        )
        self.write(os.path.join(self.target, "IMG_1.jpg"))

        move_photo_files(photo, self.target, "rename")

        moved = os.path.join(self.target, "IMG_1 (1).jpg")
        self.assertEqual([moved], indexed_mtimes.as_indexed([moved]))
        row = File.objects.get(path=moved)
        self.assertEqual(
            [indexed_mtimes.sidecar_key("IMG_1 (1).jpg.xmp")],
            list(row.indexed_sidecar_mtimes or {}),
        )

    def test_a_file_changed_since_the_scan_is_read_again(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        File.objects.filter(pk=photo.main_file.pk).update(
            indexed_mtime_ns=1, indexed_sidecar_mtimes={}
        )

        move_photo_files(photo, self.target, "skip")

        row = File.objects.get(pk=photo.main_file.pk)
        self.assertEqual(1, row.indexed_mtime_ns)

    def test_the_new_folder_is_searchable(self) -> None:
        photo = self.photo()
        PhotoSearch.objects.create(
            photo=photo
        )  # raw-create: the search row the scan makes

        move_photo_files(photo, self.target, "skip")

        search = PhotoSearch.objects.get(photo=photo)
        self.assertIn(
            os.path.join(self.target, "IMG_1.jpg"), search.search_captions or ""
        )
