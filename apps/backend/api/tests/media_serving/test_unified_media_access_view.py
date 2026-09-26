"""Characterization tests for the media-serving views (unit 38).

These pin the *current* behaviour of ``api.views.media.UnifiedMediaAccessView.get``,
the big dispatcher that routes ``/media/<path>/<fname>`` to zip, avatar,
embedded-media, public-album and photo/thumbnail handling, in both proxy
(``X-Accel-Redirect``) and direct-serving modes.

They are deliberately written against the response headers and status codes a
caller can observe, so a refactor that preserves behaviour keeps them green.
"""

import os

from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import AlbumUser, File
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import ONE_PIXEL_PNG, create_test_photo, create_test_user
from api.views.media import UnifiedMediaAccessView

factory = APIRequestFactory()


def _token_for(user):
    return str(RefreshToken.for_user(user).access_token)


def _call(view_class, path, fname, *, user=None, jwt=None, album_id=None, headers=None):
    request = factory.get(f"/media/{path}/{fname}")
    if user is not None:
        request.COOKIES["jwt"] = _token_for(user)
    if jwt is not None:
        request.COOKIES["jwt"] = jwt
    if headers:
        for key, value in headers.items():
            request.META[key] = value
    kwargs = {"path": path, "fname": fname}
    if album_id is not None:
        kwargs["album_id"] = album_id
    return view_class.as_view()(request, **kwargs)


def _unified(path, fname, **kwargs):
    return _call(UnifiedMediaAccessView, path, fname, **kwargs)


# Download archives are named ``<uuid><user id>.zip``; the route takes the UUID.
ZIP_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e"


# Download archives are named ``<uuid><user id>.zip``; the route takes the UUID.
ZIP_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e"


class UnifiedZipAndAvatarTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_zip_without_token_is_marked_403(self):
        response = _unified("zip", "job-1")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_zip_with_broken_token_is_403(self):
        response = _unified("zip", "job-1", jwt="not-a-token")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_zip_redirect_appends_user_id_and_extension(self):
        response = _unified("zip", ZIP_UUID, user=self.user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/x-zip-compressed")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/zip/{ZIP_UUID}{self.user.id}.zip",
        )

    def test_zip_fname_that_is_not_a_uuid_is_404(self):
        # fname is only ever the download job's UUID. Anything else could name
        # a path outside MEDIA_ROOT/zip or, with extra digits, another user's
        # archive (``<uuid>1`` + user 2 == user 12's file).
        for fname in ("job-1", "..", r"..\secret", f"{ZIP_UUID}1"):
            with self.subTest(fname=fname):
                response = _unified("zip", fname, user=self.user)
                self.assertEqual(response.status_code, 404)

    @override_settings(SERVE_FRONTEND=True)
    def test_zip_direct_mode_404s_when_the_file_is_absent(self):
        response = _unified("zip", ZIP_UUID, user=self.user)
        self.assertEqual(response.status_code, 404)

    def test_avatar_without_token_is_marked_403(self):
        response = _unified("avatars", "face.png")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_avatar_redirect_is_png(self):
        response = _unified("avatars", "face.png", user=self.user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(
            response["X-Accel-Redirect"], "/protected_media/avatars/face.png"
        )

    @override_settings(SERVE_FRONTEND=True)
    def test_avatar_direct_mode_404s_when_the_file_is_absent(self):
        response = _unified("avatars", "face.png", user=self.user)
        self.assertEqual(response.status_code, 404)

    def test_path_matching_is_case_insensitive(self):
        response = _unified("ZIP", ZIP_UUID, user=self.user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/x-zip-compressed")


class UnifiedEmbeddedMediaTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.other = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        embedded_path = f"/tmp/{self.photo.image_hash}-embedded.mp4"
        with open(embedded_path, "wb+") as handle:
            handle.write(ONE_PIXEL_PNG + b"embedded")
        self.embedded = File.create(embedded_path, self.owner)
        self.photo.main_file.embedded_media.add(self.embedded)

    def test_owner_gets_the_embedded_file(self):
        response = _unified("embedded_media", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertEqual(
            response["X-Accel-Redirect"],
            "/protected_media/embedded_media/" + os.path.basename(self.embedded.path),
        )

    def test_uuid_addressing_also_resolves(self):
        response = _unified("embedded_media", str(self.photo.pk), user=self.owner)
        self.assertEqual(response.status_code, 200)

    def test_other_user_gets_404(self):
        response = _unified("embedded_media", self.photo.image_hash, user=self.other)
        self.assertEqual(response.status_code, 404)

    def test_anonymous_gets_404_for_a_private_photo(self):
        response = _unified("embedded_media", self.photo.image_hash)
        self.assertEqual(response.status_code, 404)

    def test_photo_without_embedded_media_is_404(self):
        lonely = create_test_photo(owner=self.owner)
        response = _unified("embedded_media", lonely.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 404)


class UnifiedPublicAlbumIdTest(TestCase):
    """The ``album_id`` branch -- reachable only by calling the view directly."""

    def setUp(self):
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.album = AlbumUser.objects.create(title="Trip", owner=self.owner)
        self.album.photos.add(self.photo)
        self.share = AlbumUserShare.objects.create(album=self.album, enabled=True)

    def test_thumbnail_from_a_shared_album_is_served_anonymously(self):
        response = _unified(
            "thumbnails_big",
            self.photo.image_hash,
            album_id=self.album.id,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/thumbnails_big/{self.photo.image_hash}.webp",
        )

    def test_original_from_a_shared_album_is_served_anonymously(self):
        response = _unified("photos", self.photo.image_hash, album_id=self.album.id)
        self.assertEqual(response.status_code, 200)
        # Not a video, so the content type is forced to webp.
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertTrue(response["X-Accel-Redirect"])
        self.assertNotIn("Content-Disposition", response)

    def test_disabled_share_is_404(self):
        self.share.enabled = False
        self.share.save()
        response = _unified(
            "thumbnails_big", self.photo.image_hash, album_id=self.album.id
        )
        self.assertEqual(response.status_code, 404)

    def test_unknown_album_is_404(self):
        response = _unified("thumbnails_big", self.photo.image_hash, album_id=999999)
        self.assertEqual(response.status_code, 404)

    def test_photo_outside_the_album_is_404(self):
        outsider = create_test_photo(owner=self.owner)
        response = _unified(
            "thumbnails_big", outsider.image_hash, album_id=self.album.id
        )
        self.assertEqual(response.status_code, 404)


class UnifiedThumbnailAccessTest(TestCase):
    """``path != "photos"``: thumbnails, faces and their permission gate."""

    def setUp(self):
        self.owner = create_test_user()
        self.friend = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)

    def test_owner_gets_the_stored_thumbnail_name(self):
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/thumbnails_big/{self.photo.image_hash}.webp",
        )

    def test_uuid_addressed_request_still_resolves_the_hashed_filename(self):
        response = _unified("thumbnails_big", str(self.photo.pk), user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/thumbnails_big/{self.photo.image_hash}.webp",
        )

    def test_square_thumbnail_of_a_video_is_served_as_mp4(self):
        video = create_test_photo(owner=self.owner, video=True)
        response = _unified("square_thumbnails", video.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/square_thumbnails/{video.image_hash}.mp4",
        )

    def test_small_square_thumbnail_uses_its_own_field(self):
        response = _unified(
            "square_thumbnails_small", self.photo.image_hash, user=self.owner
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/square_thumbnails_small/{self.photo.image_hash}.webp",
        )

    def test_faces_path_is_served_verbatim_as_jpg(self):
        response = _unified("faces", f"{self.photo.image_hash}_1.jpg", user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/jpg")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/faces/{self.photo.image_hash}_1.jpg",
        )

    def test_missing_thumbnail_row_falls_back_to_the_requested_name(self):
        self.photo.thumbnail.delete()
        self.photo.refresh_from_db()
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/thumbnails_big/{self.photo.image_hash}.webp",
        )

    def test_anonymous_request_for_a_private_photo_is_403_with_marker(self):
        response = _unified("thumbnails_big", self.photo.image_hash)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_invalid_token_is_403_with_marker(self):
        response = _unified("thumbnails_big", self.photo.image_hash, jwt="garbage")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_authenticated_stranger_is_404(self):
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.stranger)
        self.assertEqual(response.status_code, 404)

    def test_unknown_hash_is_404(self):
        response = _unified("thumbnails_big", "0" * 32, user=self.owner)
        self.assertEqual(response.status_code, 404)

    def test_unknown_uuid_is_404(self):
        response = _unified(
            "thumbnails_big", "11111111-2222-3333-4444-555555555555", user=self.owner
        )
        self.assertEqual(response.status_code, 404)

    def test_direct_share_recipient_is_allowed(self):
        self.photo.shared_to.add(self.friend)
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.friend)
        self.assertEqual(response.status_code, 200)

    def test_public_album_wins_over_a_missing_token(self):
        album = AlbumUser.objects.create(title="Open", owner=self.owner)
        album.photos.add(self.photo)
        AlbumUserShare.objects.create(album=album, enabled=True)
        response = _unified("thumbnails_big", self.photo.image_hash)
        self.assertEqual(response.status_code, 200)

    def test_public_photo_is_served_anonymously(self):
        """#2029: the lightbox "Make public and copy link" link must open.

        The link points at the derived-media route, which previously consulted
        only album shares, so ``Photo.public`` had no effect and a logged-out
        visitor got 403.
        """
        self.photo.public = True
        self.photo.save(update_fields=["public"])
        response = _unified("thumbnails_big", self.photo.image_hash)
        self.assertEqual(response.status_code, 200)

    def test_non_public_photo_still_403s_anonymously(self):
        self.assertFalse(self.photo.public)
        response = _unified("thumbnails_big", self.photo.image_hash)
        self.assertEqual(response.status_code, 403)

    def test_public_photo_that_left_the_timeline_is_not_served(self):
        """Hiding, trashing or removing a photo does not clear ``public``.

        The anonymous API stops listing such a photo, so its media must stop
        answering too, rather than living on behind the flag.
        """
        for flag in ("hidden", "in_trashcan", "removed"):
            with self.subTest(flag=flag):
                photo = create_test_photo(owner=self.owner, public=True)
                setattr(photo, flag, True)
                photo.save(update_fields=[flag])
                response = _unified("thumbnails_big", photo.image_hash)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response["X-Media-Error"], "authentication")

    def test_public_photo_grants_what_a_public_album_share_grants(self):
        """Path for path, ``public`` is worth exactly an album share.

        Covers the paths that reach past the thumbnail branch: the legacy
        ``video`` path, which serves the original video file, and face crops.
        """
        public_video = create_test_photo(owner=self.owner, video=True, public=True)
        album_video = create_test_photo(owner=self.owner, video=True)
        album = AlbumUser.objects.create(title="Open", owner=self.owner)
        album.photos.add(album_video)
        AlbumUserShare.objects.create(album=album, enabled=True)

        for path, suffix in (("video", ""), ("faces", "_1.jpg")):
            with self.subTest(path=path):
                via_public = _unified(path, public_video.image_hash + suffix)
                via_album = _unified(path, album_video.image_hash + suffix)
                self.assertEqual(via_album.status_code, 200)
                self.assertEqual(via_public.status_code, 200)
                self.assertEqual(via_public["Content-Type"], via_album["Content-Type"])
                self.assertEqual(
                    via_public["X-Accel-Redirect"],
                    via_album["X-Accel-Redirect"].replace(
                        album_video.image_hash, public_video.image_hash
                    ),
                )

    def test_duplicate_hash_resolves_in_favour_of_the_public_row(self):
        """An anonymous visitor must land on the public twin, not a private one.

        ``Photo`` has no default ordering, so each row takes a turn at being
        the public one to keep the result from depending on which comes first.
        """
        twin = create_test_photo(owner=self.friend)
        twin.image_hash = self.photo.image_hash
        twin.save(update_fields=["image_hash"])
        for public, private in ((self.photo, twin), (twin, self.photo)):
            with self.subTest(public_owner=public.owner.username):
                public.public, private.public = True, False
                public.save(update_fields=["public"])
                private.save(update_fields=["public"])
                response = _unified("thumbnails_big", self.photo.image_hash)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response["X-Accel-Redirect"],
                    "/protected_media/" + public.thumbnail.thumbnail_big.name,
                )

    def test_duplicate_hash_resolves_in_favour_of_the_owner(self):
        twin = create_test_photo(owner=self.friend)
        twin_thumb = os.path.basename(twin.thumbnail.thumbnail_big.name)
        twin.image_hash = self.photo.image_hash
        twin.save()
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.friend)
        self.assertEqual(response.status_code, 200)
        # The stored thumbnail name still carries the twin's original hash --
        # the file on disk is what the Thumbnail row says, not what was asked for.
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/thumbnails_big/{twin_thumb}",
        )

    @override_settings(SERVE_FRONTEND=True)
    def test_direct_mode_404s_when_the_thumbnail_file_is_missing(self):
        response = _unified("thumbnails_big", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 404)


class UnifiedOriginalPhotoTest(TestCase):
    """``path == "photos"``: the untouched original."""

    def setUp(self):
        self.owner = create_test_user()
        self.friend = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)

    def test_owner_gets_an_inline_content_disposition(self):
        response = _unified("photos", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertIn("inline;", response["Content-Disposition"])
        self.assertIn(
            os.path.basename(self.photo.main_file.path),
            response["Content-Disposition"],
        )

    def test_direct_share_recipient_gets_it_inline_too(self):
        self.photo.shared_to.add(self.friend)
        response = _unified("photos", self.photo.image_hash, user=self.friend)
        self.assertEqual(response.status_code, 200)
        self.assertIn("Content-Disposition", response)

    def test_album_share_recipient_gets_it_without_content_disposition(self):
        album = AlbumUser.objects.create(title="Shared", owner=self.owner)
        album.photos.add(self.photo)
        album.shared_to.add(self.friend)
        response = _unified("photos", self.photo.image_hash, user=self.friend)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Content-Disposition", response)

    def test_public_album_serves_anonymously_without_content_disposition(self):
        album = AlbumUser.objects.create(title="Open", owner=self.owner)
        album.photos.add(self.photo)
        AlbumUserShare.objects.create(album=album, enabled=True)
        response = _unified("photos", self.photo.image_hash)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Content-Disposition", response)

    def test_public_photo_serves_anonymously_like_a_public_album(self):
        """The lightbox plays a video from here, so a public one must answer."""
        self.photo.public = True
        self.photo.save(update_fields=["public"])
        response = _unified("photos", self.photo.image_hash)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Content-Disposition", response)

    def test_public_photo_in_the_trash_is_not_served(self):
        self.photo.public = True
        self.photo.in_trashcan = True
        self.photo.save(update_fields=["public", "in_trashcan"])
        response = _unified("photos", self.photo.image_hash)
        self.assertEqual(response.status_code, 403)

    def test_owner_of_a_public_photo_still_gets_it_inline(self):
        self.photo.public = True
        self.photo.save(update_fields=["public"])
        response = _unified("photos", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertIn("inline;", response["Content-Disposition"])

    def test_anonymous_request_for_a_private_original_is_403_with_marker(self):
        response = _unified("photos", self.photo.image_hash)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_authenticated_stranger_is_404(self):
        response = _unified("photos", self.photo.image_hash, user=self.stranger)
        self.assertEqual(response.status_code, 404)

    def test_unknown_hash_is_404(self):
        response = _unified("photos", "0" * 32, user=self.owner)
        self.assertEqual(response.status_code, 404)

    def test_uuid_is_not_accepted_for_originals(self):
        """Unlike the thumbnail branch, ``photos`` only looks up ``image_hash``."""
        response = _unified("photos", str(self.photo.pk), user=self.owner)
        self.assertEqual(response.status_code, 404)

    def test_duplicate_hash_serves_each_owner_their_own_file(self):
        twin = create_test_photo(owner=self.friend)
        twin.image_hash = self.photo.image_hash
        twin.save()
        for user, photo in ((self.owner, self.photo), (self.friend, twin)):
            with self.subTest(user=user.username):
                response = _unified("photos", photo.image_hash, user=user)
                self.assertEqual(response.status_code, 200)
                self.assertIn(
                    os.path.basename(photo.main_file.path),
                    response["X-Accel-Redirect"],
                )

    @override_settings(SERVE_FRONTEND=True)
    def test_direct_mode_streams_the_original_from_disk(self):
        response = _unified("photos", self.photo.image_hash, user=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("X-Accel-Redirect", response)


class UnifiedTranscodeBranchTest(TestCase):
    """A video plus ``transcode_videos`` goes through the cache/ffmpeg path."""

    def setUp(self):
        self.owner = create_test_user(transcode_videos=True)
        self.video = create_test_photo(owner=self.owner, video=True)

    def test_cached_transcode_inside_media_root_is_redirected(self):
        from unittest import mock

        from django.conf import settings

        cached = os.path.join(settings.MEDIA_ROOT, "transcoded", "clip.mp4")

        with mock.patch(
            "api.transcode_cache.cached_path", return_value=cached
        ) as cached_path:
            response = _unified("photos", self.video.image_hash, user=self.owner)
        cached_path.assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertEqual(
            response["X-Accel-Redirect"], "/protected_media/transcoded/clip.mp4"
        )

    def test_uncached_transcode_streams_and_is_not_cacheable(self):
        from unittest import mock

        with (
            mock.patch("api.transcode_cache.cached_path", return_value=None),
            mock.patch("api.views.media.VideoTranscoder") as transcoder,
            mock.patch("api.views.media.gen", return_value=iter([b"abc"])),
            mock.patch("api.transcode_cache.ensure_cached") as ensure_cached,
        ):
            response = _unified("photos", self.video.image_hash, user=self.owner)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "video/mp4")
            self.assertEqual(response["Cache-Control"], "no-store")
            self.assertEqual(b"".join(response.streaming_content), b"abc")
        transcoder.assert_called_once()
        # The cached copy is written only after the live stream is exhausted.
        ensure_cached.assert_called_once_with(self.video)

    def test_public_album_video_is_never_transcoded(self):
        from unittest import mock

        album = AlbumUser.objects.create(title="Open", owner=self.owner)
        album.photos.add(self.video)
        AlbumUserShare.objects.create(album=album, enabled=True)
        with mock.patch("api.transcode_cache.cached_path") as cached_path:
            response = _unified("photos", self.video.image_hash, user=self.owner)
        cached_path.assert_not_called()
        self.assertEqual(response.status_code, 200)

    def test_owner_of_a_public_video_keeps_transcoding(self):
        """Making a video public must not cost its owner their own setting."""
        from unittest import mock

        from django.conf import settings

        self.video.public = True
        self.video.save(update_fields=["public"])
        cached = os.path.join(settings.MEDIA_ROOT, "transcoded", "clip.mp4")
        with mock.patch(
            "api.transcode_cache.cached_path", return_value=cached
        ) as cached_path:
            response = _unified("photos", self.video.image_hash, user=self.owner)
        cached_path.assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"], "/protected_media/transcoded/clip.mp4"
        )

    def test_anonymous_viewer_of_a_public_video_gets_the_original(self):
        from unittest import mock

        self.video.public = True
        self.video.save(update_fields=["public"])
        with mock.patch("api.transcode_cache.cached_path") as cached_path:
            response = _unified("photos", self.video.image_hash)
        cached_path.assert_not_called()
        self.assertEqual(response.status_code, 200)
