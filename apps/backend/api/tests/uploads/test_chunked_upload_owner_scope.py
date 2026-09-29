"""A staged chunked upload belongs to the user who started it.

The vendored chunked-upload views scope ``upload_id`` lookups to
``request.user`` and record ``request.user`` on a new upload, but only when
``request.user`` is authenticated. The LibrePhotos upload views are plain
Django views that authenticate the JWT themselves
(``authenticate_upload_request``) and never set ``request.user``, so every
upload was stored without a user and every ``upload_id`` lookup ran across all
users' uploads.

Any authenticated user holding another user's ``upload_id`` could therefore
append chunks to that user's in-progress upload, or complete it: completion
runs ``on_completion`` as the *caller*, so the victim's staged bytes were
written into the caller's scan directory and imported into the caller's
library. The views now record the authenticated uploader on the upload and
only resolve ``upload_id`` among that user's own uploads.
"""

import hashlib
import io
import json
import os
import tempfile
from unittest.mock import patch

from django.test import TestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.tests.utils import ONE_PIXEL_PNG, create_test_user
from api.views.upload import UploadPhotosChunkedComplete
from chunked_upload.constants import UPLOADING
from chunked_upload.models import ChunkedUpload

UPLOAD_URL = "/api/upload/"
COMPLETE_URL = "/api/upload/complete/"


def bearer(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {AccessToken.for_user(user)}"}


class ChunkedUploadOwnerScopeTest(TestCase):
    def setUp(self):
        self.victim = create_test_user()
        self.attacker = create_test_user()
        self.payload = ONE_PIXEL_PNG
        self.md5 = hashlib.md5(self.payload).hexdigest()

    def post_chunk(self, user, data, start=0, upload_id=None):
        body = {"file": io.BytesIO(data)}
        if upload_id:
            body["upload_id"] = upload_id
        end = start + len(data) - 1
        return self.client.post(
            UPLOAD_URL,
            body,
            HTTP_CONTENT_RANGE=f"bytes {start}-{end}/{start + len(data)}",
            **bearer(user),
        )

    def stage_victim_upload(self):
        response = self.post_chunk(self.victim, self.payload)
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)["upload_id"]

    def test_new_upload_records_the_uploader(self):
        upload_id = self.stage_victim_upload()
        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(upload.user_id, self.victim.id)

    def test_other_user_cannot_append_to_the_upload(self):
        upload_id = self.stage_victim_upload()

        response = self.post_chunk(
            self.attacker, b"injected", start=len(self.payload), upload_id=upload_id
        )

        self.assertEqual(response.status_code, 404, response.content)
        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(upload.offset, len(self.payload))

    def test_owner_can_still_append(self):
        upload_id = self.stage_victim_upload()
        response = self.post_chunk(
            self.victim, b"more", start=len(self.payload), upload_id=upload_id
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_other_user_cannot_complete_the_upload(self):
        upload_id = self.stage_victim_upload()

        with tempfile.TemporaryDirectory() as scan_dir:
            self.attacker.scan_directory = scan_dir
            self.attacker.save()
            # Media sniffing and the import chain are not under test, so both
            # are stubbed; reaching the import at all is the leak.
            with (
                patch("api.views.upload.is_valid_media", return_value=True),
                patch.object(UploadPhotosChunkedComplete, "import_photo") as imp,
            ):
                response = self.client.post(
                    COMPLETE_URL,
                    {"upload_id": upload_id, "md5": self.md5, "filename": "one.png"},
                    **bearer(self.attacker),
                )
            copied = os.path.exists(os.path.join(scan_dir, "uploads", "web", "one.png"))

        self.assertEqual(response.status_code, 404, response.content)
        self.assertFalse(copied)
        imp.assert_not_called()
        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(upload.status, UPLOADING)

    def test_owner_can_still_complete(self):
        upload_id = self.stage_victim_upload()

        with tempfile.TemporaryDirectory() as scan_dir:
            self.victim.scan_directory = scan_dir
            self.victim.save()
            with (
                patch("api.views.upload.is_valid_media", return_value=True),
                patch.object(UploadPhotosChunkedComplete, "import_photo") as imp,
            ):
                response = self.client.post(
                    COMPLETE_URL,
                    {"upload_id": upload_id, "md5": self.md5, "filename": "one.png"},
                    **bearer(self.victim),
                )

        self.assertEqual(response.status_code, 200, response.content)
        imp.assert_called_once()
        self.assertFalse(ChunkedUpload.objects.filter(upload_id=upload_id).exists())
