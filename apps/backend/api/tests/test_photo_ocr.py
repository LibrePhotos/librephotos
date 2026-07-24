"""Tests for the OCR model, extraction job and image-source helper.

The OCR sidecar (Flask service on :8012) is never contacted for real here:
``requests.post`` is mocked with a fake service response. The parent
``generate_ocr`` fans work out via ``AsyncTask``; since no qcluster runs under
the test settings we patch ``AsyncTask`` so ``.run()`` executes the worker
synchronously, exactly as a real worker would.
"""

import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    generate_ocr,
    generate_ocr_job,
    ocr_image_source,
)
from api.models import LongRunningJob, PhotoOcr
from api.tests.utils import (
    ONE_PIXEL_PNG,
    create_test_file,
    create_test_photo,
    create_test_user,
)

ACTIVE_MODEL = "ppocrv6_small"


class _SyncAsyncTask:
    """Drop-in for ``AsyncTask`` that runs the target synchronously on ``run()``."""

    def __init__(self, func, *args, **kwargs):
        self.func = func
        self.args = args
        self.kwargs = kwargs

    def run(self):
        return self.func(*self.args, **self.kwargs)


def _ok_response(text="hello world", blocks=None, mean_conf=0.91, area=0.12):
    response = MagicMock()
    response.ok = True
    response.status_code = 201
    response.json.return_value = {
        "text": text,
        "blocks": blocks
        if blocks is not None
        else [{"text": "hello", "box": [0, 0, 10, 10], "confidence": 0.9}],
        "mean_confidence": mean_conf,
        "text_area_fraction": area,
    }
    return response


def _error_response(status_code=500):
    response = MagicMock()
    response.ok = False
    response.status_code = status_code
    return response


def _make_job(user, job_id, target=1):
    return LongRunningJob.objects.create(
        started_by=user,
        job_id=str(job_id),
        job_type=LongRunningJob.JOB_GENERATE_OCR,
        queued_at=timezone.now(),
        progress_target=target,
    )


class PhotoOcrModelTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_create_and_str(self):
        ocr = PhotoOcr.objects.create(
            photo=self.photo,
            text="some text",
            blocks=[{"text": "some", "box": [0, 0, 1, 1], "confidence": 0.8}],
            engine=ACTIVE_MODEL,
            mean_confidence=0.8,
            text_area_fraction=0.1,
        )
        self.assertEqual(ocr.photo, self.photo)
        self.assertIn(self.photo.image_hash, str(ocr))
        self.assertIs(self.photo.ocr, ocr)

    def test_registered_in_models_package(self):
        from api import models

        self.assertIn("PhotoOcr", models.__all__)

    def test_cascade_delete_with_photo(self):
        PhotoOcr.objects.create(photo=self.photo, engine=ACTIVE_MODEL)
        photo_id = self.photo.image_hash
        self.photo.delete()
        with self.assertRaises(PhotoOcr.DoesNotExist):
            PhotoOcr.objects.get(photo_id=photo_id)

    def test_text_and_blocks_caps_on_save(self):
        long_text = "a" * (PhotoOcr.MAX_TEXT_LENGTH + 5000)
        many_blocks = [{"text": "x"} for _ in range(PhotoOcr.MAX_BLOCKS + 200)]
        ocr = PhotoOcr.objects.create(
            photo=self.photo,
            text=long_text,
            blocks=many_blocks,
            engine=ACTIVE_MODEL,
        )
        ocr.refresh_from_db()
        self.assertEqual(len(ocr.text), PhotoOcr.MAX_TEXT_LENGTH)
        self.assertEqual(len(ocr.blocks), PhotoOcr.MAX_BLOCKS)


class OcrImageSourceHelperTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_cv2_decodable_original_uses_original(self):
        # create_test_photo sets main_file to a .png (directly cv2-decodable).
        photo = create_test_photo(owner=self.user)
        self.assertEqual(ocr_image_source(photo), photo.main_file.path)

    def test_raw_original_falls_back_to_thumbnail(self):
        photo = create_test_photo(owner=self.user)
        raw_path = f"/tmp/{photo.image_hash}.CR2"
        raw_file = create_test_file(raw_path, self.user, ONE_PIXEL_PNG + photo.pk.bytes)
        photo.main_file = raw_file
        photo.save()

        source = ocr_image_source(photo)
        self.assertEqual(source, photo.thumbnail.thumbnail_big.path)
        self.assertNotEqual(source, raw_path)


@override_config(OCR_MODEL=ACTIVE_MODEL)
class GenerateOcrWorkerTest(TestCase):
    """Per-photo worker: writes rows, applies caps, counts failures."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    @patch("requests.post")
    def test_worker_writes_ocr_row(self, mock_post):
        mock_post.return_value = _ok_response(text="receipt total 12.50")
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(self.photo, job_id)

        ocr = PhotoOcr.objects.get(photo=self.photo)
        self.assertEqual(ocr.text, "receipt total 12.50")
        self.assertEqual(ocr.engine, ACTIVE_MODEL)
        self.assertEqual(ocr.blocks[0]["text"], "hello")
        self.assertAlmostEqual(ocr.mean_confidence, 0.91)
        self.assertAlmostEqual(ocr.text_area_fraction, 0.12)

        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    @patch("requests.post")
    def test_worker_applies_text_cap(self, mock_post):
        long_text = "z" * (PhotoOcr.MAX_TEXT_LENGTH + 10000)
        many_blocks = [{"text": "x"} for _ in range(PhotoOcr.MAX_BLOCKS + 50)]
        mock_post.return_value = _ok_response(text=long_text, blocks=many_blocks)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(self.photo, job_id)

        ocr = PhotoOcr.objects.get(photo=self.photo)
        self.assertEqual(len(ocr.text), PhotoOcr.MAX_TEXT_LENGTH)
        self.assertEqual(len(ocr.blocks), PhotoOcr.MAX_BLOCKS)

    @patch("requests.post")
    def test_worker_applies_cap_on_update(self, mock_post):
        # First write a small row, then re-run so update_or_create takes the
        # UPDATE branch with an over-long payload -- caps must still apply.
        mock_post.return_value = _ok_response(text="short")
        first_job = uuid.uuid4()
        _make_job(self.user, first_job, target=1)
        generate_ocr_job(self.photo, first_job)
        self.assertEqual(len(PhotoOcr.objects.get(photo=self.photo).text), 5)

        long_text = "z" * (PhotoOcr.MAX_TEXT_LENGTH + 10000)
        many_blocks = [{"text": "x"} for _ in range(PhotoOcr.MAX_BLOCKS + 50)]
        mock_post.return_value = _ok_response(text=long_text, blocks=many_blocks)
        second_job = uuid.uuid4()
        _make_job(self.user, second_job, target=1)
        generate_ocr_job(self.photo, second_job)

        ocr = PhotoOcr.objects.get(photo=self.photo)
        self.assertEqual(len(ocr.text), PhotoOcr.MAX_TEXT_LENGTH)
        self.assertEqual(len(ocr.blocks), PhotoOcr.MAX_BLOCKS)

    @patch("requests.post")
    def test_worker_counts_failure_on_500(self, mock_post):
        mock_post.return_value = _error_response(500)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(self.photo, job_id)

        self.assertFalse(PhotoOcr.objects.filter(photo=self.photo).exists())
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertEqual(job.result.get("error_count"), 1)
        self.assertTrue(job.finished)


@override_config(OCR_MODEL=ACTIVE_MODEL)
class GenerateOcrJobTest(TestCase):
    """Parent dispatcher: query selection, idempotency, cancellation."""

    def setUp(self):
        self.user = create_test_user()

    def _run(self, job_id=None, full_scan=False):
        job_id = job_id or uuid.uuid4()
        with patch.object(processing_jobs, "AsyncTask", _SyncAsyncTask):
            generate_ocr(self.user, job_id, full_scan=full_scan)
        return job_id

    @patch("requests.post")
    def test_creates_rows_for_all_photos(self, mock_post):
        mock_post.return_value = _ok_response()
        photos = [create_test_photo(owner=self.user) for _ in range(3)]

        job_id = self._run()

        for p in photos:
            self.assertTrue(PhotoOcr.objects.filter(photo=p).exists())
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertEqual(job.progress_target, 3)
        self.assertEqual(job.progress_current, 3)
        self.assertTrue(job.finished)

    @patch("requests.post")
    def test_skips_photos_done_with_same_engine(self, mock_post):
        mock_post.return_value = _ok_response()
        create_test_photo(owner=self.user)

        self._run()  # first pass processes it
        self.assertEqual(mock_post.call_count, 1)

        # Second pass with the same active model should process nothing.
        second_job = self._run()
        self.assertEqual(mock_post.call_count, 1)
        job = LongRunningJob.objects.get(job_id=str(second_job))
        self.assertEqual(job.progress_target, 0)
        self.assertTrue(job.finished)

    @patch("requests.post")
    def test_full_scan_reprocesses_done_photos(self, mock_post):
        mock_post.return_value = _ok_response()
        create_test_photo(owner=self.user)

        self._run()
        self.assertEqual(mock_post.call_count, 1)

        second_job = self._run(full_scan=True)
        self.assertEqual(mock_post.call_count, 2)
        job = LongRunningJob.objects.get(job_id=str(second_job))
        self.assertEqual(job.progress_target, 1)

    @patch("requests.post")
    def test_engine_change_reprocesses(self, mock_post):
        mock_post.return_value = _ok_response()
        photo = create_test_photo(owner=self.user)

        self._run()  # engine = ACTIVE_MODEL
        self.assertEqual(mock_post.call_count, 1)

        with override_config(OCR_MODEL="ppocrv6_mobile"):
            third_job = self._run()  # incremental run, new engine
        self.assertEqual(mock_post.call_count, 2)
        photo.refresh_from_db()
        self.assertEqual(photo.ocr.engine, "ppocrv6_mobile")
        job = LongRunningJob.objects.get(job_id=str(third_job))
        self.assertEqual(job.progress_target, 1)

    @patch("requests.post")
    def test_video_photos_skipped(self, mock_post):
        mock_post.return_value = _ok_response()
        image = create_test_photo(owner=self.user)
        video = create_test_photo(owner=self.user, video=True)

        self._run()

        self.assertTrue(PhotoOcr.objects.filter(photo=image).exists())
        self.assertFalse(PhotoOcr.objects.filter(photo=video).exists())
        self.assertEqual(mock_post.call_count, 1)

    @patch("requests.post")
    def test_ocr_model_none_finishes_clean(self, mock_post):
        create_test_photo(owner=self.user)
        with override_config(OCR_MODEL="None"):
            job_id = self._run()

        self.assertEqual(mock_post.call_count, 0)
        self.assertEqual(PhotoOcr.objects.count(), 0)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)

    @patch("requests.post")
    def test_ocr_model_lowercase_none_is_disabled(self, mock_post):
        # ml_models treats "", None and any-case "none" as disabled; the job
        # must use the same semantics rather than only matching literal "None".
        create_test_photo(owner=self.user)
        with override_config(OCR_MODEL="none"):
            job_id = self._run()

        self.assertEqual(mock_post.call_count, 0)
        self.assertEqual(PhotoOcr.objects.count(), 0)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)

    @patch("requests.post")
    def test_enable_after_disabled_run_processes_backlog(self, mock_post):
        # Regression: a disabled run must not leave a finished baseline that
        # makes a later incremental run skip every pre-existing photo.
        mock_post.return_value = _ok_response()
        photo = create_test_photo(owner=self.user)

        with override_config(OCR_MODEL="None"):
            self._run()  # disabled no-op (zero-target finished job)
        self.assertEqual(mock_post.call_count, 0)

        # Now enable OCR (class decorator sets ACTIVE_MODEL) and run incrementally.
        job_id = self._run()

        self.assertTrue(PhotoOcr.objects.filter(photo=photo).exists())
        self.assertEqual(mock_post.call_count, 1)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertEqual(job.progress_target, 1)

    @patch("requests.post")
    def test_old_unocrd_photo_skipped_incrementally_but_full_scan_processes(
        self, mock_post
    ):
        # Case 4: a photo with no OCR that predates the last productive run is
        # outside the incremental window and stays skipped; full_scan gets it.
        mock_post.return_value = _ok_response()
        photo = create_test_photo(owner=self.user)

        # A prior productive OCR run that finished AFTER this photo was added
        # but did not cover it (target > 0 so it counts as a real baseline).
        baseline_start = timezone.now() + timedelta(hours=1)
        LongRunningJob.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_GENERATE_OCR,
            queued_at=timezone.now(),
            started_at=baseline_start,
            finished=True,
            finished_at=baseline_start,
            progress_target=5,
            progress_current=5,
        )

        incremental_job = self._run()
        self.assertFalse(PhotoOcr.objects.filter(photo=photo).exists())
        self.assertEqual(mock_post.call_count, 0)
        job = LongRunningJob.objects.get(job_id=str(incremental_job))
        self.assertEqual(job.progress_target, 0)

        self._run(full_scan=True)
        self.assertTrue(PhotoOcr.objects.filter(photo=photo).exists())
        self.assertEqual(mock_post.call_count, 1)

    @patch("requests.post")
    def test_cancellation_stops_dispatch(self, mock_post):
        mock_post.return_value = _ok_response()
        create_test_photo(owner=self.user)

        job_id = uuid.uuid4()
        # Pre-create the job already cancelled; get_or_create_job will reuse it.
        job = _make_job(self.user, job_id, target=0)
        job.cancel()

        dispatch = MagicMock(side_effect=_SyncAsyncTask)
        with patch.object(processing_jobs, "AsyncTask", dispatch):
            generate_ocr(self.user, job_id)

        dispatch.assert_not_called()
        self.assertEqual(PhotoOcr.objects.count(), 0)
