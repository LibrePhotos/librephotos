"""Detect faces again in one folder or in some photos (#524).

``POST /api/scanfaces`` with ``path`` or ``photo_ids`` narrows the run.
Which photos have been looked at is kept per photo
(``Photo.faces_scanned_at``), so a narrowed run leaves every other photo to
the next incremental run.
"""

import os
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import _faces_to_scan, scan_faces
from api.models import LongRunningJob, Photo
from api.tests.scanning.test_rescan_selected_photos import recorded_tasks
from api.tests.utils import (
    api_error,
    create_test_file,
    create_test_photo,
    create_test_user,
)


class FaceScanScopeTestBase(TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.scan_dir = os.path.join(self.root, "alice")
        self.user = create_test_user(scan_directory=self.scan_dir)

    def photo(self, *folders, user=None, **fields):
        owner = user or self.user
        base = owner.scan_directory
        path = os.path.join(base, *folders, f"{uuid.uuid4().hex}.jpg")
        file = create_test_file(path, owner)
        photo = create_test_photo(owner=owner, main_file=file, **fields)
        photo.files.add(file)
        return photo


class FacesToScanTest(FaceScanScopeTestBase):
    def test_a_folder_takes_its_photos_and_those_below_it(self):
        top = self.photo("trip")
        below = self.photo("trip", "day1")
        self.photo("trip2")
        self.photo()

        photos = _faces_to_scan(
            self.user, True, path=os.path.join(self.scan_dir, "trip")
        )

        self.assertCountEqual(photos, [top, below])

    def test_photo_ids_take_those_photos_of_the_users(self):
        mine = self.photo()
        self.photo()
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(user=bob)

        photos = _faces_to_scan(
            self.user, True, photo_ids=[str(mine.pk), str(theirs.pk)]
        )

        self.assertEqual(list(photos), [mine])

    def test_an_incremental_narrowed_run_skips_photos_already_scanned(self):
        done = self.photo("trip", faces_scanned_at=timezone.now())
        new = self.photo("trip")

        photos = _faces_to_scan(
            self.user, False, path=os.path.join(self.scan_dir, "trip")
        )

        self.assertEqual(list(photos), [new])
        self.assertNotIn(done, photos)


@override_settings(FEATURE_FACE_DETECTION=True)
class NarrowedRunLeavesTheRestTest(FaceScanScopeTestBase):
    """A partial run moves nothing that the next incremental run depends on."""

    def setUp(self):
        super().setUp()
        for name in ("generate_face_embeddings", "cluster_all_faces"):
            tail = patch.object(processing_jobs, name)
            tail.start()
            self.addCleanup(tail.stop)
        restore = patch.object(processing_jobs.photo_faces, "restore_missing_crops")
        restore.start()
        self.addCleanup(restore.stop)

    def run_scan(self, **scope):
        scanned = []

        def extract(photo, job_id):
            scanned.append(photo)
            Photo.objects.filter(pk=photo.pk).update(faces_scanned_at=timezone.now())

        job_id = uuid.uuid4()
        with patch.object(
            processing_jobs, "_extract_faces_for_photo", side_effect=extract
        ):
            scan_faces(self.user, job_id, **scope)
        return scanned

    def test_the_next_incremental_run_still_covers_the_other_photos(self):
        chosen = self.photo(faces_scanned_at=timezone.now())
        waiting = self.photo()

        self.assertEqual(
            self.run_scan(full_scan=True, photo_ids=[str(chosen.pk)]), [chosen]
        )
        self.assertEqual(self.run_scan(), [waiting])


@override_settings(FEATURE_FACE_DETECTION=True)
class ScanFacesViewScopeTest(FaceScanScopeTestBase):
    url = "/api/scanfaces/"

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def post(self, body=None):
        with recorded_tasks() as recorder, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, body, format="json")
        self.recorder = recorder
        return response

    def queued(self):
        [(func, args, kwargs)] = self.recorder.calls
        self.assertIs(func, scan_faces)
        self.assertEqual(args, (self.user,))
        self.assertIs(kwargs["full_scan"], True)
        return kwargs

    def test_no_body_is_the_whole_library(self):
        response = self.post()

        self.assertEqual(response.status_code, 200, response.content)
        kwargs = self.queued()
        self.assertNotIn("path", kwargs)
        self.assertNotIn("photo_ids", kwargs)

    def test_a_folder_in_the_library(self):
        folder = os.path.join(self.scan_dir, "trip")

        response = self.post({"path": folder})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.queued()["path"], folder)

    def test_a_folder_outside_the_library_is_a_400(self):
        for folder in (
            os.path.join(self.root, "bob"),
            os.path.join(self.scan_dir, ".."),
        ):
            with self.subTest(folder=folder):
                response = self.post({"path": folder})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(api_error(response)["code"], "path_outside_library")
                self.assertEqual(self.recorder.calls, [])

    def test_photo_ids_keep_only_the_users_own(self):
        mine = self.photo()
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(user=bob)

        response = self.post({"photo_ids": [str(mine.pk), str(theirs.pk)]})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.queued()["photo_ids"], [str(mine.pk)])

    def test_only_someone_elses_photos_is_a_404(self):
        bob = create_test_user(scan_directory=os.path.join(self.root, "bob"))
        theirs = self.photo(user=bob)

        response = self.post({"photo_ids": [str(theirs.pk)]})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.recorder.calls, [])
        self.assertFalse(LongRunningJob.objects.exists())

    def test_both_at_once_is_a_400(self):
        response = self.post({"photo_ids": [str(uuid.uuid4())], "path": self.scan_dir})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "photo_ids_or_path")

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_refused_while_face_detection_is_off(self):
        response = self.post({"path": self.scan_dir})

        self.assertEqual(response.status_code, 403)
