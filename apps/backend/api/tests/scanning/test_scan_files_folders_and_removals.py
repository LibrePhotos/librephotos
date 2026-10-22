"""``POST /api/scan-files/`` takes folders (#2727) and removed paths (#2728).

A folder inside the requester's library is walked like a folder of the
library, and its files scanned; the scan stays a scan of chosen files, never
the change baseline. A path in ``removed_paths`` that is gone from the
library detaches the requester's file there (or below it) and flags it
missing at once, with the guards of the missing-file check.
"""

import os
import shutil
import uuid
from unittest.mock import patch

from constance.test import override_config
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import missing_guard, scan_jobs, utils
from api.directory_watcher.file_handlers import group_files_into_photo
from api.directory_watcher.removed_paths import plan_removal
from api.directory_watcher.scan_jobs import scan_photos
from api.directory_watcher.utils import walk_files
from api.models import File, LongRunningJob
from api.photos.library_files import scannable_files
from api.photos.media_files import get_or_create_file
from api.tests.scanning.test_rescan_selected_photos import (
    LibraryFilesTestBase,
    recorded_tasks,
)
from api.tests.scanning.test_scan_photos_orchestration import (
    ChainRecorder,
    TaskRecorder,
)
from api.tests.utils import (
    api_error,
    create_test_album_user,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_user,
)


class ScannableFoldersTest(LibraryFilesTestBase):
    def test_a_folder_inside_the_library_is_kept_when_asked_for(self):
        folder = os.path.join(self.scan_dir, "2026")
        os.makedirs(folder)
        outside = os.path.join(self.root, "bob")
        os.makedirs(outside)
        gone = os.path.join(self.scan_dir, "gone")

        kept, ignored = scannable_files(
            self.user, [folder, outside, gone, folder], folders=True
        )

        self.assertEqual(kept, [folder])
        self.assertEqual(ignored, [outside, gone, folder])

    def test_folders_stay_out_by_default(self):
        self.assertEqual(
            scannable_files(self.user, [self.scan_dir]), ([], [self.scan_dir])
        )

    def test_a_climb_out_of_the_library_is_ignored(self):
        os.makedirs(os.path.join(self.root, "bob"))
        for path in (
            os.path.join(self.scan_dir, "..", "bob"),
            os.path.join(self.scan_dir, "..\\bob"),
        ):
            with self.subTest(path=path):
                kept, _ = scannable_files(self.user, [path], folders=True)
                self.assertEqual(kept, [])


class WalkFilesTest(LibraryFilesTestBase):
    def touch(self, *parts):
        return self.write(self.scan_dir, *parts).path

    def test_a_folder_is_walked_and_each_file_taken_once(self):
        jpg = self.touch("trip", "IMG_1.jpg")
        raw = self.touch("trip", "IMG_1.CR2")
        deep = self.touch("trip", "day2", "IMG_2.jpg")
        self.touch("trip", ".hidden", "IMG_3.jpg")
        found = []

        skipped = walk_files([os.path.join(self.scan_dir, "trip"), jpg], found)

        self.assertEqual(sorted(found), sorted([jpg, raw, deep]))
        self.assertEqual(skipped, [])

    @override_config(SKIP_PATTERNS="@eaDir")
    def test_a_hidden_or_skipped_folder_is_not_walked(self):
        self.touch(".trash", "a.jpg")
        self.touch("@eaDir", "b.jpg")
        found = []

        walk_files(
            [
                os.path.join(self.scan_dir, ".trash"),
                os.path.join(self.scan_dir, "@eaDir"),
            ],
            found,
        )

        self.assertEqual(found, [])

    def test_an_unreadable_folder_is_skipped_not_raised(self):
        kept = self.touch("trip", "a.jpg")
        locked = os.path.join(self.scan_dir, "trip", "locked")
        os.makedirs(locked)
        found = []

        with refusing_to_list(locked):
            skipped = walk_files([os.path.join(self.scan_dir, "trip")], found)

        self.assertEqual(found, [kept])
        self.assertEqual([entry.path for entry in skipped], [locked])


def refusing_to_list(refused):
    """``_list_directory`` raising ``PermissionError`` for ``refused`` only."""
    real = utils._list_directory

    def fake(directory):
        if os.path.normcase(directory) == os.path.normcase(refused):
            raise PermissionError(13, "Permission denied")
        return real(directory)

    return patch.object(utils, "_list_directory", side_effect=fake)


class ScanOfAFolderTest(LibraryFilesTestBase):
    """The scan job itself, with a real walk of the named folder."""

    def scan(self, paths):
        job_id = str(uuid.uuid4())
        recorder = TaskRecorder([])
        with (
            override_settings(MEDIA_ROOT=os.path.join(self.root, "media")),
            patch("api.jobs.queue.AsyncTask", recorder),
            patch("api.jobs.queue.Chain", ChainRecorder),
            self.captureOnCommitCallbacks(execute=True),
            patch.object(scan_jobs, "photo_scanner"),
            patch.object(scan_jobs, "backfill_missing_aspect_ratios"),
            patch.object(scan_jobs.db.connections, "close_all"),
        ):
            scan_photos(self.user, False, job_id, scan_files=paths)
        return recorder, LongRunningJob.objects.get(job_id=job_id)

    def test_a_raw_and_jpeg_pair_in_a_folder_is_one_group(self):
        jpg = self.write(self.scan_dir, "trip", "IMG_1.jpg").path
        raw = self.write(self.scan_dir, "trip", "IMG_1.CR2").path

        recorder, job = self.scan([os.path.join(self.scan_dir, "trip")])

        [(_, args, _)] = recorder.find(scan_jobs.handle_file_group)
        self.assertEqual(sorted(args[1]), sorted([jpg, raw]))
        self.assertNotIn(LongRunningJob.LIBRARY_SCAN, job.result or {})
        self.assertEqual(recorder.find(scan_jobs.scan_missing_photos), [])

    def test_an_unreadable_subfolder_is_recorded_and_the_scan_goes_on(self):
        new = self.write(self.scan_dir, "trip", "a.jpg").path
        locked = os.path.join(self.scan_dir, "trip", "locked")
        os.makedirs(locked)

        with refusing_to_list(locked):
            recorder, job = self.scan([os.path.join(self.scan_dir, "trip")])

        [(_, args, _)] = recorder.find(scan_jobs.handle_file_group)
        self.assertEqual(args[1], [new])
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertIn(locked, job.result["errors"][0])
        self.assertNotIn(LongRunningJob.LIBRARY_SCAN, job.result)


class ScanFilesViewBase(LibraryFilesTestBase):
    url = "/api/scan-files/"

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def post(self, body):
        with recorded_tasks() as recorder, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, body, format="json")
        self.recorder = recorder
        return response


class ScanFilesFoldersViewTest(ScanFilesViewBase):
    def test_a_folder_in_the_library_is_scanned_and_counts_as_one(self):
        folder = os.path.dirname(self.write(self.scan_dir, "2026", "a.jpg").path)

        response = self.post({"paths": [folder]})

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["file_count"], body["removed_count"]), (1, 0))
        self.assertEqual(body["ignored_paths"], [])
        [(func, _, kwargs)] = self.recorder.calls
        self.assertIs(func, scan_jobs.scan_photos)
        self.assertEqual(kwargs["scan_files"], [folder])

    def test_a_folder_in_a_separate_upload_folder_is_scanned(self):
        self.user.upload_directory = os.path.join(self.root, "uploads")
        self.user.save(update_fields=["upload_directory"])
        folder = os.path.join(self.user.upload_directory, "phone")
        os.makedirs(folder)

        response = self.post({"paths": [folder]})

        self.assertEqual(response.json()["file_count"], 1)

    def test_a_folder_outside_the_library_or_gone_is_ignored(self):
        outside = os.path.join(self.root, "bob")
        os.makedirs(outside)
        gone = os.path.join(self.scan_dir, "gone")

        response = self.post({"paths": [outside, gone]})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "no_files_to_scan")
        self.assertEqual(self.recorder.calls, [])

    def test_neither_list_naming_a_path_is_a_400_on_paths(self):
        response = self.post({"paths": [], "removed_paths": []})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "paths")


class ScanFilesRemovalViewTest(ScanFilesViewBase):
    def setUp(self):
        super().setUp()
        # Something stays on disk: an empty library root reads as unmounted.
        self.kept = self.photo()

    def gone_photo(self, *folders):
        photo = self.photo(folder=os.path.join(self.scan_dir, *folders))
        os.remove(photo.main_file.path)
        return photo

    def assert_detached(self, photo):
        file = File.objects.get(pk=photo.main_file.pk)
        self.assertTrue(file.missing)
        self.assertFalse(photo.files.filter(pk=file.pk).exists())

    def assert_untouched(self, photo):
        self.assertFalse(File.objects.get(pk=photo.main_file.pk).missing)
        self.assertTrue(photo.files.filter(pk=photo.main_file.pk).exists())

    def test_a_deleted_file_is_detached_at_once_without_a_scan(self):
        photo = self.gone_photo()

        response = self.post({"removed_paths": [photo.main_file.path]})

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["removed_count"], 1)
        self.assertEqual(body["file_count"], 0)
        self.assertEqual((body["job_id"], body["job_ids"]), (None, []))
        self.assertEqual(self.recorder.calls, [])
        self.assert_detached(photo)
        self.assert_untouched(self.kept)

    def test_a_folder_moved_away_detaches_every_file_below_it(self):
        first = self.gone_photo("trip")
        second = self.gone_photo("trip", "day2")
        sibling = self.photo(folder=os.path.join(self.scan_dir, "trip2"))
        shutil.rmtree(os.path.join(self.scan_dir, "trip"))

        response = self.post({"removed_paths": [os.path.join(self.scan_dir, "trip")]})

        self.assertEqual(response.json()["removed_count"], 2)
        self.assert_detached(first)
        self.assert_detached(second)
        self.assert_untouched(sibling)

    def test_paths_that_are_not_gone_files_of_mine_are_ignored(self):
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        # Bob's row at a path inside my library, say from an overlapping root.
        theirs = create_test_file(os.path.join(self.scan_dir, "theirs.jpg"), bob)
        their_photo = create_test_photo(owner=bob, main_file=theirs)
        their_photo.files.add(theirs)
        gone = self.gone_photo()
        outside = os.path.join(self.root, "bob", "b.jpg")
        never_indexed = os.path.join(self.scan_dir, "never.jpg")
        named = [
            self.kept.main_file.path,
            outside,
            theirs.path,
            never_indexed,
            gone.main_file.path,
            gone.main_file.path,
        ]

        response = self.post({"removed_paths": named})

        body = response.json()
        self.assertEqual(body["removed_count"], 1)
        self.assertEqual(
            sorted(body["ignored_paths"]),
            sorted(
                [
                    self.kept.main_file.path,
                    outside,
                    gone.main_file.path,
                    theirs.path,
                    never_indexed,
                ]
            ),
        )
        self.assert_untouched(self.kept)
        self.assertFalse(File.objects.get(pk=theirs.pk).missing)
        self.assertTrue(their_photo.files.filter(pk=theirs.pk).exists())

    def test_a_file_with_an_exact_copy_on_disk_is_taken_over(self):
        photo = self.photo()
        original = photo.main_file.path
        copy = os.path.join(self.scan_dir, "copy.jpg")
        shutil.copyfile(original, copy)
        get_or_create_file(copy, self.user)  # The scan records the copy.
        os.remove(original)

        response = self.post({"removed_paths": [original]})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["removed_count"], 0)
        file = File.objects.get(pk=photo.main_file.pk)
        self.assertEqual((file.path, file.missing), (copy, False))
        self.assertTrue(photo.files.filter(pk=file.pk).exists())

    def test_nothing_is_detached_while_the_library_looks_unmounted(self):
        photo = self.gone_photo()
        shutil.rmtree(self.scan_dir)

        response = self.post({"removed_paths": [photo.main_file.path]})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "library_unavailable")
        self.assertIn("Is the library mounted?", api_error(response)["message"])
        self.assertFalse(File.objects.get(pk=photo.main_file.pk).missing)

    @override_config(SCAN_MISSING_MAX_FRACTION=0.5)
    def test_nothing_is_detached_when_too_much_would_go_missing(self):
        first, second = self.gone_photo(), self.gone_photo()

        with patch.object(missing_guard, "MISSING_PHOTOS_FLOOR", 0):
            response = self.post(
                {"removed_paths": [first.main_file.path, second.main_file.path]}
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "library_unavailable")
        self.assert_untouched(first)
        self.assert_untouched(second)

    def test_a_running_scan_leaves_the_removals_undone_too(self):
        photo = self.gone_photo()
        new = self.write(self.scan_dir, "new.jpg").path
        create_test_job(started_by=self.user, started_at=timezone.now())

        response = self.post({"paths": [new], "removed_paths": [photo.main_file.path]})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assert_untouched(photo)

    def test_a_move_keeps_the_photo_with_its_albums(self):
        photo = self.photo(folder=os.path.join(self.scan_dir, "old"))
        album = create_test_album_user(self.user)
        album.photos.add(photo)
        old = photo.main_file.path
        new = os.path.join(self.scan_dir, "new", os.path.basename(old))
        os.makedirs(os.path.dirname(new))
        shutil.move(old, new)

        response = self.post({"paths": [new], "removed_paths": [old]})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["removed_count"], 1)
        [(_, _, kwargs)] = self.recorder.calls
        self.assertEqual(kwargs["scan_files"], [new])
        # What the queued scan does with the new path.
        file = get_or_create_file(new, self.user)
        adopted = group_files_into_photo(self.user, [file], "job")
        self.assertEqual(adopted.pk, photo.pk)
        file.refresh_from_db()
        self.assertEqual((file.path, file.missing), (new, False))
        self.assertTrue(photo.files.filter(pk=file.pk).exists())
        self.assertTrue(album.photos.filter(pk=photo.pk).exists())


class PlanRemovalTest(LibraryFilesTestBase):
    def test_a_file_detached_before_is_not_named_again(self):
        self.photo()  # Keeps the library from reading as unmounted.
        photo = self.photo()
        os.remove(photo.main_file.path)
        first = plan_removal(self.user, [photo.main_file.path])
        for kept_photo, files in first.gone.values():
            kept_photo.files.remove(*files)

        again = plan_removal(self.user, [photo.main_file.path])

        self.assertEqual(again.gone, {})
        self.assertFalse(again.matched)
        self.assertEqual(again.ignored, [photo.main_file.path])
