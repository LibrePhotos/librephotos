"""Characterization tests for ``scan_jobs.scan_photos`` (CRAP unit 8).

These pin the CURRENT behavior of the two-phase scan orchestrator before it is
refactored: which walker is used, how files are grouped into image groups vs
metadata paths, which follow-up tasks are enqueued (sentinel, scan_missing_photos,
repair, feature-flagged jobs, the CLIP/face chain), how the progress target is
computed, when the job is auto-finished, and what happens on failure.

Everything that leaves the process is mocked: ``AsyncTask``/``Chain`` are
recorders, the directory walkers are patched, and ``MEDIA_ROOT`` points at a
temp dir so the thumbnail ``makedirs`` calls are harmless. No ML models, no
network, no exiftool.
"""

import datetime
import os
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from api.directory_watcher import scan_jobs
from api.directory_watcher.scan_jobs import scan_photos
from api.models import LongRunningJob
from api.tests.utils import create_test_user


class TaskRecorder:
    """Stand-in for ``AsyncTask`` that records every enqueued task."""

    def __init__(self, calls):
        self.calls = calls

    def __call__(self, func, *args, **kwargs):
        self.calls.append((func, args, kwargs))
        return self

    def run(self):
        return None

    def funcs(self):
        return [call[0] for call in self.calls]

    def find(self, func):
        return [call for call in self.calls if call[0] is func]


class ChainRecorder:
    """Stand-in for ``Chain``; the last instance is kept on the class."""

    last = None

    def __init__(self, *args, **kwargs):
        self.appended = []
        self.ran = False
        ChainRecorder.last = self

    def append(self, func, *args, **kwargs):
        self.appended.append((func, args, kwargs))
        return self

    def run(self):
        self.ran = True


class ScanPhotosCharacterizationBase(TestCase):
    def setUp(self):
        self.media_root = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_root.cleanup)
        self.scan_dir = os.path.join(self.media_root.name, "photos")
        os.makedirs(self.scan_dir, exist_ok=True)
        self.user = create_test_user()
        self.user.scan_directory = self.scan_dir
        self.user.save(update_fields=["scan_directory"])
        self.job_id = str(uuid.uuid4())
        self.tasks = []
        ChainRecorder.last = None

    def run_scan(
        self,
        *,
        walk_result=None,
        full_scan=False,
        scan_directory="",
        scan_files=None,
        select_groups=None,
        walk_directory_side_effect=None,
        job_id=None,
        flags=None,
    ):
        """Run ``scan_photos`` with every external effect recorded/mocked.

        ``walk_result`` is the list of paths the walker appends to ``photo_list``.
        Returns a dict with the recorder handles used by the assertions.
        """
        walk_result = walk_result or []
        recorder = TaskRecorder(self.tasks)

        def fake_walk(target, photo_list):
            if walk_directory_side_effect is not None:
                raise walk_directory_side_effect
            photo_list.extend(walk_result)

        settings_overrides = {
            "MEDIA_ROOT": self.media_root.name,
            "FEATURE_SCENE_CLASSIFICATION": False,
            "FEATURE_REVERSE_GEOCODING": False,
            "FEATURE_FACE_DETECTION": False,
        }
        settings_overrides.update(flags or {})

        select_patch = (
            patch.object(scan_jobs, "_select_groups_to_process", select_groups)
            if select_groups is not None
            else patch.object(
                scan_jobs,
                "_select_groups_to_process",
                wraps=scan_jobs._select_groups_to_process,
            )
        )

        with override_settings(**settings_overrides):
            with (
                patch.object(scan_jobs, "AsyncTask", recorder),
                patch.object(scan_jobs, "Chain", ChainRecorder),
                patch.object(
                    scan_jobs, "walk_directory", side_effect=fake_walk
                ) as walk_directory,
                patch.object(
                    scan_jobs, "walk_files", side_effect=fake_walk
                ) as walk_files,
                patch.object(scan_jobs, "photo_scanner") as photo_scanner,
                patch.object(scan_jobs, "backfill_missing_aspect_ratios") as backfill,
                patch.object(scan_jobs.db.connections, "close_all"),
                select_patch as select_mock,
            ):
                scan_photos(
                    self.user,
                    full_scan,
                    job_id or self.job_id,
                    scan_directory=scan_directory,
                    scan_files=scan_files,
                )

        return {
            "tasks": recorder,
            "walk_directory": walk_directory,
            "walk_files": walk_files,
            "photo_scanner": photo_scanner,
            "backfill": backfill,
            "select": select_mock,
            "chain": ChainRecorder.last,
        }

    def job(self, job_id=None):
        return LongRunningJob.objects.get(job_id=job_id or self.job_id)


class WalkerSelectionTest(ScanPhotosCharacterizationBase):
    def test_walk_directory_used_with_user_scan_directory_by_default(self):
        res = self.run_scan()
        res["walk_directory"].assert_called_once()
        self.assertEqual(res["walk_directory"].call_args[0][0], self.scan_dir)
        res["walk_files"].assert_not_called()

    def test_explicit_scan_directory_overrides_user_default(self):
        other = os.path.join(self.media_root.name, "other")
        res = self.run_scan(scan_directory=other)
        self.assertEqual(res["walk_directory"].call_args[0][0], other)

    def test_scan_files_uses_walk_files_and_skips_walk_directory(self):
        files = ["/p/a.jpg"]
        res = self.run_scan(scan_files=files, walk_result=files)
        res["walk_files"].assert_called_once()
        self.assertEqual(res["walk_files"].call_args[0][0], files)
        res["walk_directory"].assert_not_called()

    def test_empty_scan_files_list_falls_back_to_walk_directory(self):
        """``scan_files=[]`` is falsy, so the directory walker is used."""
        res = self.run_scan(scan_files=[])
        res["walk_directory"].assert_called_once()
        res["walk_files"].assert_not_called()


class GroupingAndQueueingTest(ScanPhotosCharacterizationBase):
    def test_raw_and_jpeg_variants_queued_as_one_group(self):
        res = self.run_scan(
            walk_result=["/p/IMG_1.jpg", "/p/IMG_1.CR2", "/p/IMG_2.jpg"]
        )
        group_tasks = res["tasks"].find(scan_jobs.handle_file_group)
        self.assertEqual(len(group_tasks), 2)
        queued_paths = sorted(sorted(call[1][1]) for call in group_tasks)
        self.assertEqual(
            queued_paths, [["/p/IMG_1.CR2", "/p/IMG_1.jpg"], ["/p/IMG_2.jpg"]]
        )

    def test_group_tasks_share_one_group_id_and_carry_user_and_job(self):
        res = self.run_scan(walk_result=["/p/a.jpg", "/p/b.jpg"])
        group_tasks = res["tasks"].find(scan_jobs.handle_file_group)
        group_ids = {call[2]["group"] for call in group_tasks}
        self.assertEqual(len(group_ids), 1)
        # group id is a uuid4 string
        uuid.UUID(group_ids.pop())
        for _func, args, _kwargs in group_tasks:
            self.assertIs(args[0], self.user)
            self.assertEqual(args[2], self.job_id)

    def test_metadata_only_scan_calls_photo_scanner_directly(self):
        res = self.run_scan(walk_result=["/p/a.xmp", "/p/b.XMP"])
        self.assertEqual(res["photo_scanner"].call_count, 2)
        self.assertEqual(res["tasks"].find(scan_jobs.handle_file_group), [])
        self.assertEqual(
            res["tasks"].find(scan_jobs.wait_for_group_and_process_metadata), []
        )
        called_paths = sorted(c[0][3] for c in res["photo_scanner"].call_args_list)
        self.assertEqual(called_paths, ["/p/a.xmp", "/p/b.XMP"])

    def test_images_plus_metadata_enqueue_sentinel_instead_of_direct_scan(self):
        res = self.run_scan(walk_result=["/p/a.jpg", "/p/b.jpg", "/p/a.xmp"])
        res["photo_scanner"].assert_not_called()
        sentinel = res["tasks"].find(scan_jobs.wait_for_group_and_process_metadata)
        self.assertEqual(len(sentinel), 1)
        _func, args, kwargs = sentinel[0]
        group_id, metadata_paths, user_id, full_scan, job_id, expected = args
        self.assertEqual(metadata_paths, ["/p/a.xmp"])
        self.assertEqual(user_id, self.user.id)
        self.assertFalse(full_scan)
        self.assertEqual(job_id, self.job_id)
        # expected count == number of image groups, not number of files
        self.assertEqual(expected, 2)
        self.assertEqual(kwargs, {"attempt": 1, "max_attempts": 2})
        # the sentinel waits on the same group id the image tasks were queued in
        image_group_ids = {
            c[2]["group"] for c in res["tasks"].find(scan_jobs.handle_file_group)
        }
        self.assertEqual({group_id}, image_group_ids)

    def test_images_without_metadata_enqueue_no_sentinel(self):
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertEqual(
            res["tasks"].find(scan_jobs.wait_for_group_and_process_metadata), []
        )
        res["photo_scanner"].assert_not_called()

    def test_all_groups_skipped_but_metadata_present_falls_back_to_photo_scanner(self):
        """When the selector drops every image group, metadata is processed inline."""
        res = self.run_scan(
            walk_result=["/p/a.jpg", "/p/a.xmp"],
            select_groups=lambda *a, **kw: [],
        )
        self.assertEqual(res["tasks"].find(scan_jobs.handle_file_group), [])
        self.assertEqual(res["photo_scanner"].call_count, 1)


class ProgressAndCompletionTest(ScanPhotosCharacterizationBase):
    def test_progress_target_counts_groups_plus_metadata_files(self):
        self.run_scan(walk_result=["/p/a.jpg", "/p/a.cr2", "/p/b.jpg", "/p/a.xmp"])
        job = self.job()
        # 2 image groups + 1 metadata file
        self.assertEqual(job.progress_target, 3)
        self.assertEqual(job.progress_current, 0)

    def test_empty_scan_marks_job_finished_immediately(self):
        self.run_scan(walk_result=[])
        job = self.job()
        self.assertEqual(job.progress_target, 0)
        self.assertTrue(job.finished)
        self.assertIsNotNone(job.finished_at)
        self.assertFalse(job.failed)

    def test_scan_with_work_left_does_not_finish_the_job(self):
        self.run_scan(walk_result=["/p/a.jpg"])
        self.assertFalse(self.job().finished)

    def test_job_row_is_created_and_started(self):
        self.run_scan(walk_result=["/p/a.jpg"])
        job = self.job()
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertEqual(job.started_by_id, self.user.id)
        self.assertIsNotNone(job.started_at)

    def test_existing_job_row_is_reused(self):
        LongRunningJob.objects.create(
            started_by=self.user,
            job_id=self.job_id,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now(),
        )
        self.run_scan(walk_result=[])
        self.assertEqual(LongRunningJob.objects.filter(job_id=self.job_id).count(), 1)

    def test_backfill_missing_aspect_ratios_runs_for_the_user(self):
        res = self.run_scan(walk_result=["/p/a.jpg"])
        res["backfill"].assert_called_once_with(self.user)


class LastScanBaselineTest(ScanPhotosCharacterizationBase):
    def test_selector_receives_latest_finished_scan_as_baseline(self):
        older = LongRunningJob.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now(),
            finished=True,
            finished_at=timezone.now() - datetime.timedelta(days=2),
        )
        newest = LongRunningJob.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now(),
            finished=True,
            finished_at=timezone.now(),
        )
        res = self.run_scan(walk_result=["/p/a.jpg"])
        _group_items, _known, full_scan, last_scan = res["select"].call_args[0]
        self.assertFalse(full_scan)
        self.assertEqual(last_scan.pk, newest.pk)
        self.assertNotEqual(last_scan.pk, older.pk)

    def test_no_previous_scan_gives_none_baseline(self):
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertIsNone(res["select"].call_args[0][3])

    def test_unfinished_previous_scan_is_not_a_baseline(self):
        LongRunningJob.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now(),
            finished=False,
        )
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertIsNone(res["select"].call_args[0][3])

    def test_other_users_finished_scan_is_not_a_baseline(self):
        other_user = create_test_user()
        LongRunningJob.objects.create(
            started_by=other_user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now(),
            finished=True,
            finished_at=timezone.now(),
        )
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertIsNone(res["select"].call_args[0][3])


class FollowUpTasksTest(ScanPhotosCharacterizationBase):
    def test_scan_missing_photos_queued_for_default_directory_scan(self):
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_scan_missing_photos_skipped_for_custom_directory(self):
        other = os.path.join(self.media_root.name, "other")
        res = self.run_scan(walk_result=["/p/a.jpg"], scan_directory=other)
        self.assertEqual(res["tasks"].find(scan_jobs.scan_missing_photos), [])

    def test_scan_missing_photos_skipped_when_scanning_specific_files(self):
        res = self.run_scan(walk_result=["/p/a.jpg"], scan_files=["/p/a.jpg"])
        self.assertEqual(res["tasks"].find(scan_jobs.scan_missing_photos), [])

    def test_full_scan_always_queues_scan_missing_photos(self):
        other = os.path.join(self.media_root.name, "other")
        res = self.run_scan(
            walk_result=["/p/a.jpg"],
            scan_directory=other,
            scan_files=["/p/a.jpg"],
            full_scan=True,
        )
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_repair_job_always_queued(self):
        res = self.run_scan(walk_result=[])
        repair = res["tasks"].find(scan_jobs.repair_ungrouped_file_variants)
        self.assertEqual(len(repair), 1)
        self.assertIs(repair[0][1][0], self.user)

    def test_feature_flags_off_skip_optional_jobs(self):
        res = self.run_scan(walk_result=["/p/a.jpg"])
        self.assertEqual(res["tasks"].find(scan_jobs.generate_tags), [])
        self.assertEqual(res["tasks"].find(scan_jobs.add_geolocation), [])
        chain_funcs = [entry[0] for entry in res["chain"].appended]
        self.assertEqual(chain_funcs, [scan_jobs.batch_calculate_clip_embedding])
        self.assertTrue(res["chain"].ran)

    def test_feature_flags_on_queue_optional_jobs(self):
        res = self.run_scan(
            walk_result=["/p/a.jpg"],
            full_scan=True,
            flags={
                "FEATURE_SCENE_CLASSIFICATION": True,
                "FEATURE_REVERSE_GEOCODING": True,
                "FEATURE_FACE_DETECTION": True,
            },
        )
        tags = res["tasks"].find(scan_jobs.generate_tags)
        geo = res["tasks"].find(scan_jobs.add_geolocation)
        self.assertEqual(len(tags), 1)
        self.assertEqual(len(geo), 1)
        # (user, job_uuid, full_scan)
        self.assertIs(tags[0][1][0], self.user)
        self.assertTrue(tags[0][1][2])
        chain_funcs = [entry[0] for entry in res["chain"].appended]
        self.assertEqual(
            chain_funcs,
            [scan_jobs.batch_calculate_clip_embedding, scan_jobs.scan_faces],
        )

    def test_clip_embedding_chain_runs_even_on_empty_scan(self):
        res = self.run_scan(walk_result=[])
        self.assertTrue(res["chain"].ran)
        self.assertEqual(
            [entry[0] for entry in res["chain"].appended],
            [scan_jobs.batch_calculate_clip_embedding],
        )


class FailureHandlingTest(ScanPhotosCharacterizationBase):
    def test_walker_exception_fails_the_job_without_raising(self):
        boom = OSError("scan directory exploded")
        self.run_scan(walk_directory_side_effect=boom)
        job = self.job()
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["status"], "failed")
        self.assertIn("scan directory exploded", job.result["error"])

    def test_failure_skips_all_follow_up_tasks(self):
        res = self.run_scan(walk_directory_side_effect=RuntimeError("nope"))
        self.assertEqual(res["tasks"].calls, [])
        self.assertIsNone(res["chain"])
        res["backfill"].assert_not_called()

    def test_thumbnail_directories_are_created_before_the_scan(self):
        self.run_scan(walk_result=[])
        for name in ("square_thumbnails_small", "square_thumbnails", "thumbnails_big"):
            self.assertTrue(os.path.isdir(os.path.join(self.media_root.name, name)))
