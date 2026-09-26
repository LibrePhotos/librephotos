"""Per-user scoping and cancellation of the enrichment jobs.

* ``generate_face_embeddings`` ran for one user but encoded every user's
  pending faces (``Face.objects.filter(encoding="")`` had no owner scope).
* The per-photo fan-out jobs pickled whole ``Photo`` instances into the queue,
  and cancelling a job only stopped more tasks from being queued: the ones
  already in the queue still did all their work.
"""

import uuid
from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    add_geolocation,
    generate_face_embeddings,
    generate_ocr,
    generate_ocr_job,
    generate_tag_job,
    generate_tags,
    geolocation_job,
)
from api.models import Face, LongRunningJob, Photo
from api.models.photo_caption import PhotoCaption
from api.tests.utils import create_test_face, create_test_photo, create_test_user


def _pending_face(user):
    photo = create_test_photo(owner=user)
    face = create_test_face(photo=photo)
    Face.objects.filter(pk=face.pk).update(encoding="")
    return face


def _job(user, job_type, target=1):
    job = LongRunningJob.create_job(user=user, job_type=job_type, start_now=True)
    job.update_progress(current=0, target=target)
    return job


class FaceEmbeddingScopeTest(TestCase):
    def test_only_the_job_owners_pending_faces_are_encoded(self):
        me = create_test_user()
        other = create_test_user()
        mine = _pending_face(me)
        theirs = _pending_face(other)
        encoded = []

        def record(face_self):
            encoded.append(face_self.pk)

        job_id = uuid.uuid4()
        with patch.object(Face, "generate_encoding", autospec=True, side_effect=record):
            generate_face_embeddings(me, job_id)

        self.assertEqual(encoded, [mine.pk])
        self.assertNotIn(theirs.pk, encoded)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertEqual(job.progress_target, 1)

    def test_other_users_pending_faces_do_not_start_a_job(self):
        me = create_test_user()
        _pending_face(create_test_user())

        with patch.object(Face, "generate_encoding") as gen:
            generate_face_embeddings(me, uuid.uuid4())

        gen.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())


@override_config(TAGGING_MODEL="mobileclip_s2", OCR_MODEL="ppocrv6_small")
class QueuedTasksCarryPrimaryKeysTest(TestCase):
    """The queue holds photo ids, never pickled model instances."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def _queued_payload(self, dispatcher):
        with patch.object(processing_jobs, "AsyncTask") as async_task:
            dispatcher(self.user, uuid.uuid4(), True)
        self.assertEqual(async_task.call_count, 1)
        return async_task.call_args.args[1]

    def test_generate_tags_queues_the_photo_id(self):
        payload = self._queued_payload(generate_tags)
        self.assertNotIsInstance(payload, Photo)
        self.assertEqual(payload, self.photo.pk)

    def test_add_geolocation_queues_the_photo_id(self):
        payload = self._queued_payload(add_geolocation)
        self.assertNotIsInstance(payload, Photo)
        self.assertEqual(payload, self.photo.pk)

    def test_generate_ocr_queues_the_photo_id(self):
        payload = self._queued_payload(generate_ocr)
        self.assertNotIsInstance(payload, Photo)
        self.assertEqual(payload, self.photo.pk)


@override_config(TAGGING_MODEL="mobileclip_s2", OCR_MODEL="ppocrv6_small")
class CancelledJobWorkerTest(TestCase):
    """A task still in the queue when its job is cancelled does nothing."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def _cancelled_job(self, job_type):
        job = _job(self.user, job_type, target=5)
        job.cancel()
        return job

    def test_generate_tag_job_skips_work(self):
        job = self._cancelled_job(LongRunningJob.JOB_GENERATE_TAGS)
        with patch.object(PhotoCaption, "generate_tag_captions") as tag:
            generate_tag_job(self.photo.pk, job.job_id)
        tag.assert_not_called()
        self.assertFalse(PhotoCaption.objects.filter(photo=self.photo).exists())

    def test_geolocation_job_skips_work(self):
        job = self._cancelled_job(LongRunningJob.JOB_ADD_GEOLOCATION)
        with patch.object(Photo, "_geolocate") as geolocate:
            geolocation_job(self.photo.pk, job.job_id)
        geolocate.assert_not_called()

    def test_generate_ocr_job_skips_work(self):
        job = self._cancelled_job(LongRunningJob.JOB_GENERATE_OCR)
        with patch("requests.post") as post:
            generate_ocr_job(self.photo.pk, job.job_id)
        post.assert_not_called()

    def test_cancelled_worker_does_not_touch_the_progress_counter(self):
        job = self._cancelled_job(LongRunningJob.JOB_ADD_GEOLOCATION)
        with patch.object(Photo, "_geolocate"):
            geolocation_job(self.photo.pk, job.job_id)
        job.refresh_from_db()
        self.assertEqual(job.progress_current, 0)


class WorkerLoadsPhotoByIdTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_geolocation_job_works_from_the_id(self):
        job = _job(self.user, LongRunningJob.JOB_ADD_GEOLOCATION)
        with (
            patch.object(Photo, "_geolocate", autospec=True) as geolocate,
            patch.object(Photo, "_add_location_to_album_dates"),
        ):
            geolocation_job(self.photo.pk, job.job_id)
        self.assertEqual(geolocate.call_args.args[0].pk, self.photo.pk)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_photo_deleted_after_queueing_still_counts_toward_the_job(self):
        job = _job(self.user, LongRunningJob.JOB_ADD_GEOLOCATION)
        photo_id = self.photo.pk
        Photo.objects.filter(pk=photo_id).delete()

        with patch.object(Photo, "_geolocate") as geolocate:
            geolocation_job(photo_id, job.job_id)

        geolocate.assert_not_called()
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
