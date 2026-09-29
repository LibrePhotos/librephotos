"""Path-traversal regression tests for direct media serving (GHSA draft).

In *direct* mode (``SERVE_FRONTEND`` set: the unified Docker image, the Windows
standalone build and ``dev_windows``) ``UnifiedMediaAccessView`` joins the
URL-controlled ``path``/``fname`` segments onto ``MEDIA_ROOT`` and streams the
file itself, instead of handing an ``X-Accel-Redirect`` to nginx.

The photo lookup only consumes ``fname.split(".")[0].split("_")[0]`` as the
image hash, so everything after the first ``_`` (or ``.``) in ``fname`` is
free-form and reaches ``os.path.join(MEDIA_ROOT, path, fname)`` unchecked. On
Windows a backslash is a directory separator, and ``os.path.join`` plus the
filesystem collapse ``<hash>_\..\..\..\target`` lexically -- even through a
directory that does not exist -- straight out of ``MEDIA_ROOT``. Django decodes
``%5C`` into ``\`` in ``PATH_INFO``, so an authenticated user who can see any
one photo could read arbitrary files off the host (the JWT signing key, the DB
config, ...).

Each test plants a sentinel *outside* a temporary ``MEDIA_ROOT`` and asserts the
traversal is refused (403/404) and never leaks the sentinel, while an ordinary
in-root request still serves.

The escape depth is fixed by the join, not by how deep ``MEDIA_ROOT`` happens to
sit: ``os.path.join(MEDIA_ROOT, "faces", "<hash>_\\..\\..\\..\\x")`` walks up
from ``MEDIA_ROOT/faces/<hash>_`` -> ``.../faces`` -> ``MEDIA_ROOT`` ->
``dirname(MEDIA_ROOT)``, so exactly three ``..`` land in the sentinel's
directory. More would climb past it; fewer would stay inside.
"""

import os
import shutil
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from api.tests.utils import create_test_photo, create_test_user
from api.views.media import UnifiedMediaAccessView

factory = APIRequestFactory()

SENTINEL = b"JWT-SIGNING-SECRET-OUTSIDE-MEDIA-ROOT"


def _token_for(user):
    return str(RefreshToken.for_user(user).access_token)


def _body(response):
    if getattr(response, "streaming", False):
        return b"".join(response.streaming_content)
    return response.content


@override_settings(SERVE_FRONTEND=True)
class DirectModePathTraversalTest(TestCase):
    """Direct mode must never serve a file resolved outside ``MEDIA_ROOT``."""

    def setUp(self):
        # A real MEDIA_ROOT on disk, and sentinels one level above it that a
        # three-hop traversal off MEDIA_ROOT/faces/<name> reaches.
        self.media_root = tempfile.mkdtemp(prefix="media_root_")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        os.makedirs(os.path.join(self.media_root, "faces"), exist_ok=True)
        self.outside = os.path.dirname(self.media_root)

        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        image_hash = self.photo.image_hash

        # One sentinel with an arbitrary name (reached by putting the traversal
        # in fname), and one named exactly the image hash (reached by putting
        # the traversal in the path segment while fname stays a valid hash).
        self.named_sentinel = self._plant("traversal_sentinel.key")
        self.hash_sentinel = self._plant(image_hash)

        # A face crop that legitimately lives inside MEDIA_ROOT, so the positive
        # case can prove the fix does not break ordinary direct serving.
        self.face_name = f"{image_hash}_1.jpg"
        with open(
            os.path.join(self.media_root, "faces", self.face_name), "wb"
        ) as handle:
            handle.write(b"a-real-face-crop")

    def _plant(self, name):
        target = os.path.join(self.outside, name)
        with open(target, "wb") as handle:
            handle.write(SENTINEL)
        self.addCleanup(lambda: os.path.exists(target) and os.remove(target))
        return target

    # -- helpers ---------------------------------------------------------------

    def _view(self, path, fname):
        with override_settings(MEDIA_ROOT=self.media_root):
            request = factory.get("/media/x/y")
            request.COOKIES["jwt"] = _token_for(self.owner)
            return UnifiedMediaAccessView.as_view()(request, path=path, fname=fname)

    def _client(self, url):
        with override_settings(MEDIA_ROOT=self.media_root):
            self.client.cookies["jwt"] = _token_for(self.owner)
            return self.client.get(url)

    def _assert_refused(self, response):
        self.assertIn(response.status_code, (403, 404))
        self.assertNotIn(SENTINEL, _body(response))

    # -- the sentinel never leaves the box ------------------------------------

    def test_backslash_traversal_in_fname_via_view(self):
        # The core Windows vector: backslashes in the free-form tail of fname.
        fname = f"{self.photo.image_hash}_\\..\\..\\..\\traversal_sentinel.key"
        self._assert_refused(self._view("faces", fname))

    def test_forward_slash_dotdot_in_fname_via_view(self):
        # "../" in fname is refused on every platform, not just Windows.
        fname = f"{self.photo.image_hash}_/../../../traversal_sentinel.key"
        self._assert_refused(self._view("faces", fname))

    def test_dotdot_traversal_in_path_via_view(self):
        # The traversal lives in the path segment; fname stays a valid hash, so
        # the photo resolves and authorization passes, and the join lands on the
        # hash-named sentinel outside MEDIA_ROOT.
        self._assert_refused(self._view("faces/../../..", self.photo.image_hash))

    def test_backslash_traversal_via_full_request(self):
        # End to end through Django routing: %5C is decoded to a backslash and
        # delivered to the view, exactly as an attacker would send it.
        url = (
            f"/media/faces/{self.photo.image_hash}"
            "_%5C..%5C..%5C..%5Ctraversal_sentinel.key"
        )
        self._assert_refused(self._client(url))

    def test_absolute_sentinel_path_in_fname_is_refused(self):
        # A drive- or root-absolute tail must not be honoured either.
        fname = f"{self.photo.image_hash}_" + self.named_sentinel
        self._assert_refused(self._view("faces", fname))

    # -- ordinary serving is unaffected ---------------------------------------

    def test_legitimate_face_crop_in_root_still_serves(self):
        response = self._view("faces", self.face_name)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_body(response), b"a-real-face-crop")
