"""OCR the photos that still need it, after scans and uploads (#2736).

OCR only ran when started by hand, and its incremental run took "photos
added since the last run", so a photo whose thumbnail was not ready or whose
call failed could be skipped for good. Photos are now selected by need, a
failed call is counted, and scans and uploads queue the job while a model is
selected. The OCR sidecar is never contacted: its client is mocked.
"""

import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests
from constance.test import override_config
from django.test import TestCase
from django.utils import timezone
from django_q.models import Schedule

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    OCR_MAX_FAILURES,
    generate_ocr,
    generate_ocr_job,
    photos_needing_ocr,
    queue_ocr_followup,
)
from api.directory_watcher.scan_jobs import _queue_followup_jobs
from api.jobs.upload_followups import (
    FollowupRun,
    extract_text,
    request_upload_followups,
    run_upload_followups,
)
from api.models import LongRunningJob, Photo
from api.tests.ocr.test_ocr_job_and_model import (
    ACTIVE_MODEL,
    _error_response,
    _ok_response,
    _run_now,
)
from api.tests.utils import (
    create_test_job,
    create_test_photo,
    create_test_photo_ocr,
    create_test_user,
)


def _ocr_jobs(user):
    return LongRunningJob.objects.owned_by(user).filter(
        job_type=LongRunningJob.JOB_GENERATE_OCR
    )


@override_config(OCR_MODEL=ACTIVE_MODEL)
class PhotosNeedingOcrTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _needing(self):
        return set(photos_needing_ocr(self.user, ACTIVE_MODEL))

    def _read_with(self, photo, engine):
        create_test_photo_ocr(photo, engine=engine)

    def test_a_photo_without_text_needs_it(self):
        photo = create_test_photo(owner=self.user)

        self.assertEqual({photo}, self._needing())

    def test_a_photo_read_by_the_active_model_does_not(self):
        self._read_with(create_test_photo(owner=self.user), ACTIVE_MODEL)

        self.assertEqual(set(), self._needing())

    def test_a_photo_read_by_another_model_does(self):
        photo = create_test_photo(owner=self.user)
        self._read_with(photo, "ppocrv6_mobile")

        self.assertEqual({photo}, self._needing())

    def test_videos_photos_without_a_thumbnail_and_other_users_do_not(self):
        create_test_photo(owner=self.user, video=True)
        create_test_photo(owner=self.user, thumbnail_big="")
        create_test_photo(owner=create_test_user())

        self.assertEqual(set(), self._needing())

    def test_a_photo_stops_needing_it_after_the_failure_limit(self):
        almost = create_test_photo(owner=self.user, ocr_failures=OCR_MAX_FAILURES - 1)
        create_test_photo(owner=self.user, ocr_failures=OCR_MAX_FAILURES)

        self.assertEqual({almost}, self._needing())


@override_config(OCR_MODEL=ACTIVE_MODEL)
class OcrFailureCountTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def _work(self):
        job = create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_GENERATE_OCR,
            progress_target=1,
        )
        generate_ocr_job(self.photo.pk, job.job_id)
        self.photo.refresh_from_db()
        return self.photo.ocr_failures

    @patch("api.runtime.sidecars.http.post")
    def test_a_failed_call_is_counted(self, mock_post):
        mock_post.return_value = _error_response(500)

        self.assertEqual(1, self._work())
        self.assertEqual(2, self._work())

    @patch("api.runtime.sidecars.http.post")
    def test_an_unreachable_service_is_not(self, mock_post):
        mock_post.side_effect = requests.ConnectionError("refused")

        self.assertEqual(0, self._work())

    @patch("api.runtime.sidecars.http.post")
    def test_a_success_clears_the_count(self, mock_post):
        Photo.objects.filter(pk=self.photo.pk).update(ocr_failures=2)
        mock_post.return_value = _ok_response()

        self.assertEqual(0, self._work())

    @patch("api.runtime.sidecars.http.post")
    def test_a_photo_that_failed_three_times_is_not_retried(self, mock_post):
        mock_post.return_value = _error_response(500)
        with patch.object(processing_jobs, "enqueue_task", side_effect=_run_now):
            for _ in range(OCR_MAX_FAILURES):
                generate_ocr(self.user, uuid.uuid4())
            last_run = uuid.uuid4()
            generate_ocr(self.user, last_run)

        self.assertEqual(OCR_MAX_FAILURES, mock_post.call_count)
        job = LongRunningJob.objects.get(job_id=str(last_run))
        self.assertEqual(0, job.progress_target)

        # Extract text again for all photos still tries it.
        with patch.object(processing_jobs, "enqueue_task", side_effect=_run_now):
            generate_ocr(self.user, uuid.uuid4(), full_scan=True)
        self.assertEqual(OCR_MAX_FAILURES + 1, mock_post.call_count)


class OcrFollowupTriggerTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        create_test_photo(owner=self.user)

    @override_config(OCR_MODEL=ACTIVE_MODEL)
    def test_a_finished_scan_queues_ocr(self):
        _queue_followup_jobs(self.user, full_scan=False, scan_missing=False)

        self.assertEqual(1, _ocr_jobs(self.user).count())

    @override_config(OCR_MODEL="None")
    def test_no_model_queues_nothing(self):
        _queue_followup_jobs(self.user, full_scan=False, scan_missing=False)
        extract_text(FollowupRun(self.user, photos_added=True, heartbeat=MagicMock()))

        self.assertFalse(_ocr_jobs(self.user).exists())

    @override_config(OCR_MODEL=ACTIVE_MODEL)
    def test_nothing_left_to_read_queues_nothing(self):
        Photo.objects.owned_by(self.user).update(ocr_failures=OCR_MAX_FAILURES)

        _queue_followup_jobs(self.user, full_scan=False, scan_missing=False)

        self.assertFalse(_ocr_jobs(self.user).exists())

    @override_config(OCR_MODEL=ACTIVE_MODEL)
    def test_the_upload_follow_ups_queue_ocr(self):
        extract_text(FollowupRun(self.user, photos_added=True, heartbeat=MagicMock()))

        self.assertEqual(1, _ocr_jobs(self.user).count())

    @override_config(OCR_MODEL=ACTIVE_MODEL)
    def test_a_follow_up_run_after_an_upload_queues_ocr(self):
        request_upload_followups(self.user)
        with (
            patch("api.jobs.upload_followups.batch_calculate_clip_embedding"),
            patch("api.jobs.upload_followups.build_image_similarity_index"),
            patch("api.jobs.upload_followups.generate_face_embeddings"),
        ):
            run_upload_followups(self.user.id)

        self.assertEqual(1, _ocr_jobs(self.user).count())

    @override_config(OCR_MODEL=ACTIVE_MODEL)
    def test_a_running_ocr_job_is_not_doubled_and_re_arms_the_upload_run(self):
        create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_GENERATE_OCR,
            started_at=timezone.now(),
        )

        self.assertFalse(queue_ocr_followup(self.user))
        before = timezone.now()
        extract_text(FollowupRun(self.user, photos_added=True, heartbeat=MagicMock()))

        self.assertEqual(1, _ocr_jobs(self.user).count())
        [schedule] = Schedule.objects.filter(name=f"upload-followups-{self.user.id}")
        self.assertGreater(schedule.next_run, before + timedelta(minutes=5))
