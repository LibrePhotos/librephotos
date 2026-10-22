"""Serving media files (``/media/...``): originals, thumbnails, faces, zips,
avatars and embedded media, plus the live video transcoder behind them."""

import collections
import logging
import os
import re
import threading
import time
from collections.abc import Iterator
from urllib.parse import quote

from django.conf import settings
from django.db.models import Q, QuerySet
from django.db.models.fields.files import FieldFile
from django.http import (
    HttpResponse,
    HttpResponseBase,
    HttpResponseForbidden,
    StreamingHttpResponse,
)
from django.utils import timezone
from django.utils.encoding import iri_to_uri
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.views import APIView

from api.accounts.authentication import (
    JWTCookieAuthentication,
    ThrottledBasicAuthentication,
)
from api.drf.params import parse_query
from api.mime import mime_type, still_content_type
from api.models import AlbumUser, Photo
from api.models.photo import HEAVY_PHOTO_COLUMNS
from api.models.thumbnail import ANIMATED_THUMBNAIL_DIRS
from api.models.user import User
from api.photos.zip_downloads import zip_file_name
from api.runtime import binaries
from api.serializers.media import MediaQuery
from api.serving.http_range import file_size, ranged_response
from api.sharing.copies import COPIES_DIR, ensure_copy
from api.sharing.grants import LibraryGrant, library_grant
from api.video import color, ffmpeg_budget, transcode_cache
from api.video.no_metadata import NO_METADATA

logger = logging.getLogger(__name__)

# How far ahead of the viewer a rate-limited live conversion has to be before
# the seekable copy may start beside it (#2002). Playback runs at real time at
# most, so this much converted video is a minute nobody can have reached yet:
# room for the copy to take its (niced, capped) share without playback
# catching up. At the default -readrate 2 with a 30 s burst it is reached
# about 30 s in; a host too slow to get that far ahead never reaches it, and
# the copy waits for the end of the stream as before.
COPY_LEAD_SECONDS = 60.0

# A line of ffmpeg's -progress output: "key=value", the value at most padded
# in front ("speed= 2.6x"). Its error lines have spaces between words, so they
# stay apart from it.
_PROGRESS_LINE = re.compile(rb"[a-z0-9_]+= *\S*")


def _url_segment_traverses(*segments: str) -> bool:
    """Whether any ``/media/`` URL segment tries to leave its directory.

    ``fname`` is meant to be a bare filename and ``path`` a forward-slash
    subpath below ``MEDIA_ROOT``; neither ever legitimately contains a
    backslash or a ``..`` component. A backslash is a directory separator on
    Windows -- where ``os.path.join(MEDIA_ROOT, path, fname)`` and the Windows
    filesystem collapse ``abc_\\..\\..\\target`` lexically, straight out of
    ``MEDIA_ROOT`` -- and elsewhere only ever appears in an attack, so it is
    refused on every platform. This runs before the request is dispatched, so
    the check covers the ``X-Accel-Redirect`` URIs of proxy mode as much as the
    filesystem joins of direct mode.
    """
    for segment in segments:
        if "\\" in segment:
            return True
        # normpath would collapse the very ".." we mean to catch, so split raw.
        if any(part == ".." for part in segment.split("/")):
            return True
    return False


def _original_path(photo: Photo) -> str:
    """Filesystem path of the photo's original file.

    ``main_file`` is nullable. A photo whose original the scan has detached has
    no path, and no serving route ever asked for one, so this is an assertion
    rather than a branch: it fails exactly where the bare attribute access did.
    """
    assert photo.main_file is not None
    return photo.main_file.path


def _stored_name(field: FieldFile) -> str:
    """The name ``field`` was saved under.

    Only populated fields get here: an empty FileField is falsy and is turned
    away before it is used, and a truthy one always has a name.
    """
    assert field.name is not None
    return field.name


def _within_media_root(candidate: str) -> bool:
    """Whether ``candidate`` resolves to ``MEDIA_ROOT`` itself or below it.

    Belt to the suspenders of :func:`_url_segment_traverses`: the path is
    resolved (``..`` collapsed, symlinks followed) and required to stay inside
    the resolved ``MEDIA_ROOT``, so no direct-mode join can serve a file the
    resolved path places outside it -- including a caller reached without going
    through :meth:`UnifiedMediaAccessView.get`.
    """
    root = os.path.realpath(settings.MEDIA_ROOT)
    resolved = os.path.realpath(candidate)
    try:
        return os.path.commonpath([resolved, root]) == root
    except ValueError:
        # Raised when the two are on different drives (Windows): not inside.
        return False


def build_live_command(path: str, transfer: str | None = None) -> list[str]:
    """The conversion a viewer is waiting on, bounded so it cannot take the host.

    Unbounded, this is one person's playback against everybody else's: ffmpeg
    defaults to every core and to converting as fast as the machine allows,
    while a viewer needs only a little more than real time. See
    :mod:`api.video.ffmpeg_budget` for what the two limits below each bound, and why
    ``-threads`` has to appear on both sides of the input to mean anything.

    It is deliberately *not* niced -- unlike the cached copy, somebody is
    watching this one, so it should outrank the background work rather than
    yield to it.
    """
    threads = str(ffmpeg_budget.cpu_share(settings.TRANSCODE_LIVE_CPU_FRACTION))
    # -loglevel error is load-bearing, not tidiness. stderr is a pipe that
    # nothing in the request path ever reads, and ffmpeg's default progress
    # output is written on a wall-clock cadence, so a conversion long enough to
    # write ~64 KB of it fills the pipe buffer and blocks in write() forever --
    # mid-video, with the process still alive and the browser still waiting.
    # Rate limiting lengthens exactly that wall clock, which would have turned a
    # bug reachable only on long videos into one reachable on ordinary ones.
    command = [binaries.ffmpeg(), "-nostdin", "-loglevel", "error", "-threads", threads]

    # How far the conversion has got, as "key=value" lines on stderr, which
    # VideoTranscoder reads anyway: it decides when the seekable copy may
    # start (#2002). A few hundred bytes a second, and not a log message, so
    # -loglevel error above does not silence it.
    if ffmpeg_budget.supports("progress"):
        command += ["-progress", "pipe:2"]

    # -threads does not govern the filter pool, which defaults to one thread per
    # core: on a many-core host the scale filter alone can spawn as many threads
    # as the machine has, straight past the cap. Measured on a 4-core host,
    # 1080p -> 720p: 2.44 cores with -threads 2 alone, 2.38 with this as well.
    # A small saving here and a much larger one on a machine with more cores.
    # Probed like the others -- it long predates them, but an ffmpeg old enough
    # to lack it would exit rather than ignore it.
    if ffmpeg_budget.supports("filter_threads"):
        command += ["-filter_threads", threads]

    readrate = settings.TRANSCODE_LIVE_READRATE
    if readrate > 0 and ffmpeg_budget.supports("readrate"):
        command += ["-readrate", str(readrate)]
        burst = settings.TRANSCODE_LIVE_BURST_SECONDS
        if burst > 0 and ffmpeg_budget.supports("readrate_initial_burst"):
            command += ["-readrate_initial_burst", str(burst)]

    command += [
        "-i",
        path,
        # Again after the input: the first one capped the decoder, this caps the
        # encoder. Only one of the two and half the work stays uncapped.
        "-threads",
        threads,
        "-vcodec",
        "libx264",
        "-preset",
        "ultrafast",
        "-movflags",
        "frag_keyframe+empty_moov",
        # A playback copy needs none of the source's metadata, and the
        # recorded location must not reach a library recipient (#2731).
        *NO_METADATA,
    ]

    # A ceiling, not a target: plain "scale=-2:720" enlarges anything shorter
    # than 720 lines, and the phone clips that most often need converting are
    # exactly that. Upscaling costs bandwidth and CPU to add nothing a viewer
    # can see. An HDR source needs tonemapping after it, or the browser reads a
    # PQ curve as bt709 and shows it washed out; see :mod:`api.video.color`.
    command += color.h264_video_args(path, color.PLAYBACK_SCALE, transfer)

    return command + ["-f", "mp4", "-"]


class VideoTranscoder:
    """A live conversion, its output on stdout and its complaints drained.

    Nothing in the request path ever read stderr, and it was a pipe: ffmpeg
    writes progress there on a wall-clock cadence, so a conversion running long
    enough to produce about 64 KB of it filled the pipe buffer and blocked in
    write() forever, mid-video, with the process alive and the browser waiting.
    Progress arrives at about 315 bytes a second of wall clock, so 64 KB --
    a pipe's full capacity -- accumulates after roughly six minutes of
    conversion: a video of about sixteen minutes on a four-core host, less on a
    slower one, and less again once the conversion is rate limited. What
    decides it is how long the conversion runs, not the resolution or the
    layout of the file. Caught in the act on unmodified dev: stdout frozen at
    302.9 MB, the process alive with /proc/<pid>/syscall reading write() on fd
    2, and output resuming the moment the pipe was read.

    ``-loglevel error`` removes almost all of that output, but a file that
    decodes badly can still produce error lines without end, so the pipe is
    also drained -- into a small ring buffer, kept for the log if the
    conversion turns out to have failed. Today those lines are discarded
    unread, which is why a transcode that dies leaves nothing but a truncated
    video and no explanation.
    """

    # Enough to identify a failure, small enough that a file erroring on every
    # frame cannot grow it without bound.
    STDERR_TAIL_BYTES = 8192

    # None until the conversion has started. __init__ can raise before it is
    # set (ffmpeg cannot be started), and __del__ still runs on that instance.
    process: binaries.Process | None = None

    def __init__(self, path: str, transfer: str | None = None) -> None:
        command = build_live_command(path, transfer)
        # Written by the drain thread from ffmpeg's -progress lines, read by
        # copy_can_start in the request's thread.
        self.converted_seconds = 0.0
        self.converted_all = False
        self.rate_limited = "-readrate" in command
        self.started = time.monotonic()
        # No timeout: it runs as long as the video plays, and is killed when the
        # client goes away (__del__, once the response drops the generator).
        self.process = binaries.start_tool(
            command[0], command[1:], stdout=binaries.PIPE, stderr=binaries.PIPE
        )
        self._stderr_tail: collections.deque[int] = collections.deque(
            maxlen=self.STDERR_TAIL_BYTES
        )
        self._drain = threading.Thread(target=self._read_stderr, daemon=True)
        self._drain.start()

    def _read_stderr(self) -> None:
        """Keep what ffmpeg says, apart from its progress lines, which are read."""
        assert self.process is not None and self.process.stderr is not None
        read = self.process.stderr.read
        pending = b""
        # A buffered read waits until it has all it asked for, so a small one:
        # the -progress lines come at a few hundred bytes a second, and 4 KB
        # of them would be read eight seconds late.
        for chunk in iter(lambda: read(512), b""):
            *lines, pending = (pending + chunk).split(b"\n")
            for line in lines:
                if not self._read_progress(line.rstrip(b"\r")):
                    self._stderr_tail.extend(line + b"\n")
            # A line that never ends is kept like any other output, not held.
            if len(pending) > self.STDERR_TAIL_BYTES:
                self._stderr_tail.extend(pending)
                pending = b""
        self._stderr_tail.extend(pending)

    def _read_progress(self, line: bytes) -> bool:
        """Note a -progress line; False when ``line`` is not one."""
        if not _PROGRESS_LINE.fullmatch(line):
            return False
        key, _, value = line.partition(b"=")
        # out_time_ms is in microseconds too: older ffmpeg misnamed it.
        if key in (b"out_time_us", b"out_time_ms") and value.isdigit():
            self.converted_seconds = int(value) / 1_000_000
        elif key == b"progress" and value == b"end":
            self.converted_all = True
        return True

    def copy_can_start(self) -> bool:
        """Whether the seekable copy may now run beside this conversion (#2002).

        Once this one has converted everything it takes nothing more. Before
        that only while it is rate limited -- a conversion running flat out
        takes its whole share, and a second one beside it is the race #1991
        measured -- and COPY_LEAD_SECONDS ahead of anything the viewer can have
        reached.
        """
        if self.converted_all:
            return True
        if not self.rate_limited:
            return False
        watched = time.monotonic() - self.started
        return self.converted_seconds - watched >= COPY_LEAD_SECONDS

    def stderr_tail(self) -> str:
        """What ffmpeg last said, once there is no more of it coming.

        The drain thread is joined first: a deque is safe to extend from
        another thread but not to iterate while it is being extended, and
        process exit does not by itself mean the pipe has been read to the end.
        """
        self._drain.join(timeout=5)
        return bytes(self._stderr_tail).decode("utf-8", "replace").strip()

    def __del__(self) -> None:
        if self.process is not None:
            self.process.kill()


def gen(transcoder: VideoTranscoder) -> Iterator[bytes]:
    """Stream the conversion, and say so in the log if it ended badly.

    A failed transcode reaches the browser as a video that simply stops, so the
    only place the reason can land is here.
    """
    process = transcoder.process
    assert process is not None and process.stdout is not None  # set by __init__
    yield from iter(process.stdout.readline, b"")
    if process.wait() != 0:
        logger.warning(
            "live video transcode exited with %s: %s",
            process.returncode,
            transcoder.stderr_tail() or "no output on stderr",
        )


# What /media/ and a photo link's media route answer: the file, or behind the
# proxy an empty answer whose X-Accel-Redirect header has nginx send it.
MEDIA_FILE_RESPONSES = {
    (200, "*/*"): OpenApiResponse(
        OpenApiTypes.BINARY,
        description="The file with its own content type; behind the proxy, "
        "an empty body and an X-Accel-Redirect header",
    ),
    (206, "*/*"): OpenApiResponse(
        OpenApiTypes.BINARY, description="The byte range a Range header asked for"
    ),
}


class MediaServingView(APIView):
    """Response builders for ``/media/`` and for the public photo-link route.

    Subclasses bring their own ``get``, whose arguments come from their URL
    pattern, so the shared helpers live here rather than on a class whose
    ``get`` other routes would have to match.
    """

    permission_classes = (AllowAny,)
    # <img> and <video> requests carry the jwt cookie but no Authorization
    # header. A stale cookie makes the request anonymous rather than a 401, so
    # public photos and shared albums are still served (see
    # JWTCookieAuthentication).
    authentication_classes = (JWTCookieAuthentication, ThrottledBasicAuthentication)

    def _should_use_proxy(self) -> bool:
        return not getattr(settings, "SERVE_FRONTEND", False)

    def _forbidden_unauthenticated(self) -> HttpResponseForbidden:
        """403 because the caller has no usable session -- not because of the file.

        Both refusals reach the browser as a bare 403: this one, and the one
        nginx raises on its own when it cannot open an original it was handed
        via X-Accel-Redirect. They call for opposite responses -- sign in again
        versus fix the library permissions -- and a <video> element surfaces no
        body to tell them apart, so mark ours.
        """
        response = HttpResponseForbidden()
        response["X-Media-Error"] = "authentication"
        return response

    def _protected_media_url(self, path: str, fname: str) -> str:
        path = path.lstrip("/")
        return f"/protected_media/{path}/{fname}"

    def _file_content_type(self, file_path: str) -> str:
        try:
            return mime_type(file_path)
        except Exception:
            return "application/octet-stream"

    def _original_content_type(self, photo: Photo) -> str:
        """A video's type as it is; a still photo's real image type (#2742).

        Stills used to go out as ``image/webp`` whatever they were, which made
        a browser that opened the original guess, and told a client nothing.
        """
        path = _original_path(photo)
        if photo.video:
            return self._file_content_type(path)
        return still_content_type(path)

    def _safe_media_join(self, path: str, fname: str, suffix: str = "") -> str | None:
        """Join ``path``/``fname`` under ``MEDIA_ROOT``, or ``None`` if it escapes.

        The single choke point for every direct-mode join of URL-controlled
        segments onto ``MEDIA_ROOT``. ``get`` already refuses traversal before
        dispatch, but re-checking the resolved join here keeps any direct-mode
        helper (some are reachable on their own, e.g. from the shared-album and
        public-photo routes) from serving a file outside ``MEDIA_ROOT``.
        """
        if _url_segment_traverses(path, fname):
            return None
        candidate = os.path.join(settings.MEDIA_ROOT, path, fname + suffix)
        return candidate if _within_media_root(candidate) else None

    def _serve_file_direct(
        self, file_path: str, content_type: str | None = None
    ) -> HttpResponseBase:
        if not os.path.exists(file_path):
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        try:
            handle = open(file_path, "rb")
            content_type = content_type or self._file_content_type(file_path)
            # Ranges matter here and nowhere else in this class: behind the
            # bundled proxy the bytes never come from Django, but an install
            # serving media itself has to answer a seek on its own, and a video
            # served without ranges cannot be sought at all.
            request = getattr(self, "request", None)
            return ranged_response(
                handle,
                file_size(handle),
                request.headers.get("Range") if request is not None else None,
                content_type,
            )
        except FileNotFoundError:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        except PermissionError:
            # Not a 404: the file is right there and we were refused. Reporting
            # "not found" sends the administrator hunting for a missing file
            # while a permissions problem sits in plain sight, and it denies the
            # frontend the one signal it has for telling those two apart -- a
            # <video> element exposes no HTTP status, so the status code is the
            # whole diagnosis.
            return HttpResponse(status=status.HTTP_403_FORBIDDEN)
        except Exception:
            return HttpResponse(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _transcoded_video_response(
        self, photo: Photo, use_proxy: bool
    ) -> HttpResponseBase:
        """Hand out a playable mp4 for a video the browser cannot decode.

        Browsers cannot decode every container/codec we store, so those videos
        (and every video, with "Always transcode videos" on) are converted to
        something they can actually play.

        A conversion happening live cannot be sought -- its length is unknown
        until it ends, so there is no ``Content-Length``, no ``Accept-Ranges``
        and nothing a ``Range`` request can be answered with. The first play
        still streams like that, because it starts immediately; in the
        background the same conversion is written to a file, and every later
        play is served from that instead, as an ordinary seekable mp4. See
        :mod:`api.video.transcode_cache` for what keeps it from filling the disk.
        """
        cached = transcode_cache.cached_path(photo)
        if cached:
            served_by_proxy = use_proxy and cached.startswith(
                os.path.join(settings.MEDIA_ROOT, "")
            )
            if served_by_proxy:
                response: HttpResponseBase = HttpResponse()
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    os.path.dirname(os.path.relpath(cached, settings.MEDIA_ROOT)),
                    os.path.basename(cached),
                )
                return response
            return self._serve_file_direct(cached, "video/mp4")

        # The lightbox sends a HEAD to learn why a video failed, and only the
        # status matters to it. Django answers HEAD by running the GET and
        # dropping the body, which here would mean a whole live conversion,
        # and then the cached copy, for a reply that is always 200.
        if getattr(self, "request", None) is not None and self.request.method == "HEAD":
            response = HttpResponse(content_type="video/mp4")
            response["Cache-Control"] = "no-store"
            return response

        response = StreamingHttpResponse(
            self._cache_after_streaming(
                VideoTranscoder(_original_path(photo), photo.video_color_transfer),
                photo,
            ),
            content_type="video/mp4",
        )
        # The live stream and the cached file answer to the same URL, and this
        # one is the poorer of the two: a browser that kept it would keep
        # serving an unseekable video after a seekable one exists.
        response["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def _cache_after_streaming(
        transcoder: VideoTranscoder, photo: Photo
    ) -> Iterator[bytes]:
        """Stream the live conversion, and start writing the copy once it is safe.

        Not as the stream starts. The live conversion has to keep ahead of
        playback, and a second ffmpeg started next to it takes a share of the
        machine away from the one thing somebody is actually waiting for -- on
        a two-core server, half of it, which is enough to turn a video that
        used to start at once into one that looks stuck (#1991).

        Nor only when the stream closes, though: at -readrate 2 the live
        conversion takes half the video's length, and a viewer can hold the
        stream open for all of it, so a forty-minute video waited twenty
        before its copy began (#2002). The copy starts as soon as the live
        conversion is done or far enough ahead (``copy_can_start``), and
        otherwise when the generator is closed -- which happens whether the
        video ran to the end or the viewer left after five seconds.
        """
        asked = started = False
        try:
            for chunk in gen(transcoder):
                yield chunk
                if not asked and transcoder.copy_can_start():
                    # Asked once: ensure_cached lists the cache directory, and
                    # this runs for every chunk.
                    asked = True
                    started = transcode_cache.ensure_cached(photo)
        finally:
            if not started:
                transcode_cache.ensure_cached(photo)

    def _thumbnail_field_for(self, photo: Photo, path: str) -> FieldFile | None:
        """Return the ``FieldFile`` holding the thumbnail ``path`` asks for.

        The request filename cannot be turned into an on-disk name by string
        manipulation: ``api.thumbnails.render.generate_thumbnail`` always stores
        files as ``<image_hash>.<ext>``, while the frontend also addresses photos by
        their UUID (``AlbumCoverPickerModal``, the lightbox preloader), so a
        UUID request would otherwise be pointed at a file that does not exist.
        The model is the only reliable source of the stored name.

        Returns ``None`` when the photo has no ``Thumbnail`` row or the
        relevant field was never populated -- callers then fall back to the
        legacy request-derived name instead of raising.
        """
        thumbnail = photo.thumbnail if hasattr(photo, "thumbnail") else None
        if thumbnail is None:
            return None
        if "thumbnails_big" in path:
            field = thumbnail.thumbnail_big
        elif "square_thumbnails_small" in path:
            field = thumbnail.square_thumbnail_small
        else:
            field = thumbnail.square_thumbnail
        # An empty FileField raises ValueError on .path/.name access downstream.
        return field if field else None

    def _unrecorded_square_format(
        self, photo: Photo, path: str, fname: str
    ) -> tuple[str, str]:
        """Extension and content type of a square no ``Thumbnail`` row names.

        A video's square is an mp4 clip, or a WebP still when it was scanned
        with the animated previews off (#649): the file on disk tells which.
        """
        if photo.video:
            clip = self._safe_media_join(path, fname, ".mp4")
            if clip is not None and os.path.exists(clip):
                return ".mp4", "video/mp4"
        return ".webp", "image/webp"

    def _generate_response_proxy(
        self, photo: Photo, path: str, fname: str, transcode_videos: bool
    ) -> HttpResponseBase:
        if "thumbnail" in path:
            response = HttpResponse()
            thumb = self._thumbnail_field_for(photo, path)

            # thumbnails_big is a static image even for videos: .webp today,
            # .jpg on installs that predate the webp switch.
            if "thumbnails_big" in path:
                name = (
                    os.path.basename(_stored_name(thumb)) if thumb else fname + ".webp"
                )
                response["Content-Type"] = (
                    "image/jpeg" if "jpg" in os.path.splitext(name)[1] else "image/webp"
                )
                response["X-Accel-Redirect"] = self._protected_media_url(path, name)
                return response

            if thumb is None:
                # No Thumbnail row (or an unpopulated field): keep serving the
                # legacy request-derived name rather than 500ing on the
                # missing relation.
                ext, content_type = self._unrecorded_square_format(photo, path, fname)
                response["Content-Type"] = content_type
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, fname + ext
                )
                return response

            ext = os.path.splitext(_stored_name(thumb))[1]
            actual_name = os.path.basename(_stored_name(thumb))
            if "jpg" in ext:
                response["Content-Type"] = "image/jpg"
                big = self._thumbnail_field_for(photo, "thumbnails_big")
                response["X-Accel-Redirect"] = (big or thumb).path
            if "webp" in ext:
                response["Content-Type"] = "image/webp"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, actual_name
                )
            if "mp4" in ext:
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, actual_name
                )
            return response

        if "faces" in path:
            response = HttpResponse()
            response["Content-Type"] = "image/jpg"
            response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
            return response

        if photo.video:
            if transcode_videos:
                return self._transcoded_video_response(photo, use_proxy=True)
            response = HttpResponse()
            response["Content-Type"] = mime_type(_original_path(photo))
            response["X-Accel-Redirect"] = iri_to_uri(
                _original_path(photo).replace(settings.DATA_ROOT, "/original")
            )
            return response

        response = HttpResponse()
        response["Content-Type"] = "image/jpg"
        response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
        return response

    def _big_jpg_thumbnail_response(
        self, photo: Photo, fallback: FieldFile
    ) -> HttpResponseBase:
        """Serve the big jpg thumbnail, or ``fallback`` when it was never stored."""
        big = self._thumbnail_field_for(photo, "thumbnails_big")
        return self._serve_file_direct((big or fallback).path, "image/jpg")

    def _stored_thumbnail_response(
        self, photo: Photo, path: str
    ) -> HttpResponseBase | None:
        """Serve the thumbnail the model names, or ``None`` to fall back.

        Resolve from the model first: `fname` is the Photo UUID for
        UUID-addressed requests, and no thumbnail is ever stored under that
        name, so the request-derived lookup can only ever 404 for them.
        """
        thumb = self._thumbnail_field_for(photo, path)
        if thumb is None:
            return None
        ext = os.path.splitext(_stored_name(thumb))[1]
        if "jpg" in ext:
            # Legacy jpg thumbnails: only the big variant is usable.
            return self._big_jpg_thumbnail_response(photo, thumb)
        if os.path.exists(thumb.path):
            return self._serve_file_direct(
                thumb.path,
                "video/mp4" if "mp4" in ext else "image/webp",
            )
        return None

    def _suffixed_thumbnail_response(
        self, path: str, fname: str
    ) -> HttpResponseBase | None:
        """Serve ``fname`` with a thumbnail extension appended, if one is there."""
        for ext, content_type in ((".webp", "image/webp"), (".mp4", "video/mp4")):
            if fname.endswith(ext):
                continue
            candidate = self._safe_media_join(path, fname, ext)
            if candidate is not None and os.path.exists(candidate):
                return self._serve_file_direct(candidate, content_type)
        return None

    def _thumbnail_response_direct(
        self, photo: Photo, path: str, fname: str
    ) -> HttpResponseBase:
        response = self._stored_thumbnail_response(photo, path)
        if response is not None:
            return response

        file_path = self._safe_media_join(path, fname)
        if file_path is None:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            response = self._suffixed_thumbnail_response(path, fname)
            if response is not None:
                return response
        # Legacy jpg installs may never have populated the small/square
        # variants; fall back to the big jpg for any of them, as before.
        square = self._thumbnail_field_for(photo, "square_thumbnails")
        if square is not None and "jpg" in os.path.splitext(_stored_name(square))[1]:
            return self._big_jpg_thumbnail_response(photo, square)
        return self._serve_file_direct(file_path)

    def _generate_response_direct(
        self, photo: Photo, path: str, fname: str, transcode_videos: bool
    ) -> HttpResponseBase:
        if "thumbnail" in path:
            return self._thumbnail_response_direct(photo, path, fname)

        if "faces" in path:
            file_path = self._safe_media_join(path, fname)
            if file_path is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            return self._serve_file_direct(file_path, "image/jpg")

        if photo.video:
            if transcode_videos:
                return self._transcoded_video_response(photo, use_proxy=False)
            return self._serve_file_direct(_original_path(photo))

        file_path = self._safe_media_join(path, fname)
        if file_path is None:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        return self._serve_file_direct(file_path, "image/jpg")

    def _generate_response_original(
        self,
        photo: Photo,
        use_proxy: bool,
        transcode_videos: bool,
        inline: bool = False,
    ) -> HttpResponseBase:
        """Serve the untouched original file (path == "photos").

        Videos go through ffmpeg first when the requester enabled "Always
        transcode videos", exactly like the thumbnail/video paths do.
        """
        if photo.video and transcode_videos:
            return self._transcoded_video_response(photo, use_proxy=use_proxy)
        content_type = self._original_content_type(photo)

        if use_proxy:
            response = HttpResponse()
            response["Content-Type"] = content_type
            if _original_path(photo).startswith("/nextcloud_media/"):
                internal_path = "/nextcloud_original" + _original_path(photo)[21:]
            elif _original_path(photo).startswith(settings.PHOTOS):
                internal_path = (
                    "/original" + _original_path(photo)[len(settings.PHOTOS) :]
                )
            else:
                internal_path = quote(_original_path(photo))
            if inline:
                response["Content-Disposition"] = 'inline; filename="{}"'.format(
                    _original_path(photo).split("/")[-1]
                )
            response["X-Accel-Redirect"] = iri_to_uri(internal_path)
            return response
        return self._serve_file_direct(_original_path(photo), content_type)

    def _public_album_active_q(self) -> Q:
        return Q(share__enabled=True) & (
            Q(share__expires_at__isnull=True) | Q(share__expires_at__gte=timezone.now())
        )

    @staticmethod
    def _vouching_albums(photo: Photo) -> QuerySet[AlbumUser]:
        """Albums whose shares may grant access to ``photo``: its owner's only.

        A photo that sits in someone else's album (GHSA-phvg-g65q-rhq3) must
        not be served on the strength of that album's share.
        """
        return photo.albumuser_set.filter(
            owner_id=photo.owner_id  # owner-scope: same owner as the photo
        )

    def _in_public_album(self, photo: Photo) -> bool:
        """Whether an active public share of one of its owner's albums vouches."""
        return (
            self._vouching_albums(photo).filter(self._public_album_active_q()).exists()
        )

    @staticmethod
    def _is_public_photo(photo: Photo) -> bool:
        """Whether ``photo`` is public in the sense the photo API uses.

        ``Photo.public`` alone is not enough: nothing clears it when the photo
        is later hidden, trashed or removed. Asking the same queryset that
        answers anonymous API requests (``Photo.visible.visible_to(None)``)
        keeps the two in step, so a photo stops being served here exactly when
        it stops being listed there.

        What it grants mirrors a public album share, path for path: every
        derived path (thumbnails, face crops, the legacy ``video`` path) and
        the original under ``photos``, never transcoded and never inline. Face
        crops are pixel subsets of a photo that is already public, and the
        album-share routes serve them regardless of ``share_faces`` (that flag
        only hides the people list in the public album API). The original is
        what the lightbox plays a video from, so a public video would not play
        without it. A public photo therefore never grants more than the same
        photo in a publicly shared album would.
        """
        return Photo.visible.visible_to(None).filter(pk=photo.pk).exists()

    @staticmethod
    def _requester(request: Request) -> User | None:
        """The signed-in user, or None.

        None covers both "no credentials" and "credentials that no longer
        work" (an expired cookie, a deleted or deactivated account):
        ``JWTCookieAuthentication`` makes either one anonymous, and a request
        that is refused for want of a session is marked by
        ``_forbidden_unauthenticated``.
        """
        user = request.user
        if not isinstance(user, User):
            return None
        return user

    def _pick_visible_photo(
        self, photos: QuerySet[Photo], user: User | None
    ) -> Photo | None:
        """Choose which row a shared ``image_hash`` resolves to.

        ``Photo.image_hash`` is unique per user, but two users who scanned the
        same file before #1957 was fixed shared one: the second user's Photo
        took the first scanner's hash from the shared File row. Migration 0175
        gives those their owner's salt, except where that hash was taken
        already, so a few may remain. Falling back to an arbitrary row
        then denies an owner access to their own photo, so prefer a row the
        requester can actually see. Anyone, signed in or not, can see a row in a
        public album or a public photo, so either beats an arbitrary private
        twin that would 403.
        """
        candidates = list(photos)
        if not candidates:
            return None
        if user is not None:
            for p in candidates:
                if p.owner_id == user.id:
                    return p
            for p in candidates:
                if p.shared_to.filter(id=user.id).exists():
                    return p
        for p in candidates:
            if self._in_public_album(p) or self._is_public_photo(p):
                return p
        return candidates[0]

    def _may_access(self, photo: Photo, user: User | None) -> bool:
        """Whether `user` may fetch `photo`: owner, direct share, via album, or
        as a photo of a library shared with them (#2731)."""
        if user is None:
            return False
        if photo.owner_id == user.id or photo.shared_to.filter(id=user.id).exists():
            return True
        if (
            self._vouching_albums(photo)
            .filter(self._public_album_active_q() | Q(shared_to=user))
            .exists()
        ):
            return True
        return Photo.objects.in_shared_libraries(user).filter(pk=photo.pk).exists()

    def _library_grant(self, photo: Photo, user: User | None) -> LibraryGrant | None:
        """The grant of a library share ``user`` may fetch ``photo`` under.

        When the owner shares their library with ``user``, its switches decide
        what is served for every photo of the owner (``api.sharing.grants``).
        """
        if user is None:
            return None
        grant = library_grant(user, photo.owner_id)
        if grant is None or not self._may_access(photo, user):
            return None
        return grant

    def _library_copy_response(self, photo: Photo, use_proxy: bool) -> HttpResponseBase:
        """The full-size copy without metadata a recipient gets instead of the
        original when its owner does not share original files."""
        original = _original_path(photo)
        copy = ensure_copy(photo, original)
        if copy is None:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        content_type = (
            self._file_content_type(original) if photo.video else "image/jpeg"
        )
        if not use_proxy:
            return self._serve_file_direct(copy, content_type)
        response = HttpResponse()
        response["Content-Type"] = content_type
        response["X-Accel-Redirect"] = self._protected_media_url(
            COPIES_DIR, os.path.basename(copy)
        )
        return response

    def _library_media(
        self,
        photo: Photo,
        grant: LibraryGrant,
        path: str,
        fname: str,
        use_proxy: bool,
    ) -> HttpResponseBase:
        """A derived file of a library photo: thumbnails, posters and face
        crops carry no metadata; a video's own file only as originals allow."""
        if "thumbnail" in path or "faces" in path:
            return self._generate_response(photo, path, fname, False, use_proxy)
        if self._video_poster_name(photo, path, fname) is not None:
            return self._generate_response(photo, path, fname, False, use_proxy)
        if not photo.video:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        if grant.originals:
            return self._generate_response(photo, path, fname, False, use_proxy)
        return self._library_copy_response(photo, use_proxy)

    @staticmethod
    def _is_uuid_format(value: str) -> bool:
        return len(value) == 36 and value.count("-") == 4

    @staticmethod
    def _video_poster_name(photo: Photo, path: str, fname: str) -> str | None:
        """The file a request for a video's poster asks for, else ``None``.

        A video's squares are its clips, and the stored names say so; the
        WebP still beside each one, its poster in the grid (#2026), is asked
        for as ``<square directory>/<image_hash>.webp``.
        """
        if not photo.video or not fname.endswith(".webp"):
            return None
        if path.strip("/") not in ANIMATED_THUMBNAIL_DIRS:
            return None
        return photo.image_hash + ".webp"

    def _video_poster_response(
        self, path: str, name: str, use_proxy: bool
    ) -> HttpResponseBase:
        if not use_proxy:
            file_path = self._safe_media_join(path, name)
            if file_path is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            return self._serve_file_direct(file_path, "image/webp")
        response = HttpResponse()
        response["Content-Type"] = "image/webp"
        response["X-Accel-Redirect"] = self._protected_media_url(path, name)
        return response

    def _generate_response(
        self,
        photo: Photo,
        path: str,
        fname: str,
        transcode_videos: bool,
        use_proxy: bool,
    ) -> HttpResponseBase:
        poster = self._video_poster_name(photo, path, fname)
        if poster is not None:
            return self._video_poster_response(path, poster, use_proxy)
        if use_proxy:
            return self._generate_response_proxy(photo, path, fname, transcode_videos)
        return self._generate_response_direct(photo, path, fname, transcode_videos)

    def _lookup_photo(
        self, image_hash: str, user: User | None, allow_uuid: bool = False
    ) -> Photo | None:
        """Resolve a request's hash (or, where allowed, UUID) to a single Photo.

        UUID lookups exist for new-style requests made after migration 0099;
        the image_hash lookup stays for legacy/backward compatibility. Returns
        None when nothing the requester could be shown matches.
        """
        # The thumbnail row comes along (every derived path reads it); the
        # embedding and EXIF blobs are never read here.
        photos = Photo.objects.select_related("thumbnail").defer(*HEAVY_PHOTO_COLUMNS)
        try:
            if allow_uuid and self._is_uuid_format(image_hash):
                return photos.get(pk=image_hash)
            return photos.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return None
        except Photo.MultipleObjectsReturned:
            return self._pick_visible_photo(photos.filter(image_hash=image_hash), user)

    def _serve_zip(
        self, request: Request, path: str, fname: str, use_proxy: bool
    ) -> HttpResponseBase:
        user = self._requester(request)
        if user is None:
            return self._forbidden_unauthenticated()
        try:
            filename = zip_file_name(fname, user.id)
            if filename is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            if use_proxy:
                response = HttpResponse()
                response["Content-Type"] = "application/x-zip-compressed"
                response["X-Accel-Redirect"] = self._protected_media_url(path, filename)
                return response
            file_path = self._safe_media_join(path, filename)
            if file_path is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            return self._serve_file_direct(file_path, "application/x-zip-compressed")
        except Exception:
            return self._forbidden_unauthenticated()

    def _serve_avatar(
        self, request: Request, path: str, fname: str, use_proxy: bool
    ) -> HttpResponseBase:
        if self._requester(request) is None:
            return self._forbidden_unauthenticated()
        try:
            if use_proxy:
                response = HttpResponse()
                response["Content-Type"] = "image/png"
                response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
                return response
            file_path = self._safe_media_join(path, fname)
            if file_path is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            return self._serve_file_direct(file_path, "image/png")
        except Exception:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    def _serve_embedded_media(
        self, request: Request, path: str, fname: str, use_proxy: bool
    ) -> HttpResponseBase:
        # Authorized like the photo itself: an owner-only filter refused the
        # people a motion photo was shared with, and a bare public=True kept
        # serving one that was hidden or trashed later.
        user = self._requester(request)
        photo = self._lookup_photo(fname, user, allow_uuid=True)
        if photo is None or not (
            self._may_access(photo, user)
            or self._in_public_album(photo)
            or self._is_public_photo(photo)
        ):
            return self._refuse(user)
        # A motion photo's video comes out of the original file (#2731).
        grant = self._library_grant(photo, user)
        if grant is not None and not grant.originals:
            return self._refuse(user)
        main_file = photo.main_file
        embedded_media_file = (
            main_file.embedded_media.first() if main_file is not None else None
        )
        if not embedded_media_file:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        if use_proxy:
            response = HttpResponse()
            response["Content-Type"] = "video/mp4"
            response["X-Accel-Redirect"] = self._protected_media_url(
                path, os.path.basename(embedded_media_file.path)
            )
            return response
        return self._serve_file_direct(embedded_media_file.path, "video/mp4")

    def _serve_shared_album_media(
        self,
        album_id: str,
        image_hash: str,
        path: str,
        fname: str,
        use_proxy: bool,
    ) -> HttpResponseBase:
        album = (
            AlbumUser.objects.filter(id=album_id)
            .filter(self._public_album_active_q())
            .first()
        )
        if album is None:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
        try:
            photo = (
                album.photos.filter(
                    owner_id=album.owner_id  # owner-scope: same owner as the album
                )
                .only(
                    "image_hash",
                    "video",
                    "video_color_transfer",
                    "main_file",
                    "thumbnail",
                )
                .get(image_hash=image_hash)
            )
        except Photo.DoesNotExist:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

        if "thumbnail" in path or "thumbnails" in path or "faces" in path:
            return self._generate_response(photo, path, fname, False, use_proxy)

        content_type = self._original_content_type(photo)
        if not use_proxy:
            return self._serve_file_direct(_original_path(photo), content_type)
        response = HttpResponse()
        response["Content-Type"] = content_type
        if _original_path(photo).startswith(settings.PHOTOS):
            internal_path = "/original" + _original_path(photo)[len(settings.PHOTOS) :]
        else:
            internal_path = _original_path(photo)
        response["X-Accel-Redirect"] = iri_to_uri(internal_path)
        return response

    def _refuse(self, user: User | None) -> HttpResponseBase:
        """Refuse a photo the requester may not see, or a hash matching nothing.

        Both get the same answer: a sign-in refusal for an anonymous caller, a
        404 otherwise. Answering 403 for a private photo and 404 for an unknown
        hash told anyone holding a file whether it sits in some user's library
        (GHSA-hq2w-x39h-8wmp).
        """
        if user is None:
            return self._forbidden_unauthenticated()
        return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    def _serve_derived_media(
        self, request: Request, image_hash: str, path: str, fname: str, use_proxy: bool
    ) -> HttpResponseBase:
        # The requester is resolved up front so that a hash shared by several
        # Photo rows can be resolved in their favour.
        user = self._requester(request)
        photo = self._lookup_photo(image_hash, user, allow_uuid=True)
        if photo is None:
            return self._refuse(user)

        # The owner's own thumbnails, the bulk of all media requests: the
        # public-album branch below would serve the very same response (the
        # transcoding setting only matters for a video), one query later.
        if (
            user is not None
            and photo.owner_id == user.id
            and not (photo.video and user.transcode_videos)
        ):
            return self._generate_response(
                photo, path, fname, user.transcode_videos, use_proxy
            )

        grant = self._library_grant(photo, user)
        if grant is not None:
            return self._library_media(photo, grant, path, fname, use_proxy)

        if self._in_public_album(photo):
            return self._generate_response(photo, path, fname, False, use_proxy)

        if user is not None and self._may_access(photo, user):
            return self._generate_response(
                photo, path, fname, user.transcode_videos, use_proxy
            )

        # The lightbox's "Make public and copy link" action sets
        # ``Photo.public`` and copies a link to this route, which used to
        # consult only album shares, so that link always came back 403
        # (#2029). Checked after the requester's own access so that an owner
        # keeps their transcoding setting on a photo they made public.
        if self._is_public_photo(photo):
            return self._generate_response(photo, path, fname, False, use_proxy)

        return self._refuse(user)

    @staticmethod
    def _transcode_for(user: User, request: Request) -> bool:
        """Whether ``user``'s request for a video is to be converted.

        Always, with "Always transcode videos" on. Otherwise when the frontend
        asks, with ``?transcode=1``: it does that only for a video this browser
        says it cannot play (see :mod:`api.video.playback`). Only for a signed-in
        requester -- a public album or public photo is still served as it is,
        since a conversion is the most expensive thing anyone can make this
        server do, and nobody is signed in to be accountable for it.
        """
        return user.transcode_videos or parse_query(request, MediaQuery)["transcode"]

    def _serve_original_media(
        self, request: Request, image_hash: str, use_proxy: bool
    ) -> HttpResponseBase:
        user = self._requester(request)
        photo = self._lookup_photo(image_hash, user)
        if photo is None:
            return self._refuse(user)

        # The requester's own access first, as on the derived-media route: a
        # video that is also in a public album would otherwise be served
        # unconverted to its own owner, who may need it converted to see it.
        if user is not None:
            transcode = self._transcode_for(user, request)
            grant = self._library_grant(photo, user)
            if grant is not None:
                return self._library_original(photo, grant, use_proxy, transcode)
            if photo.owner_id == user.id or photo.shared_to.filter(id=user.id).exists():
                return self._generate_response_original(
                    photo, use_proxy, transcode, inline=True
                )
            if self._may_access(photo, user):
                return self._generate_response_original(photo, use_proxy, transcode)

        if self._in_public_album(photo):
            return self._generate_response_original(photo, use_proxy, False)

        # Same grant, and same placement, as on the derived-media route: a
        # public video plays from here (see ``_is_public_photo``).
        if self._is_public_photo(photo):
            return self._generate_response_original(photo, use_proxy, False)

        return self._refuse(user)

    def _library_original(
        self, photo: Photo, grant: LibraryGrant, use_proxy: bool, transcode: bool
    ) -> HttpResponseBase:
        """The original of a library photo, as its owner allows (#2731).

        Never with the file's name. Without the originals switch, a still or
        a video is the metadata-free copy, never a conversion: one cached
        before conversions dropped the source's metadata still carries it.
        """
        if grant.originals:
            return self._generate_response_original(photo, use_proxy, transcode)
        return self._library_copy_response(photo, use_proxy)


class UnifiedMediaAccessView(MediaServingView):
    """
    Unified media access endpoint supporting both proxy and no-proxy setups,
    and handling public album media access.
    """

    @extend_schema(parameters=[MediaQuery], responses=MEDIA_FILE_RESPONSES)
    def get(
        self,
        request: Request,
        path: str,
        fname: str,
        album_id: str | None = None,
        format: str | None = None,
    ) -> HttpResponseBase:
        # Refused before anything is joined onto MEDIA_ROOT or written into an
        # X-Accel-Redirect URI: a `..` component or a backslash in either URL
        # segment is always an attempt to leave the media directory, never a
        # real request (see _url_segment_traverses).
        if _url_segment_traverses(path, fname):
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

        use_proxy = self._should_use_proxy()
        kind = path.lower()

        if kind == "zip":
            return self._serve_zip(request, path, fname, use_proxy)
        if kind == "avatars":
            return self._serve_avatar(request, path, fname, use_proxy)
        if kind == "embedded_media":
            return self._serve_embedded_media(request, path, fname, use_proxy)

        image_hash = fname.split(".", maxsplit=1)[0].split("_", maxsplit=1)[0]
        if album_id is not None:
            return self._serve_shared_album_media(
                album_id, image_hash, path, fname, use_proxy
            )
        if kind != "photos":
            return self._serve_derived_media(
                request, image_hash, path, fname, use_proxy
            )
        return self._serve_original_media(request, image_hash, use_proxy)
