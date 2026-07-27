"""Auth + retry-safety of the chunked-upload endpoints.

`UploadPhotosChunked` and `UploadPhotosChunkedComplete` used to read the JWT
from a ``jwt`` cookie only. Native clients cannot set a ``Cookie`` header
reliably (on iOS ``NSURLSession`` owns the cookie store), so mobile-v2's
completion call arrived unauthenticated and every ``/api/upload/complete/``
answered 403 while the chunk POST — sent by a native uploader whose headers do
survive — answered 200. Both views now accept ``Authorization: Bearer`` and keep
the cookie path for the web frontend.

The second regression covered here is retry safety: a completion that fails
inside ``on_completion`` must not leave the upload marked COMPLETE, or every
retry of that ``upload_id`` answers a permanent 400 ("Upload has already been
marked as complete") and the staged bytes are orphaned.
"""

import hashlib
import io
import json
import tempfile

from django.test import TestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.tests.utils import ONE_PIXEL_PNG, create_test_user
from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.models import ChunkedUpload

UPLOAD_URL = "/api/upload/"
COMPLETE_URL = "/api/upload/complete/"


class UploadAuthTestBase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.token = str(AccessToken.for_user(self.user))
        self.payload = ONE_PIXEL_PNG
        self.md5 = hashlib.md5(self.payload).hexdigest()

    def bearer(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def post_chunk(self, **extra):
        return self.client.post(
            UPLOAD_URL,
            {
                "offset": "0",
                "user": str(self.user.id),
                "file": io.BytesIO(self.payload),
            },
            HTTP_CONTENT_RANGE=f"bytes 0-{len(self.payload) - 1}/{len(self.payload)}",
            **extra,
        )

    def post_complete(self, upload_id, **extra):
        return self.client.post(
            COMPLETE_URL,
            {
                "upload_id": upload_id,
                "md5": self.md5,
                "user": str(self.user.id),
                "filename": "one.png",
            },
            **extra,
        )


class ChunkedUploadHeaderAuthTest(UploadAuthTestBase):
    """POST /api/upload/ — the bytes half."""

    def test_bearer_header_is_accepted(self):
        response = self.post_chunk(**self.bearer())
        self.assertEqual(response.status_code, 200)
        self.assertIn("upload_id", json.loads(response.content))

    def test_cookie_still_works(self):
        self.client.cookies["jwt"] = self.token
        response = self.post_chunk()
        self.assertEqual(response.status_code, 200)

    def test_no_credentials_is_403(self):
        response = self.post_chunk()
        self.assertEqual(response.status_code, 403)

    def test_garbage_bearer_token_is_403(self):
        response = self.post_chunk(HTTP_AUTHORIZATION="Bearer not-a-jwt")
        self.assertEqual(response.status_code, 403)

    def test_bearer_prefix_is_case_insensitive(self):
        response = self.post_chunk(HTTP_AUTHORIZATION=f"bearer {self.token}")
        self.assertEqual(response.status_code, 200)


class ChunkedUploadCompleteHeaderAuthTest(UploadAuthTestBase):
    """POST /api/upload/complete/ — the half that used to 403 for mobile.

    The user deliberately has no scan directory, so ``on_completion`` stops at
    its own 400 validation. That is exactly what makes these assertions sharp:
    a 400 proves the request got *past* authentication, which is the thing under
    test, without depending on image processing or a task broker.
    """

    def _staged_upload_id(self):
        response = self.post_chunk(**self.bearer())
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)["upload_id"]

    def test_bearer_header_without_any_cookie_passes_authentication(self):
        upload_id = self._staged_upload_id()
        response = self.post_complete(upload_id, **self.bearer())
        self.assertNotEqual(response.status_code, 403)
        self.assertEqual(response.status_code, 400)
        self.assertIn("scan directory", json.loads(response.content)["detail"].lower())

    def test_cookie_still_works(self):
        upload_id = self._staged_upload_id()
        self.client.cookies["jwt"] = self.token
        response = self.post_complete(upload_id)
        self.assertNotEqual(response.status_code, 403)

    def test_no_credentials_is_403(self):
        upload_id = self._staged_upload_id()
        response = self.post_complete(upload_id)
        self.assertEqual(response.status_code, 403)

    def test_garbage_bearer_token_is_403(self):
        upload_id = self._staged_upload_id()
        response = self.post_complete(upload_id, HTTP_AUTHORIZATION="Bearer not-a-jwt")
        self.assertEqual(response.status_code, 403)

    def test_deleted_user_is_403(self):
        upload_id = self._staged_upload_id()
        headers = self.bearer()
        self.user.delete()
        response = self.post_complete(upload_id, **headers)
        self.assertEqual(response.status_code, 403)


class CompleteRetrySafetyTest(UploadAuthTestBase):
    """A failed completion must leave the upload_id re-completable."""

    def test_failed_completion_does_not_mark_upload_complete(self):
        upload_id = self._stage()
        first = self.post_complete(upload_id, **self.bearer())
        self.assertEqual(first.status_code, 400)

        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(upload.status, UPLOADING)
        self.assertIsNone(upload.completed_on)

    def test_retry_after_a_failed_completion_is_not_permanently_400(self):
        upload_id = self._stage()
        self.post_complete(upload_id, **self.bearer())

        # Same failure again — not "Upload has already been marked as complete",
        # which is what a poisoned upload_id would answer forever.
        retry = self.post_complete(upload_id, **self.bearer())
        self.assertEqual(retry.status_code, 400)
        detail = json.loads(retry.content)["detail"]
        self.assertNotIn("already been marked", detail)

    def test_successful_completion_still_marks_complete(self):
        """The rollback is scoped to failures; a clean run behaves as before."""
        with tempfile.TemporaryDirectory() as scan_dir:
            self.user.scan_directory = scan_dir
            self.user.save()
            upload_id = self._stage()
            seen = {}

            from api.views import upload as upload_views

            original = upload_views.UploadPhotosChunkedComplete.on_completion

            def spy(view_self, uploaded_file, request):
                # Record what the view saw at the moment completion ran, then
                # stop short of image processing / the task chain.
                seen["status"] = ChunkedUpload.objects.get(upload_id=upload_id).status
                uploaded_file.close()

            upload_views.UploadPhotosChunkedComplete.on_completion = spy
            try:
                response = self.post_complete(upload_id, **self.bearer())
            finally:
                upload_views.UploadPhotosChunkedComplete.on_completion = original

            self.assertEqual(response.status_code, 200)
            self.assertEqual(seen["status"], COMPLETE)
            self.assertEqual(
                ChunkedUpload.objects.get(upload_id=upload_id).status, COMPLETE
            )

    def test_md5_mismatch_is_400_and_leaves_the_upload_resumable(self):
        """The 400 the mobile client hit when it sent a stale hash.

        It must not consume the upload either: the client should be able to
        re-complete with the checksum of the bytes it actually sent.
        """
        upload_id = self._stage()
        response = self.client.post(
            COMPLETE_URL,
            {
                "upload_id": upload_id,
                "md5": "f" * 32,
                "user": str(self.user.id),
                "filename": "one.png",
            },
            **self.bearer(),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("md5", json.loads(response.content)["detail"])
        self.assertEqual(
            ChunkedUpload.objects.get(upload_id=upload_id).status, UPLOADING
        )

    def _stage(self):
        response = self.post_chunk(**self.bearer())
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)["upload_id"]
