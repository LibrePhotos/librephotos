"""Uploading straight into one of your albums (#612).

``POST /api/upload/complete/`` takes an optional ``album_id``. The album is
resolved through the owner scope before anything is written: an album that is
not the uploader's, or a locked one, is a 400 with a ``code`` and leaves the
staged upload in place, so the client can complete it again without the album.
An accepted album is filed into right after the import (a task in the import
chain), and a file the library already holds is added to it directly.
"""

import hashlib
import io
import json
import os
import tempfile
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.albums.user_albums import add_photo_to_user_album
from api.directory_watcher import handle_new_image
from api.models import Photo
from api.tests.utils import (
    ONE_PIXEL_PNG,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)
from chunked_upload.constants import UPLOADING
from chunked_upload.models import ChunkedUpload

UPLOAD_URL = "/api/upload/"
COMPLETE_URL = "/api/upload/complete/"


def bearer(user):
    return {"HTTP_AUTHORIZATION": f"Bearer {AccessToken.for_user(user)}"}


class UploadIntoAlbumTestBase(TestCase):
    def setUp(self):
        self.scan_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.scan_dir.cleanup)
        self.user = create_test_user(scan_directory=self.scan_dir.name)
        self.album = create_test_album_user(owner=self.user, title="Porto 2025")
        self.payload = ONE_PIXEL_PNG
        self.md5 = hashlib.md5(self.payload).hexdigest()
        self.image_hash = self.md5 + str(self.user.id)

        patch("api.views.upload.is_valid_media", return_value=True).start()
        self.imported = create_test_photo(owner=self.user)
        self.create_new_image = patch(
            "api.views.upload.create_new_image", return_value=self.imported
        ).start()
        self.chain = patch("api.views.upload.enqueue_task_chain").start()
        self.addCleanup(patch.stopall)

    def stage(self, user=None):
        user = user or self.user
        end = len(self.payload) - 1
        response = self.client.post(
            UPLOAD_URL,
            {"file": io.BytesIO(self.payload)},
            HTTP_CONTENT_RANGE=f"bytes 0-{end}/{len(self.payload)}",
            **bearer(user),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)["upload_id"]

    def complete(self, upload_id, user=None, **extra):
        form = {"upload_id": upload_id, "md5": self.md5, "filename": "one.png"}
        return self.client.post(
            COMPLETE_URL, {**form, **extra}, **bearer(user or self.user)
        )

    def copied(self):
        return os.path.exists(
            os.path.join(self.scan_dir.name, "uploads", "web", "one.png")
        )

    def queued_tasks(self):
        self.chain.assert_called_once()
        return [(task.func, task.args) for task in self.chain.call_args[0][0]]

    def assert_refused(self, response, code, upload_id):
        self.assertEqual(response.status_code, 400, response.content)
        error = json.loads(response.content)["errors"][0]
        self.assertEqual(error["field"], "album_id")
        self.assertEqual(error["code"], code)
        self.assertFalse(self.copied())
        self.chain.assert_not_called()
        # The staged upload is kept for a completion without the album.
        upload = ChunkedUpload.objects.get(upload_id=upload_id)
        self.assertEqual(upload.status, UPLOADING)


class UploadIntoAlbumTest(UploadIntoAlbumTestBase):
    def test_the_album_is_filed_right_after_the_import(self):
        response = self.complete(self.stage(), album_id=str(self.album.id))

        self.assertEqual(response.status_code, 200, response.content)
        tasks = self.queued_tasks()
        self.assertIs(tasks[0][0], handle_new_image)
        self.assertEqual(
            tasks[1], (add_photo_to_user_album, (self.imported, self.album.id))
        )

    def test_without_an_album_nothing_is_filed(self):
        response = self.complete(self.stage())

        self.assertEqual(response.status_code, 200, response.content)
        funcs = [func for func, _args in self.queued_tasks()]
        self.assertNotIn(add_photo_to_user_album, funcs)

    def test_a_blank_album_id_is_no_album(self):
        response = self.complete(self.stage(), album_id="")

        self.assertEqual(response.status_code, 200, response.content)
        funcs = [func for func, _args in self.queued_tasks()]
        self.assertNotIn(add_photo_to_user_album, funcs)

    def test_a_locked_album_is_refused(self):
        self.album.locked = True
        self.album.save()
        upload_id = self.stage()

        self.assert_refused(
            self.complete(upload_id, album_id=str(self.album.id)),
            "album_locked",
            upload_id,
        )

    def test_a_missing_album_is_refused(self):
        upload_id = self.stage()

        self.assert_refused(
            self.complete(upload_id, album_id="999999"), "album_not_found", upload_id
        )

    def test_a_malformed_album_id_is_refused(self):
        upload_id = self.stage()

        self.assert_refused(
            self.complete(upload_id, album_id="porto"), "invalid", upload_id
        )

    def test_a_refused_upload_completes_into_the_library_without_the_album(self):
        self.album.locked = True
        self.album.save()
        upload_id = self.stage()
        self.complete(upload_id, album_id=str(self.album.id))

        response = self.complete(upload_id)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.copied())
        self.create_new_image.assert_called_once()

    def test_a_file_already_in_the_library_is_added_to_the_album(self):
        existing = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=existing.pk).update(image_hash=self.image_hash)

        response = self.complete(self.stage(), album_id=str(self.album.id))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(list(self.album.photos.all()), [existing])
        self.chain.assert_not_called()


class ExistsAnswersThePhotoIdTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_a_known_file_answers_its_photo(self):
        photo = create_test_photo(owner=self.user)

        response = self.client.get(f"/api/exists/{photo.image_hash}/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"exists": True, "photo_id": str(photo.pk)})

    def test_an_unknown_file_answers_no_photo(self):
        response = self.client.get("/api/exists/0123456789abcdef/")

        self.assertEqual(response.json(), {"exists": False, "photo_id": None})

    def test_another_users_file_is_unknown(self):
        other = create_test_photo(owner=create_test_user())

        response = self.client.get(f"/api/exists/{other.image_hash}/")

        self.assertEqual(response.json(), {"exists": False, "photo_id": None})


class AddPhotoToUserAlbumTest(TestCase):
    """The chain task resolves the album again when it runs."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.album = create_test_album_user(owner=self.user)

    def test_adds_the_photo(self):
        self.assertTrue(add_photo_to_user_album(self.photo, self.album.id))
        self.assertEqual(list(self.album.photos.all()), [self.photo])

    def test_an_album_locked_since_is_left_alone(self):
        self.album.locked = True
        self.album.save()

        self.assertFalse(add_photo_to_user_album(self.photo, self.album.id))
        self.assertEqual(self.album.photos.count(), 0)

    def test_an_album_deleted_since_is_skipped(self):
        album_id = self.album.id
        self.album.delete()

        self.assertFalse(add_photo_to_user_album(self.photo, album_id))

    def test_another_owners_album_is_never_filled(self):
        other_album = create_test_album_user(owner=create_test_user())

        self.assertFalse(add_photo_to_user_album(self.photo, other_album.id))
        self.assertEqual(other_album.photos.count(), 0)

    def test_a_photo_deleted_since_is_skipped(self):
        Photo.objects.filter(pk=self.photo.pk).delete()

        self.assertFalse(add_photo_to_user_album(self.photo, self.album.id))
        self.assertEqual(self.album.photos.count(), 0)
