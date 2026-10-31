"""Faces imported a quarter turn off the face before #2899, repaired once (#2887).

Up to 1.5.0 a face region whose picture was turned after it was written was
saved 90 degrees away from the face, with no encoding, and the face service's
detection of the face was saved next to it as an unnamed face. Scan Faces does
not repair that: it gives the region's name to the detected face and keeps the
face a quarter turn off. ``api.faces.turned_faces`` moves the face onto the
face found there, with the scan's own rule and the faces' stored encodings.
"""

import importlib
import os
from io import StringIO
from unittest import mock

import numpy as np
from django.apps import apps as global_apps
from django.core.management import call_command
from django.test import TestCase

from api.faces import extractor, photo_faces, turned_faces
from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
from api.models import Face, LongRunningJob, UpgradeTaskState
from api.models.long_running_job import JobCancelledError
from api.tests.faces.test_stale_quarter_turn_regions import (
    ENCODING,
    TurnedJpegTestCase,
)
from api.tests.utils import (
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_user,
)

migration_0219 = importlib.import_module(
    "api.migrations.0219_repair_turned_faces_job_type"
)


def _regions_before_2899(photo, thumbnail_path, detected):
    """How the scan read the regions up to 1.5.0: without the detections."""
    return extractor.extract_from_exif(
        photo.main_file.path,
        thumbnail_path,
        photo_faces.sidecar_files_for_photo(photo),
        local_orientation=photo.local_orientation,
    )


class TurnedFaceRepairTest(TurnedJpegTestCase):
    def setUp(self):
        super().setUp()
        # The photo as 1.5.0 imported it: Alice a quarter turn off the face,
        # and the face as an unnamed detection.
        with mock.patch.object(photo_faces, "_face_regions", _regions_before_2899):
            self._extract([self.face])
        self.alice = Face.objects.get(photo=self.photo, person__name="Alice")
        self.detection = Face.objects.get(photo=self.photo, person=None)
        self.assertEqual(self._box(self.alice), self.written)
        self.assertEqual(self.alice.encoding, "")

    def faces(self):
        return list(
            Face.objects.filter(photo=self.photo)
            .select_related("person")
            .order_by("id")
        )

    def repair(self, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            return turned_faces.repair_turned_faces([self.photo.owner], **kwargs)

    def test_the_face_is_moved_onto_the_detected_face(self):
        old_crop = self.alice.image.path

        result = self.repair()

        (alice,) = self.faces()
        self.assertEqual(alice.pk, self.alice.pk)
        self.assertEqual(alice.person.name, "Alice")
        self.assertEqual(alice.encoding, np.array(ENCODING).tobytes().hex())
        self.assertGreaterEqual(
            calculate_iou(self._box(alice), self.face), FACE_OVERLAP_IOU_THRESHOLD
        )
        self.assertTrue(os.path.isfile(alice.image.path))
        self.assertNotEqual(alice.image.path, old_crop)
        self.assertFalse(os.path.exists(old_crop))
        self.assertEqual((result.photos, result.repaired, result.skipped), (1, 1, 0))

    def test_the_moved_face_is_no_longer_marked_unmatched(self):
        """#2888: the face model found no face in the box a quarter turn off."""
        Face.objects.filter(pk=self.alice.pk).update(unmatched_by="buffalo_sc")

        self.repair()

        self.alice.refresh_from_db()
        self.assertEqual(self.alice.unmatched_by, "")
        self.assertNotEqual(self.alice.encoding, "")

    def test_a_second_run_changes_nothing(self):
        self.repair()
        (before,) = self.faces()

        result = self.repair()

        (after,) = self.faces()
        self.assertEqual(self._box(after), self._box(before))
        self.assertEqual((result.repaired, result.skipped), (0, 0))

    def test_after_scan_faces_named_the_detection_the_duplicate_is_deleted(self):
        # Scan Faces since #2899 names the detection and keeps Alice where she was.
        self._extract([self.face])
        self.detection.refresh_from_db()
        self.assertEqual(self.detection.person.name, "Alice")
        self.assertEqual(len(self.faces()), 2)

        result = self.repair()

        (alice,) = self.faces()
        self.assertEqual(alice.pk, self.detection.pk)
        self.assertEqual(result.repaired, 1)
        alice.person.refresh_from_db()
        self.assertEqual(alice.person.face_count, 1)
        self.assertEqual(alice.person.cover_face, alice)

    def test_a_dry_run_changes_nothing(self):
        result = self.repair(apply=False)

        self.assertEqual(result.repaired, 1)
        self.assertEqual(len(self.faces()), 2)
        self.alice.refresh_from_db()
        self.assertEqual(self._box(self.alice), self.written)

    def test_a_detection_labelled_as_someone_else_is_left_alone(self):
        self.detection.person = create_test_person(
            name="Bob", cluster_owner=self.photo.owner
        )
        self.detection.save(update_fields=["person"])

        result = self.repair()

        self.assertEqual(len(self.faces()), 2)
        self.alice.refresh_from_db()
        self.assertEqual(self._box(self.alice), self.written)
        self.assertEqual((result.repaired, result.skipped), (0, 1))

    def test_a_detection_marked_as_not_that_person_is_left_alone(self):
        self.detection.rejected_persons.add(self.alice.person)

        result = self.repair()

        self.assertEqual(len(self.faces()), 2)
        self.assertEqual((result.repaired, result.skipped), (0, 1))

    def test_a_second_face_on_the_turn_is_no_single_answer(self):
        # A face drawn by hand over the detection, not encoded yet.
        top, right, bottom, left = self.face
        create_test_face(
            photo=self.photo,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
        )
        Face.objects.filter(photo=self.photo).exclude(
            pk__in=(self.alice.pk, self.detection.pk)
        ).update(encoding="")

        result = self.repair()

        self.assertEqual(len(self.faces()), 3)
        self.assertEqual((result.repaired, result.skipped), (0, 1))

    def test_a_deleted_detection_is_no_evidence(self):
        self.detection.deleted = True
        self.detection.save(update_fields=["deleted"])

        result = self.repair()

        self.alice.refresh_from_db()
        self.assertEqual(self._box(self.alice), self.written)
        self.assertEqual((result.photos, result.repaired), (0, 0))

    def test_a_face_moved_since_it_was_imported_is_left_alone(self):
        Face.objects.filter(pk=self.alice.pk).update(location_top=0)

        result = self.repair()

        self.assertEqual(len(self.faces()), 2)
        self.assertEqual((result.repaired, result.skipped), (0, 0))

    def test_only_the_given_users_photos_are_read(self):
        result = turned_faces.repair_turned_faces([create_test_user()])

        self.assertEqual(result.photos, 0)
        self.assertEqual(len(self.faces()), 2)

    def test_an_unreadable_photo_is_counted(self):
        with mock.patch.object(
            turned_faces, "turned_regions", side_effect=OSError("gone")
        ):
            result = self.repair()

        self.assertEqual((result.photos, result.unreadable), (1, 1))
        self.assertEqual(len(self.faces()), 2)

    def test_the_command(self):
        dry_run = StringIO()
        call_command("repair_turned_faces", "--dry-run", stdout=dry_run)
        self.assertIn("Would repair 1 face(s) on 1 photo(s)", dry_run.getvalue())
        self.assertEqual(len(self.faces()), 2)

        out = StringIO()
        with self.captureOnCommitCallbacks(execute=True):
            call_command("repair_turned_faces", stdout=out)
        self.assertIn("Repaired 1 face(s)", out.getvalue())
        self.assertEqual(len(self.faces()), 1)

    def test_the_job_records_its_counts(self):
        admin = create_test_user(is_admin=True)
        job = create_test_job(admin, LongRunningJob.JOB_REPAIR_TURNED_FACES)

        with self.captureOnCommitCallbacks(execute=True):
            turned_faces.repair_turned_faces_job(admin, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["repaired"], 1)
        self.assertEqual(job.result["photos"], 1)
        self.assertEqual((job.progress_current, job.progress_target), (1, 1))
        self.assertEqual(len(self.faces()), 1)


class TurnedFaceRepairJobTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.job = create_test_job(self.admin, LongRunningJob.JOB_REPAIR_TURNED_FACES)

    def test_a_cancelled_job_stops(self):
        with mock.patch.object(
            LongRunningJob, "stop_if_cancelled", side_effect=JobCancelledError("job")
        ):
            turned_faces.repair_turned_faces_job(self.admin, self.job.job_id)

        self.job.refresh_from_db()
        self.assertFalse(self.job.failed)
        self.assertIsNone(self.job.result)

    def test_an_unexpected_error_fails_the_job(self):
        with mock.patch.object(
            turned_faces, "repair_turned_faces", side_effect=RuntimeError("db gone")
        ):
            turned_faces.repair_turned_faces_job(self.admin, self.job.job_id)

        self.job.refresh_from_db()
        self.assertTrue(self.job.failed)


class SeedingTest(TestCase):
    """Migration 0219: the task only where a face can be a quarter turn off."""

    def seed(self):
        migration_0219.seed_upgrade_task(global_apps, None)
        return set(UpgradeTaskState.objects.values_list("key", flat=True))

    def test_photos_whose_faces_all_have_an_encoding_seed_nothing(self):
        photo = create_test_photo(owner=create_test_user())
        create_test_face(photo=photo)
        self.assertEqual(self.seed(), set())

    def test_a_face_without_an_encoding_alone_seeds_nothing(self):
        photo = create_test_photo(owner=create_test_user())
        Face.objects.filter(pk=create_test_face(photo=photo).pk).update(encoding="")
        self.assertEqual(self.seed(), set())

    def test_a_face_without_an_encoding_beside_one_with_seeds_the_task(self):
        photo = create_test_photo(owner=create_test_user())
        create_test_face(photo=photo)
        Face.objects.filter(pk=create_test_face(photo=photo).pk).update(encoding="")
        self.assertEqual(self.seed(), {"repair_turned_faces"})
        self.assertEqual(UpgradeTaskState.objects.count(), 1)
