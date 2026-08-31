"""Characterization tests for ``UnifiedMediaAccessView`` direct-serving path.

Pins the CURRENT observed behavior of

* ``UnifiedMediaAccessView._serve_file_direct``  (open + range + error mapping)
* ``UnifiedMediaAccessView._generate_response_direct`` (which file gets served
  for a given ``path``/``fname``/photo shape when SERVE_FRONTEND is on)

before either is refactored.  No database, no network, no ML models: the view's
private helpers are called directly on a bare instance with stub photo objects,
and ``magic`` is patched wherever content-type sniffing would otherwise touch a
real libmagic database.
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

from django.http import HttpResponse
from django.test import SimpleTestCase, override_settings

from api.views.views import UnifiedMediaAccessView

VIEWS = "api.views.views"


class FakeField:
    """Stand-in for a ``FieldFile``.

    Real ``FieldFile`` is falsy when ``name`` is empty -- ``_thumbnail_field_for``
    relies on that -- and raises on ``.path`` when unpopulated.
    """

    def __init__(self, name, root=""):
        self.name = name
        self._root = root

    def __bool__(self):
        return bool(self.name)

    @property
    def path(self):
        if not self.name:
            raise ValueError("no file associated with field")
        return os.path.join(self._root, self.name) if self._root else self.name


class FakeThumbnail:
    def __init__(self, big=None, square=None, small=None, root=""):
        self.thumbnail_big = FakeField(big or "", root)
        self.square_thumbnail = FakeField(square or "", root)
        self.square_thumbnail_small = FakeField(small or "", root)


class FakePhoto:
    def __init__(self, thumbnail=None, video=False, main_file_path="/main/file.mp4"):
        if thumbnail is not None:
            self.thumbnail = thumbnail
        self.video = video
        self.main_file = MagicMock()
        self.main_file.path = main_file_path


def make_view(request=None):
    view = UnifiedMediaAccessView()
    if request is not None:
        view.request = request
    return view


def fake_request(range_header=None):
    request = MagicMock()
    request.headers = {} if range_header is None else {"Range": range_header}
    return request


class ServeFileDirectTest(SimpleTestCase):
    """``_serve_file_direct``: existence, sniffing, ranges, error mapping."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "sample.bin")
        with open(self.path, "wb") as handle:
            handle.write(b"0123456789")

    # -- existence -----------------------------------------------------
    def test_missing_file_returns_404_without_opening(self):
        view = make_view()
        response = view._serve_file_direct(os.path.join(self.tmp.name, "nope.bin"))
        self.assertEqual(response.status_code, 404)

    # -- happy path ----------------------------------------------------
    def test_explicit_content_type_is_used_and_ranges_advertised(self):
        view = make_view()
        response = view._serve_file_direct(self.path, "image/webp")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertEqual(b"".join(response.streaming_content), b"0123456789")

    def test_no_content_type_sniffs_with_magic(self):
        view = make_view()
        with patch(f"{VIEWS}.magic.Magic") as magic_cls:
            magic_cls.return_value.from_file.return_value = "image/png"
            response = view._serve_file_direct(self.path)
        self.assertEqual(response["Content-Type"], "image/png")
        response.close()

    def test_magic_failure_falls_back_to_octet_stream(self):
        view = make_view()
        with patch(f"{VIEWS}.magic.Magic", side_effect=Exception("no libmagic")):
            response = view._serve_file_direct(self.path)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        response.close()

    # -- ranges --------------------------------------------------------
    def test_no_request_attribute_means_no_range_handling(self):
        # The view is instantiated bare here (no .request), which is the shape
        # the class is in when nothing set it -- current code tolerates it.
        view = make_view()
        response = view._serve_file_direct(self.path, "text/plain")
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_request_without_range_header_serves_whole_file(self):
        view = make_view(fake_request())
        response = view._serve_file_direct(self.path, "text/plain")
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_range_header_yields_206_partial_content(self):
        view = make_view(fake_request("bytes=2-5"))
        response = view._serve_file_direct(self.path, "video/mp4")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Content-Range"], "bytes 2-5/10")
        self.assertEqual(response["Content-Length"], "4")
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertEqual(b"".join(response.streaming_content), b"2345")

    def test_unsatisfiable_range_yields_416(self):
        view = make_view(fake_request("bytes=100-200"))
        response = view._serve_file_direct(self.path, "video/mp4")
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response["Content-Range"], "bytes */10")

    # -- error mapping -------------------------------------------------
    def test_permission_error_is_403_not_404(self):
        view = make_view()
        with patch(f"{VIEWS}.open", side_effect=PermissionError, create=True):
            response = view._serve_file_direct(self.path, "image/jpg")
        self.assertEqual(response.status_code, 403)

    def test_file_vanishing_between_stat_and_open_is_404(self):
        view = make_view()
        with patch(f"{VIEWS}.open", side_effect=FileNotFoundError, create=True):
            response = view._serve_file_direct(self.path, "image/jpg")
        self.assertEqual(response.status_code, 404)

    def test_unexpected_error_is_500(self):
        view = make_view()
        with patch(f"{VIEWS}.open", side_effect=OSError("disk on fire"), create=True):
            response = view._serve_file_direct(self.path, "image/jpg")
        self.assertEqual(response.status_code, 500)


class GenerateResponseDirectDispatchTest(SimpleTestCase):
    """``_generate_response_direct``: which file is handed to the server.

    ``_serve_file_direct`` is stubbed so each test pins the *decision*, not the
    byte-serving that ``ServeFileDirectTest`` already covers.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.media_root = self.tmp.name
        self.view = make_view()
        self.served = MagicMock(return_value=HttpResponse(b"served"))
        self.view._serve_file_direct = self.served
        overrider = override_settings(MEDIA_ROOT=self.media_root)
        overrider.enable()
        self.addCleanup(overrider.disable)

    def touch(self, *parts):
        full = os.path.join(self.media_root, *parts)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as handle:
            handle.write(b"x")
        return full

    def call(self, photo, path, fname, transcode_videos=False):
        return self.view._generate_response_direct(photo, path, fname, transcode_videos)

    def served_with(self):
        self.assertTrue(self.served.called, "_serve_file_direct was not called")
        return self.served.call_args[0]

    # -- thumbnail branch, model-resolved ------------------------------
    def test_webp_thumbnail_from_model_is_served_as_webp(self):
        stored = self.touch("square_thumbnails", "abc.webp")
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                square="square_thumbnails/abc.webp", root=self.media_root
            )
        )
        self.call(photo, "square_thumbnails", "some-uuid")
        args = self.served_with()
        self.assertEqual(os.path.normpath(args[0]), os.path.normpath(stored))
        self.assertEqual(args[1], "image/webp")

    def test_mp4_thumbnail_from_model_is_served_as_video(self):
        stored = self.touch("square_thumbnails", "abc.mp4")
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                square="square_thumbnails/abc.mp4", root=self.media_root
            ),
            video=True,
        )
        self.call(photo, "square_thumbnails", "some-uuid")
        args = self.served_with()
        self.assertEqual(os.path.normpath(args[0]), os.path.normpath(stored))
        self.assertEqual(args[1], "video/mp4")

    def test_legacy_jpg_thumbnail_is_redirected_to_the_big_variant(self):
        # The small/square jpg variants are unusable on legacy installs: the
        # big jpg is served for any jpg thumbnail request, and it is NOT
        # required to exist on disk for this decision to be taken.
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                big="thumbnails_big/abc.jpg",
                square="square_thumbnails/abc.jpg",
                root=self.media_root,
            )
        )
        self.call(photo, "square_thumbnails", "some-uuid")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "thumbnails_big/abc.jpg"), "image/jpg"),
        )

    def test_legacy_jpg_without_big_variant_serves_the_requested_field(self):
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                big="", square="square_thumbnails/abc.jpg", root=self.media_root
            )
        )
        self.call(photo, "square_thumbnails", "some-uuid")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "square_thumbnails/abc.jpg"), "image/jpg"),
        )

    def test_model_thumbnail_missing_on_disk_falls_through_to_request_name(self):
        # thumb.name is set but nothing was written -- current code does NOT
        # serve it, it drops through to the request-derived lookup.
        self.touch("square_thumbnails", "requested.webp")
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                square="square_thumbnails/gone.webp", root=self.media_root
            )
        )
        self.call(photo, "square_thumbnails", "requested.webp")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "square_thumbnails", "requested.webp"),),
        )

    # -- thumbnail branch, request-derived fallbacks --------------------
    def test_no_thumbnail_row_and_missing_file_tries_webp_suffix(self):
        webp = self.touch("square_thumbnails", "abc.webp")
        photo = FakePhoto()  # no .thumbnail attribute at all
        self.call(photo, "square_thumbnails", "abc")
        self.assertEqual(self.served_with(), (webp, "image/webp"))

    def test_no_thumbnail_row_and_missing_file_tries_mp4_suffix(self):
        mp4 = self.touch("square_thumbnails", "abc.mp4")
        photo = FakePhoto(video=True)
        self.call(photo, "square_thumbnails", "abc")
        self.assertEqual(self.served_with(), (mp4, "video/mp4"))

    def test_existing_request_derived_file_is_served_without_content_type(self):
        # The final fallback passes no content type -- the sniffer decides.
        exact = self.touch("square_thumbnails", "abc.webp")
        photo = FakePhoto()
        self.call(photo, "square_thumbnails", "abc.webp")
        self.assertEqual(self.served_with(), (exact,))

    def test_nothing_found_still_calls_serve_which_404s(self):
        photo = FakePhoto()
        self.call(photo, "square_thumbnails", "missing")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "square_thumbnails", "missing"),),
        )

    def test_square_jpg_fallback_when_requested_thumbnail_field_is_empty(self):
        # thumbnails_big request, big field empty -> thumb is None, request
        # file absent, but square_thumbnail is a legacy jpg: serve the big jpg
        # path derived from the model (empty here, so the square jpg itself).
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                big="", square="square_thumbnails/abc.jpg", root=self.media_root
            )
        )
        self.call(photo, "thumbnails_big", "abc")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "square_thumbnails/abc.jpg"), "image/jpg"),
        )

    # -- faces branch ---------------------------------------------------
    def test_faces_path_is_served_as_jpg_from_media_root(self):
        photo = FakePhoto()
        self.call(photo, "faces", "face-1.jpg")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "faces", "face-1.jpg"), "image/jpg"),
        )

    # -- video branch ---------------------------------------------------
    def test_video_without_transcode_serves_the_original_main_file(self):
        photo = FakePhoto(video=True, main_file_path="/library/clip.mov")
        self.call(photo, "photos", "clip.mov", transcode_videos=False)
        self.assertEqual(self.served_with(), ("/library/clip.mov",))

    def test_video_with_transcode_delegates_to_transcoder_with_proxy_off(self):
        photo = FakePhoto(video=True)
        with patch.object(
            UnifiedMediaAccessView, "_transcoded_video_response"
        ) as transcoded:
            transcoded.return_value = HttpResponse(b"stream")
            response = self.call(photo, "photos", "clip.mov", transcode_videos=True)
        transcoded.assert_called_once_with(photo, use_proxy=False)
        self.assertEqual(response.content, b"stream")
        self.served.assert_not_called()

    # -- default image branch -------------------------------------------
    def test_plain_image_request_is_served_as_jpg_from_media_root(self):
        photo = FakePhoto(video=False)
        self.call(photo, "photos", "abc.jpg")
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "photos", "abc.jpg"), "image/jpg"),
        )

    def test_transcode_flag_is_ignored_for_non_videos(self):
        photo = FakePhoto(video=False)
        self.call(photo, "photos", "abc.jpg", transcode_videos=True)
        self.assertEqual(
            self.served_with(),
            (os.path.join(self.media_root, "photos", "abc.jpg"), "image/jpg"),
        )


class GenerateResponseDirectEndToEndTest(SimpleTestCase):
    """A couple of unstubbed passes, so the two helpers are pinned together."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        overrider = override_settings(MEDIA_ROOT=self.tmp.name)
        overrider.enable()
        self.addCleanup(overrider.disable)

    def test_existing_webp_thumbnail_is_returned_with_bytes(self):
        target = os.path.join(self.tmp.name, "square_thumbnails", "abc.webp")
        os.makedirs(os.path.dirname(target))
        with open(target, "wb") as handle:
            handle.write(b"WEBPDATA")
        photo = FakePhoto(
            thumbnail=FakeThumbnail(
                square="square_thumbnails/abc.webp", root=self.tmp.name
            )
        )
        view = make_view(fake_request())
        response = view._generate_response_direct(
            photo, "square_thumbnails", "x", False
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertEqual(b"".join(response.streaming_content), b"WEBPDATA")

    def test_missing_everything_ends_in_a_404(self):
        photo = FakePhoto()
        view = make_view(fake_request())
        response = view._generate_response_direct(photo, "faces", "nope.jpg", False)
        self.assertEqual(response.status_code, 404)
