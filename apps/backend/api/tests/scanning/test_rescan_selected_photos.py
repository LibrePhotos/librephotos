"""Rescan chosen photos (#2214) and scan files an outside process names (#900).

``scan_photos(..., scan_files=..., force_files=True)`` reads the listed files
again even when they did not change, and rebuilds their thumbnails; its
follow-ups still only cover what is new, and like any scan of chosen files it
is never the change baseline of the next library scan (#2192).

``POST /api/photos/rescan/`` takes the requester's photos by id;
``POST /api/scan-files/`` takes paths. Both only ever read files inside the
requester's scan directory or upload folder.
"""

import base64
import os
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import file_handlers, scan_jobs
from api.directory_watcher.scan_jobs import KnownFile
from api.models import LongRunningJob
from api.photos.library_files import (
    MAX_REQUESTED,
    in_library,
    library_roots,
    rescan_targets,
    scannable_files,
)
from api.tests.scanning.test_scan_photos_orchestration import (
    ScanPhotosCharacterizationBase,
    TaskRecorder,
)
from api.tests.utils import (
    api_error,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_user,
)


class ForcedFileScanTest(ScanPhotosCharacterizationBase):
    """A forced scan of chosen files reads them although nothing changed."""

    path = "/p/a.jpg"

    def setUp(self):
        super().setUp()
        # A finished library scan: an incremental scan compares against it.
        create_test_job(
            started_by=self.user,
            started_at=timezone.now(),
            finished=True,
            finished_at=timezone.now(),
            result={LongRunningJob.LIBRARY_SCAN: True},
        )
        # The file is known and unchanged since that scan read it.
        known = patch.object(
            scan_jobs, "_known_paths", return_value={self.path: KnownFile("h")}
        )
        known.start()
        self.addCleanup(known.stop)

    def scan(self, force_files, **kwargs):
        return self.run_scan(
            scan_files=[self.path],
            walk_result=[self.path],
            force_files=force_files,
            **kwargs,
        )

    def test_an_unchanged_file_is_left_alone_without_force(self):
        res = self.scan(False)

        self.assertEqual(res["tasks"].find(scan_jobs.handle_file_group), [])

    def test_force_reads_it_again_and_rebuilds_its_thumbnails(self):
        res = self.scan(True)

        [(_, args, kwargs)] = res["tasks"].find(scan_jobs.handle_file_group)
        self.assertEqual(args[1], [self.path])
        self.assertIs(kwargs["rebuild_thumbnails"], True)

    def test_an_unforced_group_does_not_rebuild_thumbnails(self):
        res = self.run_scan(scan_files=["/p/new.jpg"], walk_result=["/p/new.jpg"])

        [(_, _, kwargs)] = res["tasks"].find(scan_jobs.handle_file_group)
        self.assertNotIn("rebuild_thumbnails", kwargs)

    def test_a_lone_sidecar_is_read_again_too(self):
        res = self.run_scan(
            scan_files=["/p/b.xmp"], walk_result=["/p/b.xmp"], force_files=True
        )

        [call] = res["photo_scanner"].call_args_list
        self.assertIs(call.args[2], True)

    def test_its_follow_ups_only_cover_what_is_new(self):
        res = self.scan(
            True, finish_work=True, flags={"FEATURE_REVERSE_GEOCODING": True}
        )

        [geo] = res["tasks"].find(scan_jobs.add_geolocation)
        self.assertIs(geo[2]["full_scan"], False)
        self.assertEqual(res["tasks"].find(scan_jobs.scan_missing_photos), [])

    def test_it_is_not_the_baseline_of_the_next_library_scan(self):
        baseline = LongRunningJob.baseline_for(
            self.user, LongRunningJob.JOB_SCAN_PHOTOS
        )
        self.scan(True, finish_work=True)

        self.assertTrue(self.job().finished)
        self.assertNotIn(LongRunningJob.LIBRARY_SCAN, self.job().result or {})
        self.assertEqual(
            LongRunningJob.baseline_for(self.user, LongRunningJob.JOB_SCAN_PHOTOS),
            baseline,
        )

    def test_force_without_files_is_an_ordinary_library_scan(self):
        res = self.run_scan(walk_result=[self.path], force_files=True)

        self.assertFalse(res["select"].call_args[0][2])
        self.assertEqual(res["tasks"].find(scan_jobs.handle_file_group), [])


class RenderThumbnailsTest(TestCase):
    """A forced rescan renders every thumbnail again; a plain scan only missing ones."""

    def setUp(self):
        self.user = create_test_user()

    @patch.object(file_handlers.render, "regenerate_thumbnails")
    @patch.object(file_handlers.render, "generate_thumbnail")
    def test_a_plain_scan_renders_the_missing_ones(self, generate, regenerate):
        photo = create_test_photo(owner=self.user)

        file_handlers._render_thumbnails(photo, photo.thumbnail, False)

        generate.assert_called_once_with(photo.thumbnail)
        regenerate.assert_not_called()

    @patch.object(file_handlers.transcode_cache, "discard")
    @patch.object(file_handlers.render, "regenerate_thumbnails")
    def test_a_rebuild_keeps_the_old_ones_if_it_fails(self, regenerate, discard):
        photo = create_test_photo(owner=self.user)

        file_handlers._render_thumbnails(photo, photo.thumbnail, True)

        regenerate.assert_called_once_with(photo.thumbnail, keep_old_on_failure=True)
        discard.assert_not_called()

    @patch.object(file_handlers.transcode_cache, "discard")
    @patch.object(file_handlers.render, "regenerate_thumbnails")
    def test_a_video_rebuild_drops_its_cached_copy(self, regenerate, discard):
        photo = create_test_photo(owner=self.user, video=True)

        file_handlers._render_thumbnails(photo, photo.thumbnail, True)

        discard.assert_called_once_with(photo.image_hash)
        regenerate.assert_called_once()

    def test_the_file_group_hands_the_flag_to_the_photo(self):
        photo = create_test_photo(owner=self.user)
        with (
            patch.object(
                file_handlers, "_collect_file_records", return_value=[photo.main_file]
            ),
            patch.object(file_handlers, "group_files_into_photo", return_value=photo),
            patch.object(file_handlers, "_process_photo") as process,
            patch.object(file_handlers, "_record_read"),
        ):
            file_handlers.handle_file_group(
                self.user, [photo.main_file.path], "job", rebuild_thumbnails=True
            )

        self.assertIs(process.call_args.args[4], True)


class LibraryFilesTestBase(TestCase):
    """A user with a scan directory on disk and a file in it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.scan_dir = os.path.join(self.root, "alice")
        os.makedirs(self.scan_dir)
        self.user = create_test_user(scan_directory=self.scan_dir)

    def write(self, *parts, user=None):
        path = os.path.join(*parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return create_test_file(path, user or self.user, uuid.uuid4().bytes)

    def photo(self, folder=None, user=None, variants=()):
        main = self.write(folder or self.scan_dir, f"{uuid.uuid4().hex}.jpg", user=user)
        photo = create_test_photo(owner=user or self.user, main_file=main)
        photo.files.add(main, *variants)
        return photo


class LibraryFilesTest(LibraryFilesTestBase):
    def test_the_roots_are_the_scan_directory_and_the_upload_folder(self):
        self.assertEqual(
            library_roots(self.user),
            [self.scan_dir, os.path.join(self.scan_dir, "uploads")],
        )
        self.user.upload_directory = os.path.join(self.root, "uploads")
        self.assertEqual(
            library_roots(self.user), [self.scan_dir, self.user.upload_directory]
        )

    def test_a_user_without_a_library_has_no_roots(self):
        self.assertEqual(library_roots(create_test_user(scan_directory="")), [])

    def test_a_separate_upload_folder_is_in_the_library(self):
        self.user.upload_directory = os.path.join(self.root, "uploads")

        self.assertTrue(in_library(self.user, os.path.join(self.root, "uploads", "x")))
        self.assertFalse(in_library(self.user, os.path.join(self.root, "alice2", "x")))
        self.assertFalse(
            in_library(self.user, os.path.join(self.scan_dir, "..", "bob", "x"))
        )

    def test_only_existing_files_inside_the_library_are_kept(self):
        inside = self.write(self.scan_dir, "a.jpg").path
        outside = self.write(self.root, "bob", "b.jpg").path
        gone = os.path.join(self.scan_dir, "gone.jpg")

        kept, ignored = scannable_files(
            self.user, [inside, outside, gone, self.scan_dir, inside]
        )

        self.assertEqual(kept, [inside])
        self.assertEqual(ignored, [outside, gone, self.scan_dir, inside])

    def test_a_photos_main_file_variants_and_sidecars_are_read(self):
        sidecar = self.write(self.scan_dir, "s.xmp")
        photo = self.photo(variants=[sidecar])
        missing = create_test_file(os.path.join(self.scan_dir, "m.jpg"), missing=True)
        photo.files.add(missing)

        targets = rescan_targets(self.user, [photo.pk])

        self.assertEqual(targets.found, 1)
        self.assertEqual(targets.photo_count, 1)
        self.assertEqual(
            sorted(targets.paths), sorted([photo.main_file.path, sidecar.path])
        )

    def test_someone_elses_photo_is_not_found(self):
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(folder=bob.scan_directory, user=bob)

        targets = rescan_targets(self.user, [theirs.pk])

        self.assertEqual(targets, (0, 0, []))

    def test_a_photo_whose_files_are_gone_has_nothing_to_read(self):
        photo = self.photo()
        os.remove(photo.main_file.path)

        self.assertEqual(rescan_targets(self.user, [photo.pk]), (1, 0, []))


@contextmanager
def recorded_tasks() -> Iterator[TaskRecorder]:
    """Queue jobs into a recorder: no broker, no model downloads."""
    recorder = TaskRecorder([])
    with (
        patch("api.jobs.queue.AsyncTask", recorder),
        patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
    ):
        yield recorder


class RescanPhotosViewTest(LibraryFilesTestBase):
    url = "/api/photos/rescan/"

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def post(self, body):
        with recorded_tasks() as recorder, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, body, format="json")
        self.recorder = recorder
        return response

    def queued(self):
        [(func, args, kwargs)] = self.recorder.calls
        self.assertIs(func, scan_jobs.scan_photos)
        return args, kwargs

    def test_it_forces_a_scan_of_the_photos_files(self):
        photo = self.photo()

        response = self.post({"photo_ids": [str(photo.pk)]})

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["photo_count"], body["file_count"]), (1, 1))
        args, kwargs = self.queued()
        self.assertEqual(args, (self.user, False))
        self.assertEqual(kwargs["scan_files"], [photo.main_file.path])
        self.assertIs(kwargs["force_files"], True)
        self.assertEqual(kwargs["job_id"], body["job_id"])
        job = LongRunningJob.objects.get(job_id=body["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_PHOTOS)

    def test_another_users_photo_is_a_404_and_queues_nothing(self):
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(folder=bob.scan_directory, user=bob)

        response = self.post({"photo_ids": [str(theirs.pk)]})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.recorder.calls, [])
        self.assertFalse(LongRunningJob.objects.exists())

    def test_their_photo_next_to_mine_is_left_out(self):
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(folder=bob.scan_directory, user=bob)
        mine = self.photo()

        response = self.post({"photo_ids": [str(theirs.pk), str(mine.pk)]})

        self.assertEqual(response.json()["photo_count"], 1)
        _, kwargs = self.queued()
        self.assertEqual(kwargs["scan_files"], [mine.main_file.path])

    def test_a_file_outside_the_library_is_never_read(self):
        # A row pointing outside the scan directory, say after the admin moved it.
        photo = self.photo(folder=os.path.join(self.root, "elsewhere"))

        response = self.post({"photo_ids": [str(photo.pk)]})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "no_files_to_scan")
        self.assertEqual(self.recorder.calls, [])

    def test_the_list_is_capped(self):
        ids = [str(uuid.uuid4()) for _ in range(MAX_REQUESTED + 1)]

        response = self.post({"photo_ids": ids})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "photo_ids")

    def test_an_empty_list_or_a_bad_id_is_a_400(self):
        for ids in ([], ["not-a-uuid"]):
            with self.subTest(ids=ids):
                self.assertEqual(self.post({"photo_ids": ids}).status_code, 400)

    def test_a_second_start_while_a_scan_runs_is_a_409(self):
        photo = self.photo()
        running = create_test_job(started_by=self.user, started_at=timezone.now())

        response = self.post({"photo_ids": [str(photo.pk)]})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertEqual(response.json()["errors"][0]["job_id"], running.job_id)


class ScanFilesViewTest(LibraryFilesTestBase):
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

    def test_it_scans_the_files_in_the_library_and_lists_the_rest(self):
        new = self.write(self.scan_dir, "2026", "new.jpg").path
        outside = self.write(self.root, "bob", "b.jpg").path

        response = self.post({"paths": [new, outside, "/etc/passwd"]})

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["file_count"], 1)
        self.assertEqual(body["ignored_paths"], [outside, "/etc/passwd"])
        [(func, args, kwargs)] = self.recorder.calls
        self.assertIs(func, scan_jobs.scan_photos)
        self.assertEqual(args, (self.user, False))
        self.assertEqual(kwargs["scan_files"], [new])
        self.assertIs(kwargs["force_files"], False)

    def test_nothing_left_is_a_400(self):
        response = self.post({"paths": [os.path.join(self.root, "bob", "x.jpg")]})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "no_files_to_scan")
        self.assertEqual(self.recorder.calls, [])

    def test_the_list_is_capped_and_not_empty(self):
        for paths in ([], ["/x"] * (MAX_REQUESTED + 1)):
            with self.subTest(count=len(paths)):
                response = self.post({"paths": paths})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(api_error(response)["field"], "paths")

    def test_anonymous_callers_are_refused(self):
        response = APIClient().post(self.url, {"paths": ["/x"]}, format="json")

        self.assertEqual(response.status_code, 401)

    def test_basic_credentials_work_for_a_script(self):
        self.user.set_password("secret-pass-1")
        self.user.save()
        new = self.write(self.scan_dir, "new.jpg").path
        client = APIClient()
        token = base64.b64encode(f"{self.user.username}:secret-pass-1".encode())
        client.credentials(HTTP_AUTHORIZATION=f"Basic {token.decode()}")

        with recorded_tasks(), self.captureOnCommitCallbacks(execute=True):
            response = client.post(self.url, {"paths": [new]}, format="json")

        self.assertEqual(response.status_code, 200, response.content)
