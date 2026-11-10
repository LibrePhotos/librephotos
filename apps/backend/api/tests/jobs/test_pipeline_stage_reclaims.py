"""Per-photo pipeline markers that used to leave a photo stuck.

- A photo whose thumbnail has no aspect ratio is in no grid, and an
  incremental scan took its file as known: the processing status did not
  count it and nothing made it again. The status counts it now, and the
  next scan reads its file again, as it does after a failed metadata read.
- Scan Faces read photos whose thumbnail row had no big thumbnail, and failed
  on them every run; they wait for the thumbnail now, as OCR and captions do.
- OCR leaves a photo out of the automatic runs after ``OCR_MAX_FAILURES``
  failed calls; Extract started by hand tries those photos again.
- Face detection turned off while Scan Faces or Generate Face Embeddings
  waited or ran: the jobs end cleanly instead of asking a stopped sidecar
  about every face.
"""

import uuid
from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    OCR_MAX_FAILURES,
    generate_face_embeddings,
    generate_ocr,
    needs_face_scan,
    needs_thumbnails,
    queue_ocr_followup,
    scan_faces,
)
from api.directory_watcher.scan_jobs import _known_paths
from api.models import Face, LongRunningJob, Photo, Thumbnail
from api.tests.ocr.test_ocr_job_and_model import ACTIVE_MODEL, _error_response
from api.tests.ocr.test_ocr_job_and_model import _run_now as run_now
from api.tests.utils import (
    create_test_face,
    create_test_job,
    create_test_photo,
    create_test_user,
)


def _job(job_id: uuid.UUID) -> LongRunningJob:
    return LongRunningJob.objects.get(job_id=str(job_id))


class ThumbnailNotReadyTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=self.photo.pk).update(metadata_read_at=timezone.now())
        self.photo.files.add(self.photo.main_file)
        self.path = self.photo.main_file.path

    def _no_aspect_ratio(self):
        Thumbnail.objects.filter(photo=self.photo).update(aspect_ratio=None)

    def test_a_ready_photo_is_known_to_the_scan(self):
        self.assertIn(self.path, _known_paths([self.path]))

    def test_the_next_scan_reads_a_photo_without_an_aspect_ratio_again(self):
        self._no_aspect_ratio()

        self.assertNotIn(self.path, _known_paths([self.path]))

    def test_the_status_counts_a_photo_without_an_aspect_ratio(self):
        self.assertFalse(Photo.objects.filter(needs_thumbnails()).exists())

        self._no_aspect_ratio()

        self.assertEqual(
            [self.photo.pk],
            list(Photo.objects.filter(needs_thumbnails()).values_list("pk", flat=True)),
        )

    def test_scan_faces_waits_for_the_big_thumbnail(self):
        self.assertTrue(Photo.objects.filter(needs_face_scan()).exists())

        Thumbnail.objects.filter(photo=self.photo).update(thumbnail_big="")

        self.assertFalse(Photo.objects.filter(needs_face_scan()).exists())


@override_config(OCR_MODEL=ACTIVE_MODEL)
class OcrGivenUpRetryTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=self.photo.pk).update(ocr_failures=OCR_MAX_FAILURES)

    def _run(self, **kwargs: bool) -> LongRunningJob:
        job_id = uuid.uuid4()
        with (
            patch.object(processing_jobs, "enqueue_task", side_effect=run_now),
            patch("api.runtime.sidecars.http.post") as post,
        ):
            post.return_value = _error_response(500)
            generate_ocr(self.user, job_id, **kwargs)
        return _job(job_id)

    def test_an_automatic_run_leaves_a_given_up_photo_alone(self):
        self.assertEqual(0, self._run().progress_target)

    def test_a_run_started_by_hand_tries_it_again(self):
        job = self._run(retry_given_up=True)

        self.assertEqual(1, job.progress_target)
        self.photo.refresh_from_db()
        self.assertEqual(OCR_MAX_FAILURES + 1, self.photo.ocr_failures)

    def test_extract_by_hand_asks_for_the_retry(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        with patch("api.views.scan_triggers.start_job") as start:
            start.return_value = Response()
            client.post("/api/generateocr/", {"full_scan": False}, format="json")

        self.assertTrue(start.call_args.kwargs["retry_given_up"])

    def test_the_follow_up_does_not_ask_for_it(self):
        with patch.object(processing_jobs, "enqueue_job") as enqueue:
            queue_ocr_followup(self.user)

        self.assertNotIn("retry_given_up", enqueue.call_args.kwargs)


@override_settings(FEATURE_FACE_DETECTION=False)
class FaceDetectionTurnedOffTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        photo = create_test_photo(owner=self.user)
        face = create_test_face(photo=photo)
        Face.objects.filter(pk=face.pk).update(encoding="")

    def test_face_embeddings_end_without_asking_the_face_service(self):
        job = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS
        )

        with patch("api.faces.photo_faces.generate_face_encoding") as encode:
            generate_face_embeddings(self.user, job.job_id)

        encode.assert_not_called()
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_scan_faces_ends_with_nothing_to_do(self):
        job = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_SCAN_FACES
        )

        with (
            patch.object(processing_jobs, "_extract_faces_for_photo") as extract,
            patch.object(processing_jobs, "_encode_and_cluster") as encode,
        ):
            scan_faces(self.user, job.job_id)

        extract.assert_not_called()
        encode.assert_not_called()
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertEqual(0, job.progress_target)
