"""Characterization tests for ``FileVariantDownloadView.get`` and
``RotatePhotoView.post`` (CRAP unit 33).

Both views live in ``api/views/photos.py``.  The tests below pin the *current*
observable behaviour (status codes, response bodies, headers and the side
effects on the ``Photo`` row) so that a later refactor can be validated
against them.

Notable current behaviours pinned here:

* ``FileVariantDownloadView`` looks the photo up scoped to ``request.user``,
  so another user's photo is indistinguishable from a missing one (404
  ``{"error": "Photo not found"}``).
* The variant is looked up through the ``photo.files`` m2m only -- a
  ``File`` row that happens to be the photo's ``main_file`` but was never
  added to ``photo.files`` yields "File variant not found".
* ``Photo.MultipleObjectsReturned`` is caught and retried with
  ``.filter(...).first()``; this branch is unreachable through the ORM in
  practice (the ``get`` is already scoped by owner) and is only reachable in
  tests by forcing the manager to raise.
* Content-Type comes from ``python-magic`` and silently falls back to
  ``application/octet-stream`` on *any* exception.
* ``RotatePhotoView`` validates ``image_hash``/``angle`` before touching the
  DB, rejects videos, and turns any exception from ``Photo.rotate`` into a
  500 with ``{"status": False, "message": "failed to rotate photo"}``.
* ``RotatePhotoView`` rejects ``angle % 90 != 0`` using Python's modulo, so a
  negative non-multiple such as ``-45`` is rejected too, while ``-90`` is
  accepted and normalised by ``Photo.rotate`` to orientation 8.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate

from api.models import File, Photo
from api.tests.utils import create_test_photo, create_test_user
from api.views.photos import FileVariantDownloadView, RotatePhotoView


# ---------------------------------------------------------------------------
# FileVariantDownloadView.get
# ---------------------------------------------------------------------------


class FileVariantDownloadViewTest(APITestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = FileVariantDownloadView.as_view()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

        self.tmpdir = tempfile.mkdtemp(prefix="u33-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)

    def make_variant(self, name="variant.raw", content=b"raw-bytes"):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as handle:
            handle.write(content)
        variant = File.objects.create(
            hash=f"aaaa{len(File.objects.all())}{name}", path=path, type=File.RAW_FILE
        )
        self.photo.files.add(variant)
        return variant

    def call(self, image_hash, file_hash, user=None):
        request = self.factory.get(f"/api/photos/{image_hash}/file/{file_hash}")
        force_authenticate(request, user=user if user is not None else self.user)
        return self.view(request, image_hash=image_hash, file_hash=file_hash)

    # --- happy path -----------------------------------------------------

    def test_serves_existing_variant_as_attachment(self):
        variant = self.make_variant()

        with patch("magic.Magic") as magic_cls:
            magic_cls.return_value.from_file.return_value = "image/x-canon-cr2"
            response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/x-canon-cr2")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("variant.raw", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), b"raw-bytes")
        response.close()

    def test_content_type_falls_back_to_octet_stream_when_magic_raises(self):
        variant = self.make_variant(name="odd.bin")

        with patch("magic.Magic", side_effect=RuntimeError("no libmagic")):
            response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        response.close()

    # --- photo lookup branches -----------------------------------------

    def test_unknown_image_hash_returns_404(self):
        variant = self.make_variant()

        response = self.call("deadbeef", variant.hash)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})

    def test_photo_of_another_user_returns_photo_not_found(self):
        variant = self.make_variant()

        response = self.call(self.photo.image_hash, variant.hash, user=self.other_user)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})

    def test_multiple_objects_returned_falls_back_to_first_match(self):
        variant = self.make_variant()

        def raising_get(*args, **kwargs):
            raise Photo.MultipleObjectsReturned()

        with (
            patch.object(Photo.objects, "get", side_effect=raising_get),
            patch("magic.Magic") as magic_cls,
        ):
            magic_cls.return_value.from_file.return_value = "application/x-raw"
            response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response.close()

    def test_multiple_objects_returned_with_no_match_returns_404(self):
        variant = self.make_variant()

        with patch.object(
            Photo.objects, "get", side_effect=Photo.MultipleObjectsReturned()
        ):
            response = self.call(
                self.photo.image_hash, variant.hash, user=self.other_user
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})

    # --- variant lookup branches ----------------------------------------

    def test_unknown_file_hash_returns_file_variant_not_found(self):
        self.make_variant()

        response = self.call(self.photo.image_hash, "nosuchhash")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "File variant not found"})

    def test_main_file_not_in_files_m2m_is_not_downloadable(self):
        """The lookup goes through ``photo.files`` only, so the photo's own
        ``main_file`` is a 404 until it is added to that relation."""
        response = self.call(self.photo.image_hash, self.photo.main_file.hash)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "File variant not found"})

    def test_variant_of_another_photo_returns_file_variant_not_found(self):
        other_photo = create_test_photo(owner=self.user)
        foreign = self.make_variant(name="foreign.raw")
        self.photo.files.remove(foreign)
        other_photo.files.add(foreign)

        response = self.call(self.photo.image_hash, foreign.hash)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "File variant not found"})

    # --- disk branches ---------------------------------------------------

    def test_missing_file_on_disk_returns_404(self):
        variant = self.make_variant(name="gone.raw")
        os.remove(variant.path)

        response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "File not found on disk"})

    def test_open_failure_after_exists_check_returns_500(self):
        """``os.path.exists`` and ``open`` are two separate calls, so a file
        that vanishes (or is unreadable) in between yields a 500."""
        variant = self.make_variant(name="racy.raw")
        os.remove(variant.path)

        with patch("os.path.exists", return_value=True):
            response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data, {"error": "Could not read file"})

    def test_permission_error_on_open_returns_500(self):
        variant = self.make_variant(name="locked.raw")

        with patch("builtins.open", side_effect=PermissionError("denied")):
            response = self.call(self.photo.image_hash, variant.hash)

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data, {"error": "Could not read file"})

    def test_unauthenticated_request_is_rejected(self):
        variant = self.make_variant()
        request = self.factory.get(
            f"/api/photos/{self.photo.image_hash}/file/{variant.hash}"
        )

        response = self.view(
            request, image_hash=self.photo.image_hash, file_hash=variant.hash
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


# ---------------------------------------------------------------------------
# RotatePhotoView.post
# ---------------------------------------------------------------------------


class RotatePhotoViewTest(APITestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = RotatePhotoView.as_view()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

        patcher = patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
        self.regen = patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, payload, user=None):
        request = self.factory.post("/api/photosedit/rotate", payload, format="json")
        force_authenticate(request, user=user if user is not None else self.user)
        return self.view(request)

    # --- validation branches --------------------------------------------

    def test_missing_image_hash_returns_400(self):
        response = self.call({"angle": 90})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data, {"status": False, "message": "image_hash is required"}
        )
        self.regen.assert_not_called()

    def test_empty_image_hash_returns_400(self):
        response = self.call({"image_hash": "", "angle": 90})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data, {"status": False, "message": "image_hash is required"}
        )

    def test_non_integer_angle_returns_400(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": "abc"})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data, {"status": False, "message": "angle must be an integer"}
        )

    def test_null_angle_returns_400(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": None})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data, {"status": False, "message": "angle must be an integer"}
        )

    def test_numeric_string_angle_is_accepted(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": "90"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 6)

    def test_float_angle_is_truncated_by_int(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": 90.7})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 6)

    def test_angle_not_multiple_of_90_returns_400(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": 45})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data,
            {"status": False, "message": "angle must be a multiple of 90 degrees"},
        )
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 1)

    def test_negative_angle_not_multiple_of_90_returns_400(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": -45})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data,
            {"status": False, "message": "angle must be a multiple of 90 degrees"},
        )

    def test_missing_angle_defaults_to_zero_and_is_a_noop_200(self):
        response = self.call({"image_hash": self.photo.image_hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 1)
        self.regen.assert_not_called()

    # --- photo lookup branches -------------------------------------------

    def test_unknown_photo_returns_404(self):
        response = self.call({"image_hash": "deadbeef", "angle": 90})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"status": False, "message": "photo not found"})

    def test_photo_of_another_user_returns_404(self):
        response = self.call(
            {"image_hash": self.photo.image_hash, "angle": 90}, user=self.other_user
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"status": False, "message": "photo not found"})
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 1)

    def test_video_returns_400(self):
        video = create_test_photo(owner=self.user, video=True)

        response = self.call({"image_hash": video.image_hash, "angle": 90})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data,
            {"status": False, "message": "rotation is not supported for videos"},
        )
        self.regen.assert_not_called()

    # --- rotation failure -------------------------------------------------

    def test_rotate_exception_returns_500(self):
        with patch.object(Photo, "rotate", side_effect=RuntimeError("boom")):
            response = self.call({"image_hash": self.photo.image_hash, "angle": 90})

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(
            response.data, {"status": False, "message": "failed to rotate photo"}
        )
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 1)

    # --- happy paths ------------------------------------------------------

    def test_rotate_90_returns_orientation_6_and_persists(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": 90})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["status"])
        self.assertEqual(response.data["image_hash"], self.photo.image_hash)
        self.assertEqual(response.data["local_orientation"], 6)
        self.assertIsInstance(response.data["last_modified"], str)
        self.regen.assert_called_once()

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 6)

    def test_rotate_180_returns_orientation_3(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": 180})

        self.assertEqual(response.data["local_orientation"], 3)

    def test_rotate_negative_90_normalises_to_orientation_8(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": -90})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 8)

    def test_rotate_360_is_a_noop(self):
        response = self.call({"image_hash": self.photo.image_hash, "angle": 360})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 1)
        self.regen.assert_not_called()

    def test_flip_horizontal_without_rotation_sets_orientation_2(self):
        response = self.call(
            {
                "image_hash": self.photo.image_hash,
                "angle": 0,
                "flip_horizontal": True,
            }
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["local_orientation"], 2)
        self.regen.assert_called_once()

    def test_rotations_compose_across_requests(self):
        self.call({"image_hash": self.photo.image_hash, "angle": 90})
        response = self.call({"image_hash": self.photo.image_hash, "angle": 90})

        self.assertEqual(response.data["local_orientation"], 3)

    def test_unauthenticated_request_is_rejected(self):
        request = self.factory.post(
            "/api/photosedit/rotate",
            {"image_hash": self.photo.image_hash, "angle": 90},
            format="json",
        )

        response = self.view(request)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
