"""A completion that fails part way leaves the upload completable again.

``/api/upload/complete/`` copies the staged file into the library, makes the
photo, counts it on the import job, queues its task and deletes the staged
upload. The staged upload goes last, and a failure before that takes back what
was done: the copy is removed and the photo, the count and the task are one
transaction. A retry then imports the file instead of answering 404 (the
staged upload was gone) or "Photo duplicated" (the copy was on disk).
"""

import json
import os
from unittest.mock import patch

from api.models import LongRunningJob, Photo
from api.tests.uploads.test_upload_into_album import UploadIntoAlbumTestBase
from api.tests.utils import create_test_photo
from chunked_upload.constants import UPLOADING
from chunked_upload.models import ChunkedUpload

J = LongRunningJob


class CompletionRecoveryTest(UploadIntoAlbumTestBase):
    def setUp(self):
        super().setUp()
        self.made = []
        self.create_new_image.side_effect = self.make_photo

    def make_photo(self, user, path):
        photo = create_test_photo(owner=user)
        Photo.objects.filter(pk=photo.pk).update(image_hash=self.image_hash)
        self.made.append(photo.pk)
        return photo

    def assert_retryable(self, upload_id):
        self.assertFalse(self.copied())
        self.assertFalse(Photo.objects.filter(pk__in=self.made).exists())
        self.assertFalse(J.objects.filter(job_type=J.JOB_IMPORT_UPLOADS).exists())
        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(UPLOADING, upload.status)
        self.assertTrue(os.path.exists(upload.file.path))

    def assert_retry_imports(self, upload_id):
        response = self.complete(upload_id)
        self.assertEqual(200, response.status_code, response.content)
        self.assertIsNotNone(json.loads(response.content)["job_id"])
        self.assertTrue(self.copied())
        self.assertFalse(ChunkedUpload.objects.filter(upload_id=upload_id).exists())

    def test_a_failed_copy_leaves_no_partial_file(self):
        upload_id = self.stage()

        def half_copy(source, target):
            with open(target, "wb") as handle:
                handle.write(b"half")
            raise OSError("No space left on device")

        with patch("api.views.upload.shutil.copyfile", side_effect=half_copy):
            with self.assertRaises(OSError):
                self.complete(upload_id)

        self.assert_retryable(upload_id)
        self.assert_retry_imports(upload_id)

    def test_a_photo_that_could_not_be_made_leaves_no_file(self):
        upload_id = self.stage()
        self.create_new_image.side_effect = RuntimeError("database is locked")

        with self.assertRaises(RuntimeError):
            self.complete(upload_id)

        self.assert_retryable(upload_id)
        self.create_new_image.side_effect = self.make_photo
        self.assert_retry_imports(upload_id)

    def test_a_task_that_could_not_be_queued_takes_the_photo_back(self):
        upload_id = self.stage()
        self.enqueue.side_effect = RuntimeError("broker down")

        with self.assertRaises(RuntimeError):
            self.complete(upload_id)

        self.assert_retryable(upload_id)
        self.enqueue.side_effect = None
        self.assert_retry_imports(upload_id)

    def test_a_staged_upload_that_could_not_be_deleted_answers_the_photo(self):
        upload_id = self.stage()

        with patch.object(ChunkedUpload, "delete", side_effect=OSError("in use")):
            with self.assertRaises(OSError):
                self.complete(upload_id)

        # The photo is made and queued; the retry finds it and finishes.
        [photo_id] = self.made
        self.assertEqual(
            UPLOADING, ChunkedUpload.objects.get(upload_id=upload_id).status
        )
        response = self.complete(upload_id)
        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(str(photo_id), json.loads(response.content)["photo_id"])
        self.assertFalse(ChunkedUpload.objects.filter(upload_id=upload_id).exists())
