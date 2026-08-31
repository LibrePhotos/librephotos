"""Characterization tests for api.views.upload.

Pins the CURRENT behavior of:
  * ``UploadPhotosChunked.check_permissions``
  * ``UploadPhotosChunkedComplete.on_completion``

These assert what the code does today, including quirks that are arguably
bugs (documented inline). Heavy dependencies (media validation, image import,
django-q Chain) are mocked -- no ML models, network or exiftool are touched.
"""

import io
import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

from chunked_upload.exceptions import ChunkedUploadError
from constance.test import override_config
from django.test import RequestFactory, TestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user
from api.views.upload import UploadPhotosChunked, UploadPhotosChunkedComplete


def make_request(jwt=None, post=None):
    request = RequestFactory().post("/api/upload/complete/")
    if jwt is not None:
        request.COOKIES["jwt"] = jwt
    request.POST = post or {}
    return request


def token_for(user):
    return str(AccessToken.for_user(user))


class FakeUploadedFile:
    """Stand-in for the django UploadedFile handed to on_completion."""

    def __init__(self, content: bytes, path: str):
        self._buf = io.BytesIO(content)
        self.file = MagicMock()
        self.file.path = path

    def read(self, *args):
        return self._buf.read(*args)

    def seek(self, *args):
        return self._buf.seek(*args)


@override_config(ALLOW_UPLOAD=True)
class UploadPhotosChunkedCheckPermissionsTest(TestCase):
    def setUp(self):
        self.view = UploadPhotosChunked()
        self.user = create_test_user()

    @override_config(ALLOW_UPLOAD=False)
    def test_upload_disabled_is_rejected_before_auth(self):
        # No jwt at all, but the ALLOW_UPLOAD check fires first.
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request())

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual("Uploading is not allowed", ctx.exception.data["detail"])

    def test_missing_jwt_cookie_is_rejected(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request())

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were not provided",
            ctx.exception.data["detail"],
        )

    def test_malformed_jwt_is_rejected_as_invalid(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt="not-a-real-token"))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were invalid", ctx.exception.data["detail"]
        )

    def test_token_for_unknown_user_is_rejected(self):
        token = AccessToken.for_user(self.user)
        token["user_id"] = 99999999

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=str(token)))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were not provided",
            ctx.exception.data["detail"],
        )

    def test_valid_token_returns_none(self):
        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )

    def test_permission_check_ignores_scan_directory(self):
        # check_permissions does not care about scan_directory; only
        # on_completion validates it.
        self.user.scan_directory = ""
        self.user.save()

        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )


@override_config(ALLOW_UPLOAD=True)
class UploadPhotosChunkedCompleteCheckPermissionsTest(TestCase):
    """The complete-view has its own copy of the same logic (duplicated code)."""

    def setUp(self):
        self.view = UploadPhotosChunkedComplete()
        self.user = create_test_user()

    @override_config(ALLOW_UPLOAD=False)
    def test_upload_disabled_is_rejected(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=token_for(self.user)))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual("Uploading is not allowed", ctx.exception.data["detail"])

    def test_valid_token_returns_none(self):
        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )


class OnCompletionTestBase(TestCase):
    def setUp(self):
        self.view = UploadPhotosChunkedComplete()
        self.scan_dir = tempfile.mkdtemp(prefix="upload-scan-")
        self.addCleanup(shutil.rmtree, self.scan_dir, True)
        self.user = create_test_user(scan_directory=self.scan_dir)
        self.source = os.path.join(self.scan_dir, "source.jpg")
        with open(self.source, "wb") as f:
            f.write(b"image-bytes")

    def run_on_completion(self, content=b"image-bytes", filename="pic.jpg", **kwargs):
        uploaded = FakeUploadedFile(content, self.source)
        request = make_request(
            jwt=kwargs.pop("jwt", token_for(self.user)),
            post={"filename": filename, "upload_id": "abc123"},
        )
        return self.view.on_completion(uploaded, request)


class OnCompletionAuthTest(OnCompletionTestBase):
    """on_completion re-does the auth checks; ALLOW_UPLOAD is NOT re-checked."""

    def test_missing_jwt_cookie_is_rejected(self):
        request = make_request(post={"filename": "pic.jpg"})
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.on_completion(FakeUploadedFile(b"x", self.source), request)

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were not provided",
            ctx.exception.data["detail"],
        )

    def test_malformed_jwt_is_rejected_as_invalid(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion(jwt="garbage")

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were invalid", ctx.exception.data["detail"]
        )

    def test_token_for_unknown_user_is_rejected(self):
        token = AccessToken.for_user(self.user)
        token["user_id"] = 99999999

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion(jwt=str(token))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(
            "Authentication credentials were not provided",
            ctx.exception.data["detail"],
        )

    @override_config(ALLOW_UPLOAD=False)
    @patch("api.views.upload.Chain")
    @patch("api.views.upload.create_new_image")
    @patch("api.views.upload.get_object_or_404")
    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_allow_upload_false_does_not_block_on_completion(self, *_mocks):
        # Quirk: on_completion never consults site_config.ALLOW_UPLOAD.
        self.assertIsNone(self.run_on_completion())


class OnCompletionScanDirectoryTest(OnCompletionTestBase):
    def test_missing_scan_directory_is_rejected(self):
        self.user.scan_directory = ""
        self.user.save()

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion()

        self.assertEqual(400, ctx.exception.status_code)
        self.assertIn("No scan directory configured", ctx.exception.data["detail"])

    def test_whitespace_only_scan_directory_is_rejected(self):
        self.user.scan_directory = "   "
        self.user.save()

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion()

        self.assertEqual(400, ctx.exception.status_code)
        self.assertIn("No scan directory configured", ctx.exception.data["detail"])

    def test_nonexistent_scan_directory_is_rejected(self):
        missing = os.path.join(self.scan_dir, "gone")
        self.user.scan_directory = missing
        self.user.save()

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion()

        self.assertEqual(400, ctx.exception.status_code)
        self.assertIn("does not exist", ctx.exception.data["detail"])
        self.assertIn(missing, ctx.exception.data["detail"])


@patch("api.views.upload.Chain")
@patch("api.views.upload.create_new_image")
@patch("api.views.upload.get_object_or_404")
class OnCompletionBodyTest(OnCompletionTestBase):
    def uploads_dir(self):
        return os.path.join(self.scan_dir, "uploads", "web")

    @patch("api.views.upload.is_valid_media", return_value=False)
    def test_invalid_media_deletes_upload_and_raises(
        self, is_valid_media, get_object_or_404, create_new_image, chain_cls
    ):
        chunked = MagicMock()
        get_object_or_404.return_value = chunked

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion()

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("File type not allowed", ctx.exception.data["detail"])
        chunked.delete.assert_called_once_with(delete_file=True)
        # is_valid_media is given the temp file path and the user, positionally.
        self.assertEqual((self.source, self.user), is_valid_media.call_args[0])
        # Nothing was written into the scan directory.
        self.assertFalse(os.path.exists(os.path.join(self.scan_dir, "uploads")))
        create_new_image.assert_not_called()
        chain_cls.assert_not_called()

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_happy_path_writes_file_and_runs_chain(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        chunked = MagicMock()
        get_object_or_404.return_value = chunked
        photo = MagicMock()
        create_new_image.return_value = photo

        result = self.run_on_completion(content=b"hello-bytes", filename="pic.jpg")

        # Returns None (implicitly) on the import path.
        self.assertIsNone(result)

        expected_path = os.path.join(self.uploads_dir(), "pic.jpg")
        self.assertTrue(os.path.isfile(expected_path))
        with open(expected_path, "rb") as f:
            self.assertEqual(b"hello-bytes", f.read())

        chunked.delete.assert_called_once_with(delete_file=True)
        create_new_image.assert_called_once_with(self.user, expected_path)

        chain = chain_cls.return_value
        self.assertEqual(5, chain.append.call_count)
        chain.run.assert_called_once_with()
        first_call = chain.append.call_args_list[0][0]
        self.assertEqual(self.user, first_call[1])
        self.assertEqual(expected_path, first_call[2])
        # image_hash is md5 of the content + the user id
        import hashlib

        self.assertEqual(
            hashlib.md5(b"hello-bytes").hexdigest() + str(self.user.id), first_call[3]
        )
        self.assertIs(photo, first_call[4])

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_filename_is_sanitized(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        self.run_on_completion(filename="my photo!.jpg")

        self.assertTrue(
            os.path.isfile(os.path.join(self.uploads_dir(), "my_photo.jpg"))
        )

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_missing_filename_becomes_literal_none(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        # Quirk: request.POST has no "filename", get_valid_filename(None)
        # yields the string "None" rather than erroring.
        uploaded = FakeUploadedFile(b"abc", self.source)
        request = make_request(jwt=token_for(self.user), post={"upload_id": "abc123"})
        self.view.on_completion(uploaded, request)

        self.assertTrue(os.path.isfile(os.path.join(self.uploads_dir(), "None")))

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_known_image_hash_short_circuits_with_200(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        content = b"already-known"
        import hashlib

        image_hash = hashlib.md5(content).hexdigest() + str(self.user.id)
        photo_row = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=photo_row.pk).update(image_hash=image_hash)
        chunked = MagicMock()
        get_object_or_404.return_value = chunked

        response = self.run_on_completion(content=content)

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {"detail": "Photo duplicated. No new import performed."}, response.data
        )
        chunked.delete.assert_called_once_with(delete_file=True)
        create_new_image.assert_not_called()
        chain_cls.assert_not_called()
        # The uploads/web directories are still created as a side effect.
        self.assertTrue(os.path.isdir(self.uploads_dir()))
        self.assertFalse(os.path.exists(os.path.join(self.uploads_dir(), "pic.jpg")))

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_identical_file_already_on_disk_is_not_rewritten(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        os.makedirs(self.uploads_dir())
        target = os.path.join(self.uploads_dir(), "pic.jpg")
        with open(target, "wb") as f:
            f.write(b"same-content")

        response = self.run_on_completion(content=b"same-content")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {"detail": "Photo duplicated. No new import performed."}, response.data
        )
        self.assertEqual(1, len(os.listdir(self.uploads_dir())))
        create_new_image.assert_not_called()

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_name_clash_with_different_content_gets_hash_suffix(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        os.makedirs(self.uploads_dir())
        with open(os.path.join(self.uploads_dir(), "pic.jpg"), "wb") as f:
            f.write(b"other-content")

        import hashlib

        content = b"new-content"
        image_hash = hashlib.md5(content).hexdigest() + str(self.user.id)

        result = self.run_on_completion(content=content)

        self.assertIsNone(result)
        expected = os.path.join(self.uploads_dir(), f"pic_{image_hash}.jpg")
        self.assertTrue(os.path.isfile(expected))
        with open(expected, "rb") as f:
            self.assertEqual(content, f.read())
        create_new_image.assert_called_once_with(self.user, expected)

    @patch("api.views.upload.is_valid_media", return_value=True)
    def test_photo_row_lookup_is_global_not_per_user(
        self, _valid, get_object_or_404, create_new_image, chain_cls
    ):
        # image_hash embeds the user id, so another user's photo with the same
        # bytes has a different hash and does NOT short-circuit this upload.
        other = create_test_user()
        import hashlib

        content = b"shared-bytes"
        other_photo = create_test_photo(owner=other)
        Photo.objects.filter(pk=other_photo.pk).update(
            image_hash=hashlib.md5(content).hexdigest() + str(other.id)
        )

        result = self.run_on_completion(content=content)

        self.assertIsNone(result)
        # Only the other user's pre-existing row exists; the import is mocked.
        self.assertEqual(1, Photo.objects.count())
        create_new_image.assert_called_once()
