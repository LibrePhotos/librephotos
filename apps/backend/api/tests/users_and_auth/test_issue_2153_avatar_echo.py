"""Issue #2153: saving a display preference failed for users with an avatar.

The photo grid saves "Photo Size", "Text Alignment" and "Header Size" with
PATCH /api/user/<id>/, sending the whole profile it got from GET back with the
changed value. For a user with an avatar that profile carries ``avatar`` as
the avatar's URL string, and the avatar ``ImageField`` rejected it with 400
"The submitted data was not a file", so the preference was never stored.

A string in ``avatar`` is the echoed URL, never an upload, so it is ignored;
a real file upload still replaces the avatar.
"""

import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_test_user


def _png_upload(name="avatar.png"):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


class AvatarEchoTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media_root)
        override.enable()
        self.addCleanup(override.disable)

        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _upload_avatar(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"avatar": _png_upload()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar.name.startswith("avatars/"))
        return self.user.avatar.name

    def test_echoed_profile_with_avatar_url_saves_preferences(self):
        avatar_name = self._upload_avatar()
        profile = self.client.get(f"/api/user/{self.user.id}/").json()
        self.assertIsInstance(profile["avatar"], str)

        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {**profile, "image_scale": 2.5, "text_alignment": "left"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(id=self.user.id)
        self.assertEqual(user.image_scale, 2.5)
        self.assertEqual(user.text_alignment, "left")
        self.assertEqual(user.avatar.name, avatar_name)

    def test_string_avatar_never_replaces_the_stored_one(self):
        avatar_name = self._upload_avatar()

        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"avatar": "avatars/someone_else.png"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(User.objects.get(id=self.user.id).avatar.name, avatar_name)

    def test_uploaded_file_still_replaces_the_avatar(self):
        first = self._upload_avatar()

        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"avatar": _png_upload("second.png")},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertNotEqual(self.user.avatar.name, first)
        self.assertIn("second", self.user.avatar.name)

    def test_non_image_upload_is_still_rejected(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {
                "avatar": SimpleUploadedFile(
                    "a.png", b"not an image", content_type="image/png"
                )
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
