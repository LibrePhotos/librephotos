"""Face regions the face model finds no face in (#2888).

An imported region no detection overlaps keeps no encoding, so clustering
never files it under a stranger (#2094). Generate Face Embeddings asks the
face model for it once: when the model finds no face, the face remembers
the model in ``unmatched_by`` and the next runs skip it, until the model
changes, its box changes, or it gets an encoding another way. The run counts
it as ``unmatched``, not as a failure.
"""

import uuid
from unittest.mock import patch

import numpy as np
from constance.test import override_config
from django.test import TestCase

from api.directory_watcher.processing_jobs import (
    faces_missing_encoding,
    generate_face_embeddings,
)
from api.faces import photo_faces
from api.models import Face, LongRunningJob
from api.tests.utils import create_test_face, create_test_photo, create_test_user
from api.thumbnails.face_boxes import rescale_face_boxes

MODEL = "buffalo_sc"
NO_FACE = [None]


def _region(user, photo=None, **fields):
    """A face from an imported region: a box without an encoding."""
    face = create_test_face(photo=photo or create_test_photo(owner=user), **fields)
    Face.objects.filter(pk=face.pk).update(encoding="")
    face.refresh_from_db()
    return face


def _encoding():
    return np.random.rand(512)


@override_config(FACE_RECOGNITION_MODEL=MODEL)
class UnmatchedRegionJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _run(self, encodings=NO_FACE):
        job_id = uuid.uuid4()
        with patch.object(
            photo_faces, "get_face_encodings", return_value=encodings
        ) as service:
            generate_face_embeddings(self.user, job_id)
        return LongRunningJob.objects.filter(job_id=job_id).first(), service

    def test_regions_without_a_face_are_marked_and_the_run_succeeds(self):
        # More than the failure floor (10): each used to count as a failed item.
        faces = [_region(self.user) for _ in range(12)]

        job, service = self._run()

        self.assertEqual(service.call_count, 12)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_current, 12)
        self.assertEqual(job.result, {"unmatched": 12})
        for face in faces:
            face.refresh_from_db()
            self.assertEqual(face.unmatched_by, MODEL)
            self.assertEqual(face.encoding, "")

    def test_the_next_run_does_not_ask_again(self):
        _region(self.user)
        self._run()

        self.assertFalse(faces_missing_encoding(self.user).exists())
        job, service = self._run()

        service.assert_not_called()
        self.assertIsNone(job)

    def test_another_face_model_tries_them_again(self):
        face = _region(self.user)
        self._run()

        with override_config(FACE_RECOGNITION_MODEL="buffalo_l"):
            self.assertEqual(list(faces_missing_encoding(self.user)), [face])

    def test_a_failing_face_service_is_still_a_failed_item(self):
        face = _region(self.user)

        job, _ = self._run(encodings=[])

        self.assertEqual(job.result["error_count"], 1)
        self.assertNotIn("unmatched", job.result)
        face.refresh_from_db()
        self.assertEqual(face.unmatched_by, "")

    def test_deleted_faces_and_faces_off_the_library_are_not_selected(self):
        _region(self.user, deleted=True)
        _region(self.user, photo=create_test_photo(owner=self.user, in_trashcan=True))
        _region(self.user, photo=create_test_photo(owner=self.user, removed=True))
        kept = _region(self.user)

        self.assertEqual(list(faces_missing_encoding(self.user)), [kept])

    def test_other_users_faces_are_not_selected(self):
        _region(create_test_user())
        self.assertFalse(faces_missing_encoding(self.user).exists())


@override_config(FACE_RECOGNITION_MODEL=MODEL)
class UnmatchedMarkClearedTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.face = _region(self.user, unmatched_by=MODEL)

    def test_an_encoding_from_the_face_model_clears_it(self):
        with patch.object(
            photo_faces, "get_face_encodings", return_value=[_encoding()]
        ):
            photo_faces.generate_face_encoding(self.face)

        self.face.refresh_from_db()
        self.assertEqual(self.face.unmatched_by, "")
        self.assertNotEqual(self.face.encoding, "")

    def test_an_overlapping_detection_clears_it(self):
        face = self.face
        location = (
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
        )
        photo_faces._give_encoding_to_overlapping_face(
            face.photo, location, _encoding()
        )

        face.refresh_from_db()
        self.assertEqual(face.unmatched_by, "")
        self.assertNotEqual(face.encoding, "")

    def test_a_rescaled_box_clears_it(self):
        changed = rescale_face_boxes(self.face.photo, (200, 100), (400, 200))

        self.assertEqual(changed, 1)
        self.face.refresh_from_db()
        self.assertEqual(self.face.unmatched_by, "")
        self.assertEqual(list(faces_missing_encoding(self.user)), [self.face])
