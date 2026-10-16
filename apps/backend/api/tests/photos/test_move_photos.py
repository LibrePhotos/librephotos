"""Moving a selection inside the owner's library: targets, refusals, the
preview, the folder listing and the job (#352)."""

import os
import uuid
from unittest.mock import patch

from django.test import override_settings

from api.models import File, LongRunningJob, User
from api.photos import moves
from api.photos.moves import InvalidTargetError, library_folders, resolve_target
from api.photos.paths import library_roots
from api.tests.photos.move_fixtures import LibraryTestCase
from api.tests.utils import create_test_job, create_test_photo, create_test_user


class ResolveTargetTest(LibraryTestCase):
    def assert_refused(self, path: str, code: str, user: User | None = None) -> None:
        with self.assertRaises(InvalidTargetError) as caught:
            resolve_target(user or self.user, path)
        self.assertEqual(code, caught.exception.code)

    def test_a_folder_of_the_library_new_or_not(self) -> None:
        self.assertEqual(self.target, resolve_target(self.user, self.target + os.sep))
        new = os.path.join(self.root, "2025", "Porto")
        self.assertEqual(new, resolve_target(self.user, new))
        self.assertEqual(self.root, resolve_target(self.user, self.root))

    def test_nothing_outside_the_library(self) -> None:
        self.assert_refused(os.path.dirname(self.root), "outside_library")
        self.assert_refused(self.root + "2", "outside_library")
        self.assert_refused(
            os.path.join(self.root, "..", "elsewhere"), "outside_library"
        )
        # A backslash is a separator on Windows (the %5C.. trap of #2122) and
        # part of a name on POSIX: neither way does it climb out.
        sneaky = os.path.join(self.root, "sub\\..\\..\\x")
        if os.sep == "\\":
            self.assert_refused(sneaky, "outside_library")
        else:
            # One folder named "sub\..\..\x" inside the library.
            self.assertEqual(sneaky, resolve_target(self.user, sneaky))
        self.assert_refused("b", "outside_library")
        self.assert_refused(self.target + "\x00", "outside_library")

    def test_a_link_out_of_the_library_is_outside(self) -> None:
        outside = self.folder("..", os.path.basename(self.root) + "-outside")
        self.addCleanup(os.rmdir, outside)
        link = os.path.join(self.root, "link")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError:
            self.skipTest("this account cannot create symbolic links")
        self.assert_refused(link, "outside_library")
        self.assert_refused(os.path.join(link, "sub"), "outside_library")

    def test_no_library(self) -> None:
        self.assert_refused(self.root, "no_library", create_test_user())

    def test_a_folder_the_scan_skips(self) -> None:
        self.assert_refused(os.path.join(self.root, ".trash", "x"), "hidden_folder")
        with patch("api.photos.moves.should_skip", return_value=True):
            self.assert_refused(self.target, "hidden_folder")

    def test_a_file(self) -> None:
        self.assert_refused(
            self.write(os.path.join(self.root, "f.jpg")), "not_a_folder"
        )

    def test_the_nextcloud_downloads(self) -> None:
        with override_settings(DATA_ROOT=self.root):
            self.assert_refused(
                os.path.join(self.root, "nextcloud_media", "u"), "outside_library"
            )

    def test_an_upload_folder_outside_the_scan_directory(self) -> None:
        uploads = self.folder("..", os.path.basename(self.root) + "-uploads")
        self.addCleanup(os.rmdir, uploads)
        User.objects.filter(pk=self.user.pk).update(upload_directory=uploads)
        self.user.refresh_from_db()
        self.assertEqual(
            [self.root, os.path.normpath(uploads)], library_roots(self.user)
        )
        self.assertEqual(os.path.normpath(uploads), resolve_target(self.user, uploads))


class RefusalTest(LibraryTestCase):
    def test_a_photo_that_can_move(self) -> None:
        self.assertIsNone(moves.refusal(self.photo()))

    def test_a_nextcloud_copy(self) -> None:
        folder = self.folder("nextcloud_media", "u")
        photo = self.photo(folder=folder)
        with override_settings(DATA_ROOT=self.root):
            self.assertEqual(moves.REFUSED_NEXTCLOUD, moves.refusal(photo))

    def test_a_file_another_photo_uses(self) -> None:
        photo = self.photo()
        other = create_test_photo(owner=create_test_user())
        other.files.add(photo.main_file)
        self.assertEqual(moves.REFUSED_SHARED_FILE, moves.refusal(photo))

    def test_files_not_on_disk(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        os.remove(photo.main_file.path)
        self.assertEqual(moves.REFUSED_NOT_ON_DISK, moves.refusal(photo))


class PreviewAndMoveTest(LibraryTestCase):
    def test_the_preview_counts_files_and_clashes_inside_the_selection(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        first = self.photo(variants=(raw,))
        second = self.photo(folder=self.folder("c"))
        already = self.photo("IMG_2.jpg", folder=self.target)
        photos = moves.photos_to_move(self.user, [first.pk, second.pk, already.pk])

        preview = moves.preview_move(photos, self.target)

        self.assertEqual((2, 3, 1), (preview.photos, preview.files, preview.unchanged))
        self.assertEqual(
            [moves.Clash(second.pk, "IMG_1.jpg", "IMG_1 (1).jpg")], preview.clashes
        )
        # Nothing moved.
        self.assertEqual(["IMG_1.jpg"], os.listdir(os.path.join(self.root, "c")))

    def test_move_counts_each_outcome(self) -> None:
        moved = self.photo()
        clash = self.photo(folder=self.folder("c"))
        refused = self.photo("IMG_3.jpg")
        assert refused.main_file is not None
        os.remove(refused.main_file.path)
        target = os.path.join(self.root, "new")
        photos = moves.photos_to_move(self.user, [moved.pk, clash.pk, refused.pk])

        result = moves.move_photos(photos, target, "skip")

        self.assertEqual(
            {"moved": 1, "skipped": 1, "unchanged": 0, "refused": 1, "failed": 0},
            result.as_dict(),
        )
        self.assertEqual(["IMG_1.jpg"], os.listdir(target))

    def test_a_photo_that_fails_does_not_stop_the_rest(self) -> None:
        first = self.photo()
        second = self.photo("IMG_2.jpg")
        photos = moves.photos_to_move(self.user, [first.pk, second.pk])
        with patch(
            "api.photos.moves.move_photo_files",
            side_effect=[moves.MoveError("locked"), moves.MoveOutcome.MOVED],
        ):
            result = moves.move_photos(photos, self.target, "skip")
        self.assertEqual((1, 1), (result.moved, result.failed))

    def test_only_the_owners_photos(self) -> None:
        theirs = create_test_photo(owner=create_test_user())
        self.assertEqual([], moves.photos_to_move(self.user, [theirs.pk]))

    def test_a_scan_blocks_a_move(self) -> None:
        self.assertFalse(moves.scan_running(self.user))
        create_test_job(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertTrue(moves.scan_running(self.user))


class MoveJobTest(LibraryTestCase):
    def test_the_job_moves_and_reports(self) -> None:
        photo = self.photo()
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)

        moves.move_photos_job(self.user, [photo.pk], self.target, "skip", job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertEqual(1, job.result["moved"])
        self.assertEqual((1, 1), (job.progress_current, job.progress_target))
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.target))

    def test_a_target_gone_from_the_library_fails_the_job(self) -> None:
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)
        moves.move_photos_job(
            self.user, [uuid.uuid4()], os.path.dirname(self.root), "skip", job.job_id
        )
        job.refresh_from_db()
        self.assertTrue(job.failed)

    def test_a_cancel_stops_after_the_current_photo(self) -> None:
        first = self.photo()
        second = self.photo("IMG_2.jpg")
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)

        def cancel_after_first(self_job: LongRunningJob) -> None:
            raise moves.JobCancelledError(self_job.job_id)

        with patch.object(LongRunningJob, "stop_if_cancelled", cancel_after_first):
            moves.move_photos_job(
                self.user, [first.pk, second.pk], self.target, "skip", job.job_id
            )
        self.assertEqual(1, len(os.listdir(self.target)))

    def test_a_job_cancelled_while_queued_does_nothing(self) -> None:
        photo = self.photo()
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)
        job.cancel()
        moves.move_photos_job(self.user, [photo.pk], self.target, "skip", job.job_id)
        self.assertEqual([], os.listdir(self.target))


class LibraryFoldersTest(LibraryTestCase):
    def test_the_roots_then_one_level_at_a_time(self) -> None:
        self.folder("a", "2025")
        self.folder("a", ".thumbnails")

        roots = library_folders(self.user)
        self.assertIsNone(roots.path)
        self.assertEqual(
            [(os.path.basename(self.root), self.root, True)],
            [(f.name, f.path, f.has_subfolders) for f in roots.folders],
        )

        listing = library_folders(self.user, self.root)
        self.assertEqual(
            [("a", True), ("b", False)],
            [(f.name, f.has_subfolders) for f in listing.folders],
        )
        inside = library_folders(self.user, self.source)
        self.assertEqual(["2025"], [f.name for f in inside.folders])

    def test_a_long_folder_is_cut(self) -> None:
        with patch("api.photos.moves.MAX_LISTED_FOLDERS", 1):
            listing = library_folders(self.user, self.root)
        self.assertEqual((1, True), (len(listing.folders), listing.truncated))

    def test_nothing_outside_and_nothing_missing(self) -> None:
        with self.assertRaises(InvalidTargetError):
            library_folders(self.user, os.path.dirname(self.root))
        with self.assertRaises(InvalidTargetError) as caught:
            library_folders(self.user, os.path.join(self.root, "missing"))
        self.assertEqual("not_a_folder", caught.exception.code)

    def test_a_user_without_a_library_lists_nothing(self) -> None:
        self.assertEqual([], library_folders(create_test_user()).folders)

    def test_an_unreadable_folder_lists_empty(self) -> None:
        with patch(
            "api.photos.moves.os.scandir", side_effect=PermissionError(13, "denied")
        ):
            self.assertEqual([], library_folders(self.user, self.root).folders)
