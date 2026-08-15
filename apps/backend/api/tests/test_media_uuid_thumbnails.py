"""Thumbnails must be served whether the URL carries an image_hash or a UUID.

``Thumbnail._generate_thumbnail`` always writes ``<image_hash>.<ext>``, but the
frontend addresses a photo by its primary key in several places
(``AlbumCoverPickerModal`` builds its tile from ``photo.id``, and the lightbox
``ImagePreloader`` / ``StackLightbox`` request ``thumbnails_big`` and
``square_thumbnails`` by id).  So the request filename and the stored filename
are two different strings, and anything that derives the on-disk name from the
request -- the ``X-Accel-Redirect`` in proxy mode, the ``os.path.join`` lookup
in ``SERVE_FRONTEND`` mode -- points at a file that was never written.

These tests pin the contract from both ends: the same photo must be served
identically under both spellings of its address, in both serving modes, and a
photo whose ``Thumbnail`` row is missing must degrade rather than 500.
"""

import os

from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models.thumbnail import Thumbnail
from api.tests.utils import create_test_photo, create_test_user

THUMBNAIL_FIELDS = {
    "square_thumbnails": "square_thumbnail",
    "square_thumbnails_small": "square_thumbnail_small",
    "thumbnails_big": "thumbnail_big",
}

# thumbnails_big is a static webp even for videos; the square variants follow
# the source medium.
EXPECTED_IMAGE = {
    "square_thumbnails": (".webp", "image/webp"),
    "square_thumbnails_small": (".webp", "image/webp"),
    "thumbnails_big": (".webp", "image/webp"),
}
EXPECTED_VIDEO = {
    "square_thumbnails": (".mp4", "video/mp4"),
    "square_thumbnails_small": (".mp4", "video/mp4"),
    "thumbnails_big": (".webp", "image/webp"),
}


def create_legacy_jpg_photo(user):
    """A Thumbnail row as it looks on an install that predates webp.

    Both surviving variants are ``.jpg`` and ``square_thumbnail_small`` was
    never populated -- the shape the pre-#1970 view already coped with by
    serving the big jpg for any thumbnail request.
    """
    photo = create_test_photo(owner=user, video=False)
    thumbnail = photo.thumbnail
    thumbnail.thumbnail_big.name = f"thumbnails_big/{photo.image_hash}.jpg"
    thumbnail.square_thumbnail.name = f"square_thumbnails/{photo.image_hash}.jpg"
    thumbnail.square_thumbnail_small.name = ""
    thumbnail.save()
    return photo


class MediaUuidThumbnailBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        # The media endpoint authenticates off the "jwt" cookie that
        # CustomTokenObtainPairView sets, not off the DRF Authorization header.
        self.client.cookies["jwt"] = str(AccessToken.for_user(self.user))
        self.image = create_test_photo(owner=self.user, video=False)
        self.video = create_test_photo(owner=self.user, video=True)

    def _get(self, path, fname):
        return self.client.get(f"/media/{path}/{fname}")

    def _addresses(self, photo):
        """Both spellings of the same photo's media address."""
        return (("image_hash", photo.image_hash), ("uuid", str(photo.pk)))


class ProxyThumbnailAddressingTest(MediaUuidThumbnailBase):
    """Proxy mode: the nginx internal URI must name the stored file."""

    def test_redirect_and_type_are_identical_for_hash_and_uuid(self):
        for photo, expected in (
            (self.image, EXPECTED_IMAGE),
            (self.video, EXPECTED_VIDEO),
        ):
            for path, (ext, content_type) in expected.items():
                for kind, fname in self._addresses(photo):
                    with self.subTest(video=photo.video, path=path, addressed_by=kind):
                        response = self._get(path, fname)
                        self.assertEqual(200, response.status_code)
                        self.assertEqual(
                            f"/protected_media/{path}/{photo.image_hash}{ext}",
                            response.headers.get("X-Accel-Redirect"),
                        )
                        self.assertEqual(
                            content_type, response.headers.get("Content-Type")
                        )

    def test_photo_without_thumbnail_row_does_not_error(self):
        """#1970 dropped the hasattr() guard, turning an empty 200 into a 500."""
        Thumbnail.objects.filter(photo=self.image).delete()
        Thumbnail.objects.filter(photo=self.video).delete()

        for photo in (self.image, self.video):
            for path in THUMBNAIL_FIELDS:
                for kind, fname in self._addresses(photo):
                    with self.subTest(video=photo.video, path=path, addressed_by=kind):
                        response = self._get(path, fname)
                        self.assertLess(
                            response.status_code,
                            500,
                            "a missing Thumbnail row must not raise "
                            "RelatedObjectDoesNotExist",
                        )

    def test_unknown_uuid_is_a_404(self):
        response = self._get(
            "square_thumbnails", "00000000-0000-4000-8000-000000000000"
        )
        self.assertEqual(404, response.status_code)

    def test_legacy_jpg_big_thumbnail_is_announced_as_jpeg(self):
        """The redirect names a .jpg, so the type must not claim webp."""
        photo = create_legacy_jpg_photo(self.user)

        for kind, fname in self._addresses(photo):
            with self.subTest(addressed_by=kind):
                response = self._get("thumbnails_big", fname)
                self.assertEqual(200, response.status_code)
                self.assertEqual(
                    f"/protected_media/thumbnails_big/{photo.image_hash}.jpg",
                    response.headers.get("X-Accel-Redirect"),
                )
                self.assertEqual("image/jpeg", response.headers.get("Content-Type"))


@override_settings(SERVE_FRONTEND=True)
class DirectThumbnailAddressingTest(MediaUuidThumbnailBase):
    """SERVE_FRONTEND mode: the file has to be found on disk, not guessed."""

    def setUp(self):
        super().setUp()
        self.written = []
        for photo in (self.image, self.video):
            for field in THUMBNAIL_FIELDS.values():
                self._write(getattr(photo.thumbnail, field).name)

    def tearDown(self):
        for file_path in self.written:
            if os.path.exists(file_path):
                os.remove(file_path)
        super().tearDown()

    def _write(self, name):
        file_path = os.path.join(settings.MEDIA_ROOT, name)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "wb") as handle:
            handle.write(b"thumbnail-bytes")
        self.written.append(file_path)

    def test_stored_file_is_served_for_hash_and_uuid(self):
        for photo, expected in (
            (self.image, EXPECTED_IMAGE),
            (self.video, EXPECTED_VIDEO),
        ):
            for path, (_ext, content_type) in expected.items():
                for kind, fname in self._addresses(photo):
                    with self.subTest(video=photo.video, path=path, addressed_by=kind):
                        response = self._get(path, fname)
                        try:
                            self.assertEqual(
                                200,
                                response.status_code,
                                "the thumbnail exists on disk under its "
                                "image_hash name and must be found",
                            )
                            self.assertEqual(
                                content_type, response.headers.get("Content-Type")
                            )
                        finally:
                            response.close()

    def test_legacy_jpg_row_falls_back_to_the_big_jpg(self):
        """A legacy row with no small variant must not start 404ing.

        Resolving from the model first means an unpopulated field now yields
        no candidate at all, so the big-jpg fallback has to stay reachable
        after the request-derived lookup fails.
        """
        photo = create_legacy_jpg_photo(self.user)
        self._write(f"thumbnails_big/{photo.image_hash}.jpg")

        for path in THUMBNAIL_FIELDS:
            for kind, fname in self._addresses(photo):
                with self.subTest(path=path, addressed_by=kind):
                    response = self._get(path, fname)
                    try:
                        self.assertEqual(200, response.status_code)
                        self.assertEqual(
                            "image/jpg", response.headers.get("Content-Type")
                        )
                    finally:
                        response.close()

    def test_unknown_uuid_is_a_404(self):
        response = self._get(
            "square_thumbnails", "00000000-0000-4000-8000-000000000000"
        )
        self.assertEqual(404, response.status_code)
