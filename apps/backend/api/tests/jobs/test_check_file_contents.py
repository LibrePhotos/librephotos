"""Check file contents: files replaced with their old date kept (#2040)."""

import io
import os
from unittest import mock

from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from api.directory_watcher import content_check
from api.directory_watcher.content_check import (
    MAX_LISTED,
    CheckResult,
    FolderError,
    check_file_contents,
    check_file_contents_job,
    queue_rescans,
    resolve_folder,
)
from api.directory_watcher.scan_jobs import scan_photos
from api.models import File, LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.photos.media_files import calculate_hash
from api.tests.scanning.test_replaced_file_rescan import (
    ReplacedFileTestCase,
    _write_image,
)
from api.tests.utils import (
    api_error,
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_user,
)

URL = "/api/check-file-contents/"


def _replace_keeping_mtime(path, seed):
    """Overwrite ``path`` with another picture, as ``cp -p`` would."""
    stat = os.stat(path)
    _write_image(path, seed)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))


class CheckFileContentsTestCase(ReplacedFileTestCase):
    def setUp(self):
        super().setUp()
        self.user.scan_directory = self.tmpdir
        self.user.save(update_fields=["scan_directory"])
        _write_image(self.path, 1)
        self.photo = self._index()


class CheckFileContentsTest(CheckFileContentsTestCase):
    def test_a_replaced_picture_is_re_indexed(self):
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=self.photo, person=person)
        _replace_keeping_mtime(self.path, 2)

        result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["checked"])
        self.assertEqual(1, result.totals["new_picture"])
        self.assertEqual(calculate_hash(self.user, self.path), File.objects.get().hash)
        self.assertEqual(
            [
                {
                    "path": self.path,
                    "verdict": "new_picture",
                    "photo_id": str(self.photo.pk),
                    "named_faces_removed": 1,
                }
            ],
            result.changed,
        )
        self.assertEqual({self.user.pk: {self.photo.pk}}, dict(result.rescan))
        self.assertEqual(1, result.by_user[self.user.pk]["new_picture"])

    def test_an_unchanged_file_is_only_counted(self):
        result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["unchanged"])
        self.assertEqual([], result.changed)
        self.assertEqual({}, dict(result.rescan))

    def test_a_metadata_write_is_the_same_picture(self):
        with open(self.path, "ab") as f:
            f.write(b"\x00")

        result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["same_picture"])
        self.assertEqual(0, result.changed[0]["named_faces_removed"])

    def test_a_missing_file_is_left_to_the_scan(self):
        os.remove(self.path)

        result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["missing"])
        self.assertEqual(0, result.error_count)

    def test_an_unreadable_file_is_a_failed_item(self):
        with mock.patch.object(
            content_check,
            "calculate_hash",
            side_effect=PermissionError(13, "Permission denied"),
        ):
            result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["unreadable"])
        self.assertEqual([f"{self.path}: Permission denied"], result.errors)

    def test_contents_matching_another_file_are_a_failed_item(self):
        other = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(other, 2)
        self._index(other)
        _replace_keeping_mtime(self.path, 2)

        result = check_file_contents(self.user)

        self.assertEqual(1, result.error_count)
        self.assertIn("match another indexed file", result.errors[0])

    def test_a_file_of_a_user_who_is_gone_is_a_failed_item(self):
        with mock.patch.object(content_check, "hash_owner_part", return_value="0"):
            result = check_file_contents(self.user)

        self.assertEqual(1, result.totals["unreadable"])
        self.assertIn("no longer exists", result.errors[0])

    def test_the_list_of_changes_is_capped(self):
        result = CheckResult()
        checker = content_check._Checker(result)
        for index in range(MAX_LISTED + 1):
            checker._list_change(f"/p/{index}", "same_picture", [], 0)
        self.assertEqual(MAX_LISTED, len(result.changed))
        for index in range(MAX_LISTED + 1):
            result.fail(f"/p/{index}", "x")
        self.assertEqual(MAX_LISTED, len(result.errors))
        self.assertEqual(MAX_LISTED + 1, result.error_count)

    def test_progress_is_reported_from_start_to_end(self):
        progress = mock.Mock()

        check_file_contents(self.user, progress=progress)

        self.assertEqual([mock.call(0, 1), mock.call(1, 1)], progress.call_args_list)


class CheckFileContentsScopeTest(CheckFileContentsTestCase):
    def test_only_the_folder_is_read(self):
        folder = os.path.join(self.tmpdir, "2024")
        os.makedirs(folder)
        inside = os.path.join(folder, "IMG_0002.png")
        _write_image(inside, 3)
        self._index(inside)
        _replace_keeping_mtime(self.path, 2)

        result = check_file_contents(self.user, resolve_folder(self.user, "2024"))

        self.assertEqual(1, result.totals["checked"])
        self.assertEqual(1, result.totals["unchanged"])

    def test_every_users_library_is_read(self):
        other_user = create_test_user(scan_directory=self.tmpdir)
        other_path = os.path.join(self.tmpdir, "IMG_0003.png")
        _write_image(other_path, 4)
        self._index(other_path, user=other_user)

        result = check_file_contents()

        self.assertEqual(2, result.totals["checked"])
        self.assertEqual({self.user.pk, other_user.pk}, set(result.by_user))

    def test_a_file_in_two_libraries_is_read_once(self):
        other_user = create_test_user(scan_directory=self.tmpdir)
        other_photo = self._scan(user=other_user)
        self._derive(other_photo)
        _replace_keeping_mtime(self.path, 2)

        result = check_file_contents()

        self.assertEqual(1, result.totals["new_picture"])
        self.assertEqual(1, result.totals["checked"])
        self.assertEqual(
            {self.user.pk: {self.photo.pk}, other_user.pk: {other_photo.pk}},
            dict(result.rescan),
        )

    def test_a_folder_outside_the_scan_directory_is_refused(self):
        for folder in ("..", "does-not-exist"):
            with self.subTest(folder=folder), self.assertRaises(FolderError):
                resolve_folder(self.user, folder)

    def test_a_user_without_a_scan_directory_has_no_folders(self):
        with self.assertRaises(FolderError):
            resolve_folder(create_test_user(scan_directory=""), "2024")


class QueueRescansTest(CheckFileContentsTestCase):
    def test_the_photos_of_changed_files_are_rescanned_by_their_owner(self):
        result = CheckResult()
        result.rescan[self.user.pk].add(self.photo.pk)

        with mock.patch.object(content_check, "enqueue_followup") as enqueue:
            self.assertEqual(1, queue_rescans(result))

        enqueue.assert_called_once_with(
            self.user,
            LongRunningJob.JOB_SCAN_PHOTOS,
            scan_photos,
            self.user,
            False,
            scan_files=[self.path],
            force_files=True,
        )

    def test_a_photo_without_a_file_in_the_library_is_not_rescanned(self):
        os.remove(self.path)
        result = CheckResult()
        result.rescan[self.user.pk].add(self.photo.pk)

        with mock.patch.object(content_check, "enqueue_followup") as enqueue:
            self.assertEqual(0, queue_rescans(result))

        enqueue.assert_not_called()


@mock.patch.object(content_check, "enqueue_followup")
class CheckFileContentsJobTest(CheckFileContentsTestCase):
    def setUp(self):
        super().setUp()
        self.admin = create_test_user(is_admin=True)

    def _run(self, **kwargs):
        job = create_test_job(self.admin, LongRunningJob.JOB_CHECK_FILE_CONTENTS)
        check_file_contents_job(self.admin, job_id=job.job_id, **kwargs)
        job.refresh_from_db()
        return job

    def test_the_result_has_the_counts_per_user_and_the_changes(self, enqueue):
        _replace_keeping_mtime(self.path, 2)

        job = self._run(user_id=self.user.pk)

        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual("completed", job.result["status"])
        self.assertEqual(1, job.result["new_picture"])
        self.assertEqual(1, job.result["rescans"])
        self.assertEqual(self.user.username, job.result["users"][0]["username"])
        self.assertEqual(self.path, job.result["changed"][0]["path"])
        self.assertEqual((1, 1), (job.progress_current, job.progress_target))

    def test_failed_items_make_a_partial_failure(self, enqueue):
        with mock.patch.object(
            content_check, "calculate_hash", side_effect=OSError("I/O error")
        ):
            job = self._run()

        self.assertEqual("partial_failure", job.result["status"])
        self.assertEqual(1, job.result["error_count"])

    def test_an_unknown_user_fails_the_job(self, enqueue):
        job = self._run(user_id=987654)

        self.assertTrue(job.failed)

    def test_a_cancel_still_rescans_what_was_re_keyed(self, enqueue):
        _replace_keeping_mtime(self.path, 2)

        def cancel_at_the_end(done, total):
            if done == total:
                raise JobCancelledError("job")

        with mock.patch.object(
            LongRunningJob, "stop_if_cancelled", autospec=True
        ) as stop:
            stop.side_effect = lambda job: cancel_at_the_end(
                job.progress_current, job.progress_target
            )
            job = self._run()

        self.assertFalse(job.finished)
        enqueue.assert_called_once()

    def test_an_unexpected_error_fails_the_job(self, enqueue):
        with mock.patch.object(
            content_check, "count_files", side_effect=RuntimeError("boom")
        ):
            job = self._run()

        self.assertTrue(job.failed)

    def test_a_cancelled_job_does_nothing(self, enqueue):
        job = create_test_job(
            self.admin, LongRunningJob.JOB_CHECK_FILE_CONTENTS, finished=True
        )

        check_file_contents_job(self.admin, job_id=job.job_id)

        enqueue.assert_not_called()


class CheckFileContentsViewTest(CheckFileContentsTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)
        os.makedirs(os.path.join(self.tmpdir, "2024"))

    def _post(self, body):
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL, body, format="json")
        return response, async_task

    def test_an_admin_starts_it_for_every_user(self):
        response, async_task = self._post({})

        self.assertEqual(200, response.status_code, response.content)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(LongRunningJob.JOB_CHECK_FILE_CONTENTS, job.job_type)
        self.assertEqual(
            (check_file_contents_job, self.admin), async_task.call_args.args
        )
        self.assertIsNone(async_task.call_args.kwargs["user_id"])
        self.assertIsNone(async_task.call_args.kwargs["folder"])

    def test_one_users_folder(self):
        response, async_task = self._post({"user_id": self.user.pk, "folder": "2024"})

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(self.user.pk, async_task.call_args.kwargs["user_id"])
        self.assertEqual(
            os.path.join(os.path.abspath(self.tmpdir), "2024"),
            async_task.call_args.kwargs["folder"],
        )

    def test_one_users_whole_library(self):
        response, async_task = self._post({"user_id": self.user.pk})

        self.assertEqual(200, response.status_code, response.content)
        self.assertIsNone(async_task.call_args.kwargs["folder"])

    def test_bad_scopes_are_refused_on_their_field(self):
        cases = [
            ({"folder": "2024"}, "folder"),
            ({"user_id": 987654}, "user_id"),
            ({"user_id": self.user.pk, "folder": "../.."}, "folder"),
        ]
        for body, field in cases:
            with self.subTest(body=body):
                response, async_task = self._post(body)
                self.assertEqual(400, response.status_code)
                self.assertEqual(field, api_error(response)["field"])
                async_task.assert_not_called()

    def test_a_normal_user_may_not_start_it(self):
        self.client.force_authenticate(user=self.user)

        response, async_task = self._post({})

        self.assertEqual(403, response.status_code)
        async_task.assert_not_called()


@mock.patch.object(content_check, "enqueue_followup")
class RehashFilesCommandTest(CheckFileContentsTestCase):
    def _call(self, *args):
        out, err = io.StringIO(), io.StringIO()
        call_command("rehash_files", *args, stdout=out, stderr=err)
        return out.getvalue(), err.getvalue()

    def test_it_reports_the_changes_and_queues_the_rescans(self, enqueue):
        _replace_keeping_mtime(self.path, 2)

        out, _ = self._call("--user", self.user.username)

        self.assertIn(f"new_picture: {self.path}", out)
        self.assertIn("new picture 1", out)
        self.assertIn("Queued 1 rescan.", out)

    def test_a_folder_of_one_user(self, enqueue):
        os.makedirs(os.path.join(self.tmpdir, "2024"))

        out, _ = self._call("--user", self.user.username, "--path", "2024")

        self.assertIn("Read 0 files", out)

    def test_bad_arguments_are_refused(self, enqueue):
        for args in (
            ("--path", "2024"),
            ("--user", "nobody-by-this-name"),
            ("--user", self.user.username, "--path", ".."),
        ):
            with self.subTest(args=args), self.assertRaises(CommandError):
                self._call(*args)

    def test_unreadable_files_fail_the_command(self, enqueue):
        with (
            mock.patch.object(
                content_check, "calculate_hash", side_effect=OSError("I/O error")
            ),
            self.assertRaises(CommandError) as raised,
        ):
            self._call()

        self.assertIn("1 could not be read", str(raised.exception))

    def test_every_user(self, enqueue):
        out, _ = self._call()

        self.assertIn("Read 1 files: 1 unchanged", out)
        self.assertTrue(Photo.objects.filter(pk=self.photo.pk).exists())
