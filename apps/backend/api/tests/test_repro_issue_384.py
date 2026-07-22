"""Regression test for issue #384 -- "Only show video, but not image after first scan".

https://github.com/LibrePhotos/librephotos/issues/384

The reporter (Nov 2021, Safari) saw every *image* tile render as a broken
placeholder while *video* tiles played fine, and quoted
``GET /media/square_thumbnails/<image_hash>`` -> ``403 Forbidden``.

Both tile kinds hit the very same endpoint with the very same URL shape
(``Tile.tsx`` builds ``/media/square_thumbnails/${image_hash}`` for ``<img>``
and ``<video>`` alike), and no auth branch in the media view ever looks at
``Photo.video`` -- so the asymmetry the reporter saw could only come from how
the browser handled the *response*: the status code, the ``Content-Type`` and
the ``X-Accel-Redirect`` nginx internal URI.

The media view of that era (``MediaAccessFullsizeOriginalView``) built that
internal URI as ``"/protected_media{}/{}".format(path, fname)`` -- with no
separator slash, i.e. ``/protected_mediasquare_thumbnails/<hash>.webp``.  It
was replaced wholesale by ``UnifiedMediaAccessView`` in commit f42274b6
("Merge no proxy media management", 2025-08-19), whose ``_protected_media_url``
does ``path = path.lstrip("/")`` and interpolates a real ``/``.

This test pins the contract that was broken back then: for an authenticated
owner, an *image* thumbnail must be served exactly as successfully, and with a
type/URI just as correct, as a *video* thumbnail.
"""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.tests.utils import create_test_photo, create_test_user


class Issue384MediaThumbnailsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        # The media endpoint authenticates off the "jwt" cookie that
        # CustomTokenObtainPairView sets, not off the DRF Authorization header.
        self.client.cookies["jwt"] = str(AccessToken.for_user(self.user))

    def _get(self, path, image_hash):
        return self.client.get(f"/media/{path}/{image_hash}")

    def test_image_thumbnail_is_served_like_a_video_thumbnail(self):
        """Images must not 403 / come back unusable while videos work."""
        image = create_test_photo(owner=self.user, video=False)
        video = create_test_photo(owner=self.user, video=True)

        image_response = self._get("square_thumbnails", image.image_hash)
        video_response = self._get("square_thumbnails", video.image_hash)

        self.assertEqual(
            200,
            video_response.status_code,
            "sanity check: the video thumbnail is expected to work",
        )
        self.assertEqual(
            200,
            image_response.status_code,
            "issue #384: the image thumbnail 403s while the video one is served",
        )

    def test_thumbnail_content_type_matches_the_stored_thumbnail_format(self):
        """A <img> tag cannot render a webp announced as something else."""
        image = create_test_photo(owner=self.user, video=False)
        video = create_test_photo(owner=self.user, video=True)

        self.assertEqual(
            "image/webp",
            self._get("square_thumbnails", image.image_hash).headers.get(
                "Content-Type"
            ),
        )
        self.assertEqual(
            "image/webp",
            self._get("square_thumbnails_small", image.image_hash).headers.get(
                "Content-Type"
            ),
        )
        # thumbnails_big is a static webp even for videos
        self.assertEqual(
            "image/webp",
            self._get("thumbnails_big", video.image_hash).headers.get("Content-Type"),
        )
        self.assertEqual(
            "video/mp4",
            self._get("square_thumbnails", video.image_hash).headers.get(
                "Content-Type"
            ),
        )

    def test_internal_redirect_uri_is_well_formed_for_images(self):
        """X-Accel-Redirect must be a URI nginx can actually resolve.

        The pre-rewrite helper produced "/protected_mediasquare_thumbnails/..."
        (missing separator), which nginx cannot map to its internal
        /protected_media/ location -- the browser then shows a placeholder.
        """
        image = create_test_photo(owner=self.user, video=False)
        video = create_test_photo(owner=self.user, video=True)

        for path, photo, ext in (
            ("square_thumbnails", image, ".webp"),
            ("square_thumbnails_small", image, ".webp"),
            ("thumbnails_big", image, ".webp"),
            ("square_thumbnails", video, ".mp4"),
            ("square_thumbnails_small", video, ".mp4"),
        ):
            with self.subTest(path=path, video=photo.video):
                redirect = self._get(path, photo.image_hash).headers.get(
                    "X-Accel-Redirect"
                )
                self.assertEqual(
                    f"/protected_media/{path}/{photo.image_hash}{ext}",
                    redirect,
                )
