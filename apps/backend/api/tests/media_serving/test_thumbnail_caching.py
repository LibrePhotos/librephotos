"""Thumbnails a browser may keep (api.serving.caching).

They used to go out without any caching header, so a grid tile scrolled back
into view, or any reload, downloaded its picture again through the media
view's permission check. A thumbnail asked for with ``?v=`` (the grid passes a
digest of the photo's ThumbHash) is kept for a year; any other is kept and
revalidated, and an unchanged file is a bodiless 304 when Django serves it.
"""

import os
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.serving.caching import REVALIDATED, VERSIONED
from api.tests.utils import create_test_photo, create_test_user


class _ThumbnailTestCase(TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        overrider = override_settings(MEDIA_ROOT=folder.name)
        overrider.enable()
        self.addCleanup(overrider.disable)
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        os.makedirs(os.path.join(folder.name, "square_thumbnails"))
        self.path = os.path.join(
            folder.name, "square_thumbnails", self.photo.image_hash + ".webp"
        )
        with open(self.path, "wb") as handle:
            handle.write(b"RIFF....WEBP")
        self.client = APIClient()
        self.client.cookies["jwt"] = str(RefreshToken.for_user(self.user).access_token)
        self.url = f"/media/square_thumbnails/{self.photo.image_hash}"

    def get(self, url, **headers):
        response = self.client.get(url, **headers)
        self.addCleanup(response.close)
        return response


@override_settings(SERVE_FRONTEND=True)
class ServedByDjangoTest(_ThumbnailTestCase):
    def test_a_versioned_thumbnail_is_kept_for_a_year(self):
        response = self.get(self.url + "?v=k3f9a")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], VERSIONED)

    def test_an_unversioned_one_is_kept_and_revalidated(self):
        response = self.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], REVALIDATED)
        self.assertTrue(response["ETag"].startswith('"'))

    def test_an_unchanged_file_is_a_304_without_a_body(self):
        etag = self.get(self.url)["ETag"]

        response = self.get(self.url, HTTP_IF_NONE_MATCH=etag)

        self.assertEqual(response.status_code, 304)
        self.assertEqual(response["ETag"], etag)
        self.assertEqual(response["Cache-Control"], REVALIDATED)
        self.assertEqual(response.content, b"")

    def test_a_rewritten_file_is_sent_again(self):
        etag = self.get(self.url)["ETag"]
        with open(self.path, "wb") as handle:
            handle.write(b"RIFF....WEBP rotated")

        response = self.get(self.url, HTTP_IF_NONE_MATCH=etag)

        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response["ETag"], etag)

    def test_a_refusal_is_not_cached(self):
        self.client.cookies.clear()
        response = self.get(self.url + "?v=k3f9a")
        self.assertIn(response.status_code, (401, 403, 404))
        self.assertFalse(response.has_header("Cache-Control"))

    def test_an_original_gets_a_validator_but_no_caching_rule(self):
        response = self.get(f"/media/photos/{self.photo.image_hash}")
        self.assertFalse(response.has_header("Cache-Control"))


@override_settings(SERVE_FRONTEND=False)
class BehindTheProxyTest(_ThumbnailTestCase):
    def test_nginx_is_told_how_long_to_let_the_browser_keep_it(self):
        response = self.get(self.url + "?v=k3f9a")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/square_thumbnails/{self.photo.image_hash}.webp",
        )
        self.assertEqual(response["Cache-Control"], VERSIONED)

    def test_unversioned_behind_the_proxy_is_revalidated(self):
        self.assertEqual(self.get(self.url)["Cache-Control"], REVALIDATED)
