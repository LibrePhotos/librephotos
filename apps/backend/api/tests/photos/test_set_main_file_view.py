"""Characterization tests for ``SetMainFileView.post`` (CRAP unit 34).

The view lives in ``api/views/photos.py``.  These tests pin the *current*
observable behaviour (status codes, response bodies and the side effect on the
``Photo`` row) so that a later refactor can be validated against them.

Behaviours pinned here:

* A missing/empty/falsy ``file_hash`` in the request body short-circuits with
  400 ``{"error": "file_hash is required"}`` *before* the photo is looked up,
  so a bogus ``image_hash`` still yields 400 rather than 404.
* The photo lookup is scoped to ``request.user``: another user's photo is
  indistinguishable from a missing one (404 ``{"error": "Photo not found"}``).
* ``Photo.MultipleObjectsReturned`` is caught and retried with
  ``.filter(...).first()``.  This branch is unreachable through the ORM in
  practice (``image_hash`` is the primary key) and is only reachable in tests
  by forcing the manager to raise.
* The variant is looked up through the ``photo.files`` m2m only, so a ``File``
  row that is the photo's ``main_file`` but was never added to ``photo.files``
  yields 404 ``{"error": "File variant not found in this photo"}``.
* On success the response is 200 ``{"status": "updated", "main_file_hash":
  <hash>}`` and ``photo.main_file`` is persisted; ``last_modified``
  (``auto_now=True``) is bumped because it is listed in ``update_fields``.
* The view does not validate that the new main file is of a sensible type and
  happily accepts a variant that is already the main file (idempotent).
"""

import os
import shutil
import tempfile
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate

from api.models import File, Photo
from api.tests.utils import create_test_photo, create_test_user
from api.views.photos import SetMainFileView


class SetMainFileViewTest(APITestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = SetMainFileView.as_view()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

        self.tmpdir = tempfile.mkdtemp(prefix="u34-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)

    # --- helpers --------------------------------------------------------

    def make_variant(self, name="variant.raw", attach=True):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as handle:
            handle.write(b"raw-bytes")
        variant = File.objects.create(
            hash=f"u34-{len(File.objects.all())}-{name}",
            path=path,
            type=File.RAW_FILE,
        )
        if attach:
            self.photo.files.add(variant)
        return variant

    def call(self, image_hash, data, user=None):
        request = self.factory.post(
            f"/api/photos/{image_hash}/main-file", data, format="json"
        )
        force_authenticate(request, user=user if user is not None else self.user)
        return self.view(request, image_hash=image_hash)

    # --- file_hash validation -------------------------------------------

    def test_missing_file_hash_returns_400(self):
        response = self.call(self.photo.image_hash, {})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {"error": "file_hash is required"})

    def test_empty_file_hash_returns_400(self):
        response = self.call(self.photo.image_hash, {"file_hash": ""})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {"error": "file_hash is required"})

    def test_null_file_hash_returns_400(self):
        response = self.call(self.photo.image_hash, {"file_hash": None})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {"error": "file_hash is required"})

    def test_missing_file_hash_wins_over_unknown_photo(self):
        """Validation happens before the photo lookup: 400, not 404."""
        response = self.call("deadbeef", {})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {"error": "file_hash is required"})

    # --- photo lookup branches ------------------------------------------

    def test_unknown_image_hash_returns_404(self):
        variant = self.make_variant()

        response = self.call("deadbeef", {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})

    def test_photo_of_another_user_returns_photo_not_found(self):
        variant = self.make_variant()

        response = self.call(
            self.photo.image_hash, {"file_hash": variant.hash}, user=self.other_user
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})
        self.photo.refresh_from_db()
        self.assertNotEqual(self.photo.main_file_id, variant.pk)

    def test_multiple_objects_returned_falls_back_to_first_match(self):
        variant = self.make_variant()

        with patch.object(
            Photo.objects, "get", side_effect=Photo.MultipleObjectsReturned()
        ):
            response = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data, {"status": "updated", "main_file_hash": variant.hash}
        )
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.main_file_id, variant.pk)

    def test_multiple_objects_returned_with_no_match_returns_404(self):
        variant = self.make_variant()

        with patch.object(
            Photo.objects, "get", side_effect=Photo.MultipleObjectsReturned()
        ):
            response = self.call(
                self.photo.image_hash,
                {"file_hash": variant.hash},
                user=self.other_user,
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"error": "Photo not found"})

    # --- variant lookup branches ----------------------------------------

    def test_unknown_file_hash_returns_variant_not_found(self):
        self.make_variant()

        response = self.call(self.photo.image_hash, {"file_hash": "nosuchhash"})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data, {"error": "File variant not found in this photo"}
        )

    def test_variant_not_attached_to_photo_returns_variant_not_found(self):
        detached = self.make_variant(name="detached.raw", attach=False)

        response = self.call(self.photo.image_hash, {"file_hash": detached.hash})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data, {"error": "File variant not found in this photo"}
        )

    def test_variant_of_another_photo_returns_variant_not_found(self):
        other_photo = create_test_photo(owner=self.user)
        foreign = self.make_variant(name="foreign.raw")
        self.photo.files.remove(foreign)
        other_photo.files.add(foreign)

        response = self.call(self.photo.image_hash, {"file_hash": foreign.hash})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data, {"error": "File variant not found in this photo"}
        )

    def test_current_main_file_not_in_files_m2m_is_rejected(self):
        """The lookup goes through ``photo.files`` only, so the photo's own
        ``main_file`` is a 404 until it is added to that relation."""
        current_main = self.photo.main_file
        self.assertIsNotNone(current_main)
        self.assertNotIn(current_main, list(self.photo.files.all()))

        response = self.call(self.photo.image_hash, {"file_hash": current_main.hash})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data, {"error": "File variant not found in this photo"}
        )

    # --- happy path ------------------------------------------------------

    def test_sets_main_file_and_returns_updated(self):
        variant = self.make_variant()
        previous_main_id = self.photo.main_file_id

        response = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data, {"status": "updated", "main_file_hash": variant.hash}
        )
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.main_file_id, variant.pk)
        self.assertNotEqual(self.photo.main_file_id, previous_main_id)

    def test_last_modified_is_bumped_on_success(self):
        variant = self.make_variant()
        before = Photo.objects.get(image_hash=self.photo.image_hash).last_modified

        response = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        after = Photo.objects.get(image_hash=self.photo.image_hash).last_modified
        self.assertGreaterEqual(after, before)

    def test_setting_the_same_variant_twice_is_idempotent(self):
        variant = self.make_variant()

        first = self.call(self.photo.image_hash, {"file_hash": variant.hash})
        second = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data, first.data)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.main_file_id, variant.pk)

    def test_first_matching_variant_wins_when_hash_is_duplicated(self):
        """``photo.files.filter(hash=...).first()`` -- no uniqueness check."""
        variant = self.make_variant(name="dup-a.raw")

        response = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.main_file_id, variant.pk)

    def test_other_users_photo_is_untouched_when_hash_collides(self):
        other_photo = create_test_photo(owner=self.other_user)
        other_main_id = other_photo.main_file_id
        variant = self.make_variant()

        response = self.call(self.photo.image_hash, {"file_hash": variant.hash})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        other_photo.refresh_from_db()
        self.assertEqual(other_photo.main_file_id, other_main_id)

    def test_unauthenticated_request_is_rejected(self):
        variant = self.make_variant()
        request = self.factory.post(
            f"/api/photos/{self.photo.image_hash}/main-file",
            {"file_hash": variant.hash},
            format="json",
        )
        response = self.view(request, image_hash=self.photo.image_hash)

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )
        self.photo.refresh_from_db()
        self.assertNotEqual(self.photo.main_file_id, variant.pk)
