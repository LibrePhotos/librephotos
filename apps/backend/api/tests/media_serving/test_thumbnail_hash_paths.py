"""A photo's hash names its thumbnail files, so it can only ever be a file name.

The photo endpoint took ``image_hash`` in a PATCH, and the thumbnail code
joined the hash onto MEDIA_ROOT as it was. A hash of ``/tmp/x`` or ``../x``
then made a rotation delete and write thumbnails outside the thumbnail
directories. The hash is read-only now, and every thumbnail path refuses a
hash that is not a bare file name, so a row that already holds one cannot
reach the disk either.
"""

import os
import tempfile

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.models.thumbnail import thumbnail_file_paths, thumbnail_path
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails import render
from api.video import transcode_cache

UNSAFE_HASHES = [
    "",
    ".",
    "..",
    "../outside",
    "a/../../outside",
    "/tmp/outside",
    "..\\outside",
    "C:\\outside",
    "nul\0byte",
]


class PhotoHashIsReadOnlyTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.original_hash = self.photo.image_hash

    def test_patch_does_not_change_the_hash(self):
        target = os.path.join(tempfile.gettempdir(), "lp_hash_poc")
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/", {"image_hash": target}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["image_hash"], self.original_hash)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.image_hash, self.original_hash)


class ThumbnailPathsRefuseUnsafeHashesTest(TestCase):
    def test_a_photo_hash_gives_paths_inside_the_thumbnail_directories(self):
        path = thumbnail_path("thumbnails_big", "0123abcd1", ".webp")
        self.assertTrue(path.endswith(os.path.join("thumbnails_big", "0123abcd1.webp")))
        self.assertEqual(len(thumbnail_file_paths("0123abcd1")), 5)

    def test_unsafe_hashes_raise(self):
        for photo_hash in UNSAFE_HASHES:
            with self.subTest(photo_hash=photo_hash):
                with self.assertRaises(ValueError):
                    thumbnail_path("thumbnails_big", photo_hash, ".webp")
                with self.assertRaises(ValueError):
                    thumbnail_file_paths(photo_hash)
                with self.assertRaises(ValueError):
                    render.does_static_thumbnail_exist("thumbnails_big", photo_hash)

    def test_the_transcode_cache_has_no_path_for_an_unsafe_hash(self):
        with self.settings(TRANSCODE_CACHE_ROOT=tempfile.gettempdir()):
            self.assertIsNone(transcode_cache.final_path("../outside"))
            self.assertIsNotNone(transcode_cache.final_path("0123abcd1"))

    def test_a_stored_unsafe_hash_never_reaches_the_disk(self):
        """A row written before the fix: the rebuild refuses before any delete."""
        user = create_test_user()
        photo = create_test_photo(owner=user)
        with tempfile.TemporaryDirectory() as outside:
            victim = os.path.join(outside, "victim.webp")
            with open(victim, "wb") as f:
                f.write(b"keep me")
            Photo.objects.filter(pk=photo.pk).update(
                image_hash=os.path.join(outside, "victim")
            )
            photo.refresh_from_db()

            with self.assertRaises(ValueError):
                render.regenerate_thumbnails(photo.thumbnail)

            with open(victim, "rb") as f:
                self.assertEqual(f.read(), b"keep me")
            self.assertEqual(os.listdir(outside), ["victim.webp"])
