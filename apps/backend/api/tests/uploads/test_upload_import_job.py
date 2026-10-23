"""``/api/upload/complete/`` counts each import on the user's import job (#2737).

The answer names the job and the photo, so a client can follow the
processing; duplicates, refused files and files that make no photo are not
counted. ``POST /api/upload/seal/`` ends the client's upload run.
"""

import hashlib
import json
from unittest import mock

from rest_framework.test import APIClient

from api.models import LongRunningJob, Photo
from api.tests.uploads.test_upload_into_album import UploadIntoAlbumTestBase
from api.tests.utils import create_test_job, create_test_user

J = LongRunningJob
SEAL_URL = "/api/upload/seal/"


def _import_jobs(user):
    return J.objects.owned_by(user).filter(job_type=J.JOB_IMPORT_UPLOADS)


class CompletionCountsTheImportTest(UploadIntoAlbumTestBase):
    def another_file(self):
        """Upload other bytes next, so the next upload is not a duplicate."""
        self.payload += b"more"
        self.md5 = hashlib.md5(self.payload).hexdigest()

    def test_the_answer_names_the_job_and_the_photo(self):
        response = self.complete(self.stage())

        self.assertEqual(response.status_code, 200, response.content)
        job = _import_jobs(self.user).get()
        self.assertEqual(
            {"job_id": job.job_id, "photo_id": str(self.imported.pk)},
            json.loads(response.content),
        )
        self.assertEqual(1, job.progress_target)
        self.assertEqual(
            (str(self.imported.pk), job.job_id), self.queued_import().args[1:4:2]
        )

    def test_uploads_in_a_row_share_the_job(self):
        self.complete(self.stage())
        self.another_file()
        self.complete(self.stage())

        self.assertEqual(2, _import_jobs(self.user).get().progress_target)

    def test_a_duplicate_answers_so_and_is_not_counted(self):
        Photo.objects.filter(pk=self.imported.pk).update(image_hash=self.image_hash)

        response = self.complete(self.stage())

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            {
                "detail": "Photo duplicated. No new import performed.",
                "photo_id": str(self.imported.pk),
            },
            json.loads(response.content),
        )
        self.assertFalse(_import_jobs(self.user).exists())
        self.enqueue.assert_not_called()

    def test_a_refused_file_type_is_not_counted(self):
        with mock.patch("api.views.upload.is_valid_media", return_value=False):
            response = self.complete(self.stage())

        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(_import_jobs(self.user).exists())

    def test_a_file_that_makes_no_photo_is_not_counted(self):
        # A sidecar or embedded media: create_new_image files it and stops.
        self.create_new_image.return_value = None

        response = self.complete(self.stage())

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            {"job_id": None, "photo_id": None}, json.loads(response.content)
        )
        self.assertFalse(_import_jobs(self.user).exists())
        self.enqueue.assert_not_called()

    def test_an_upload_whose_task_was_not_queued_is_taken_back(self):
        self.complete(self.stage())
        self.another_file()
        self.enqueue.side_effect = RuntimeError("broker down")

        with self.assertRaises(RuntimeError):
            self.complete(self.stage())

        self.assertEqual(1, _import_jobs(self.user).get().progress_target)


class SealUploadImportsTest(UploadIntoAlbumTestBase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        followups = mock.patch("api.jobs.upload_import.request_upload_followups")
        self.followups = followups.start()
        self.addCleanup(followups.stop)

    def seal(self, job_ids, client=None):
        return (client or self.api).post(SEAL_URL, {"job_ids": job_ids}, format="json")

    def test_seals_the_callers_job(self):
        self.complete(self.stage())
        job = _import_jobs(self.user).get()

        response = self.seal([job.job_id])

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual({"sealed_job_ids": [job.job_id]}, response.data)
        job.refresh_from_db()
        self.assertTrue(job.sealed)
        # Its file is still being processed.
        self.assertFalse(job.finished)

    def test_a_job_whose_files_are_done_finishes(self):
        job = create_test_job(
            started_by=self.user,
            job_type=J.JOB_IMPORT_UPLOADS,
            sealed=False,
            progress_target=2,
            progress_current=2,
        )

        self.seal([job.job_id])

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.followups.assert_called_once_with(self.user)

    def test_another_users_job_is_left_alone(self):
        other = create_test_user()
        theirs = create_test_job(
            started_by=other, job_type=J.JOB_IMPORT_UPLOADS, sealed=False
        )

        response = self.seal([theirs.job_id])

        self.assertEqual({"sealed_job_ids": []}, response.data)
        theirs.refresh_from_db()
        self.assertFalse(theirs.sealed)

    def test_job_ids_are_required(self):
        response = self.api.post(SEAL_URL, {}, format="json")

        self.assertEqual(400, response.status_code)
        self.assertEqual("job_ids", response.data["errors"][0]["field"])

    def test_needs_a_login(self):
        response = self.seal(["x"], client=APIClient())

        self.assertEqual(401, response.status_code)
