"""Serving media files (``/media/...``): originals, thumbnails, faces, zips,
avatars and embedded media, plus the live video transcoder behind them."""

import collections
import os
import subprocess
import threading
from urllib.parse import quote

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse, HttpResponseForbidden, StreamingHttpResponse
from django.utils import timezone
from django.utils.encoding import iri_to_uri
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from api import binaries, ffmpeg_budget, transcode_cache, video_color
from api.all_tasks import zip_file_name
from api.http_range import file_size, ranged_response
from api.mime import mime_type
from api.models import AlbumUser, Photo, User
from api.util import logger


def build_live_command(path):
    """The conversion a viewer is waiting on, bounded so it cannot take the host.

    Unbounded, this is one person's playback against everybody else's: ffmpeg
    defaults to every core and to converting as fast as the machine allows,
    while a viewer needs only a little more than real time. See
    :mod:`api.ffmpeg_budget` for what the two limits below each bound, and why
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
    ]

    # A ceiling, not a target: plain "scale=-2:720" enlarges anything shorter
    # than 720 lines, and the phone clips that most often need converting are
    # exactly that. Upscaling costs bandwidth and CPU to add nothing a viewer
    # can see. An HDR source needs tonemapping after it, or the browser reads a
    # PQ curve as bt709 and shows it washed out; see :mod:`api.video_color`.
    video_filter = video_color.video_filter(path, "scale=-2:'min(720,ih)'")
    if video_filter:
        command += ["-filter:v", video_filter]

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

    process = ""

    def __init__(self, path):
        self.process = subprocess.Popen(
            build_live_command(path),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._stderr_tail = collections.deque(maxlen=self.STDERR_TAIL_BYTES)
        self._drain = threading.Thread(target=self._read_stderr, daemon=True)
        self._drain.start()

    def _read_stderr(self):
        for chunk in iter(lambda: self.process.stderr.read(4096), b""):
            self._stderr_tail.extend(chunk)

    def stderr_tail(self):
        """What ffmpeg last said, once there is no more of it coming.

        The drain thread is joined first: a deque is safe to extend from
        another thread but not to iterate while it is being extended, and
        process exit does not by itself mean the pipe has been read to the end.
        """
        self._drain.join(timeout=5)
        return bytes(self._stderr_tail).decode("utf-8", "replace").strip()

    def __del__(self):
        self.process.kill()


def gen(transcoder):
    """Stream the conversion, and say so in the log if it ended badly.

    A failed transcode reaches the browser as a video that simply stops, so the
    only place the reason can land is here.
    """
    yield from iter(transcoder.process.stdout.readline, b"")
    if transcoder.process.wait() != 0:
        logger.warning(
            "live video transcode exited with %s: %s",
            transcoder.process.returncode,
            transcoder.stderr_tail() or "no output on stderr",
        )


class UnifiedMediaAccessView(APIView):
    """
    Unified media access endpoint supporting both proxy and no-proxy setups,
    and handling public album media access.
    """

    permission_classes = (AllowAny,)

    def _should_use_proxy(self):
        return not getattr(settings, "SERVE_FRONTEND", False)

    def _forbidden_unauthenticated(self):
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

    def _protected_media_url(self, path, fname):
        path = path.lstrip("/")
        return f"/protected_media/{path}/{fname}"

    def _file_content_type(self, file_path):
        try:
            return mime_type(file_path)
        except Exception:
            return "application/octet-stream"

    def _serve_file_direct(self, file_path, content_type=None):
        if not os.path.exists(file_path):
            return HttpResponse(status=404)
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
            return HttpResponse(status=404)
        except PermissionError:
            # Not a 404: the file is right there and we were refused. Reporting
            # "not found" sends the administrator hunting for a missing file
            # while a permissions problem sits in plain sight, and it denies the
            # frontend the one signal it has for telling those two apart -- a
            # <video> element exposes no HTTP status, so the status code is the
            # whole diagnosis.
            return HttpResponse(status=403)
        except Exception:
            return HttpResponse(status=500)

    def _transcoded_video_response(self, photo, use_proxy):
        """Hand out a playable mp4 for a video the browser cannot decode.

        Browsers cannot decode every container/codec we store, so the per-user
        "Always transcode videos" setting exists to get them something they can
        actually play.

        A conversion happening live cannot be sought -- its length is unknown
        until it ends, so there is no ``Content-Length``, no ``Accept-Ranges``
        and nothing a ``Range`` request can be answered with. The first play
        still streams like that, because it starts immediately; in the
        background the same conversion is written to a file, and every later
        play is served from that instead, as an ordinary seekable mp4. See
        :mod:`api.transcode_cache` for what keeps it from filling the disk.
        """
        cached = transcode_cache.cached_path(photo)
        if cached:
            served_by_proxy = use_proxy and cached.startswith(
                os.path.join(settings.MEDIA_ROOT, "")
            )
            if served_by_proxy:
                response = HttpResponse()
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    os.path.dirname(os.path.relpath(cached, settings.MEDIA_ROOT)),
                    os.path.basename(cached),
                )
                return response
            return self._serve_file_direct(cached, "video/mp4")

        response = StreamingHttpResponse(
            self._cache_after_streaming(
                gen(VideoTranscoder(photo.main_file.path)), photo
            ),
            content_type="video/mp4",
        )
        # The live stream and the cached file answer to the same URL, and this
        # one is the poorer of the two: a browser that kept it would keep
        # serving an unseekable video after a seekable one exists.
        response["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def _cache_after_streaming(stream, photo):
        """Stream the live conversion, and only then start writing the copy.

        Not alongside it. The live conversion has to keep ahead of playback, and
        a second ffmpeg started next to it takes a share of the machine away
        from the one thing somebody is actually waiting for -- on a two-core
        server, half of it, which is enough to turn a video that used to start
        at once into one that looks stuck.

        Waiting costs nothing, because the copy is for the *next* play. The
        generator is closed either way, whether the video ran to the end or the
        viewer left after five seconds, so the copy still gets written.
        """
        try:
            yield from stream
        finally:
            transcode_cache.ensure_cached(photo)

    def _thumbnail_field_for(self, photo, path):
        """Return the ``FieldFile`` holding the thumbnail ``path`` asks for.

        The request filename cannot be turned into an on-disk name by string
        manipulation: ``Thumbnail._generate_thumbnail`` always stores files as
        ``<image_hash>.<ext>``, while the frontend also addresses photos by
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

    def _generate_response_proxy(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            response = HttpResponse()
            thumb = self._thumbnail_field_for(photo, path)

            # thumbnails_big is a static image even for videos: .webp today,
            # .jpg on installs that predate the webp switch.
            if "thumbnails_big" in path:
                name = os.path.basename(thumb.name) if thumb else fname + ".webp"
                response["Content-Type"] = (
                    "image/jpeg" if "jpg" in os.path.splitext(name)[1] else "image/webp"
                )
                response["X-Accel-Redirect"] = self._protected_media_url(path, name)
                return response

            if thumb is None:
                # No Thumbnail row (or an unpopulated field): keep serving the
                # legacy request-derived name rather than 500ing on the
                # missing relation.
                ext = ".mp4" if photo.video else ".webp"
                response["Content-Type"] = "video/mp4" if photo.video else "image/webp"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, fname + ext
                )
                return response

            ext = os.path.splitext(thumb.name)[1]
            actual_name = os.path.basename(thumb.name)
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
            response["Content-Type"] = mime_type(photo.main_file.path)
            response["X-Accel-Redirect"] = iri_to_uri(
                photo.main_file.path.replace(settings.DATA_ROOT, "/original")
            )
            return response

        response = HttpResponse()
        response["Content-Type"] = "image/jpg"
        response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
        return response

    def _big_jpg_thumbnail_response(self, photo, fallback):
        """Serve the big jpg thumbnail, or ``fallback`` when it was never stored."""
        big = self._thumbnail_field_for(photo, "thumbnails_big")
        return self._serve_file_direct((big or fallback).path, "image/jpg")

    def _stored_thumbnail_response(self, photo, path):
        """Serve the thumbnail the model names, or ``None`` to fall back.

        Resolve from the model first: `fname` is the Photo UUID for
        UUID-addressed requests, and no thumbnail is ever stored under that
        name, so the request-derived lookup can only ever 404 for them.
        """
        thumb = self._thumbnail_field_for(photo, path)
        if thumb is None:
            return None
        ext = os.path.splitext(thumb.name)[1]
        if "jpg" in ext:
            # Legacy jpg thumbnails: only the big variant is usable.
            return self._big_jpg_thumbnail_response(photo, thumb)
        if os.path.exists(thumb.path):
            return self._serve_file_direct(
                thumb.path,
                "video/mp4" if "mp4" in ext else "image/webp",
            )
        return None

    def _suffixed_thumbnail_response(self, path, fname):
        """Serve ``fname`` with a thumbnail extension appended, if one is there."""
        for ext, content_type in ((".webp", "image/webp"), (".mp4", "video/mp4")):
            if fname.endswith(ext):
                continue
            candidate = os.path.join(settings.MEDIA_ROOT, path, fname + ext)
            if os.path.exists(candidate):
                return self._serve_file_direct(candidate, content_type)
        return None

    def _thumbnail_response_direct(self, photo, path, fname):
        response = self._stored_thumbnail_response(photo, path)
        if response is not None:
            return response

        file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
        if not os.path.exists(file_path):
            response = self._suffixed_thumbnail_response(path, fname)
            if response is not None:
                return response
        # Legacy jpg installs may never have populated the small/square
        # variants; fall back to the big jpg for any of them, as before.
        square = self._thumbnail_field_for(photo, "square_thumbnails")
        if square is not None and "jpg" in os.path.splitext(square.name)[1]:
            return self._big_jpg_thumbnail_response(photo, square)
        return self._serve_file_direct(file_path)

    def _generate_response_direct(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            return self._thumbnail_response_direct(photo, path, fname)

        if "faces" in path:
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            return self._serve_file_direct(file_path, "image/jpg")

        if photo.video:
            if transcode_videos:
                return self._transcoded_video_response(photo, use_proxy=False)
            return self._serve_file_direct(photo.main_file.path)

        file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
        return self._serve_file_direct(file_path, "image/jpg")

    def _generate_response_original(
        self, photo, use_proxy, transcode_videos, inline=False
    ):
        """Serve the untouched original file (path == "photos").

        Videos go through ffmpeg first when the requester enabled "Always
        transcode videos", exactly like the thumbnail/video paths do.
        """
        if photo.video and transcode_videos:
            return self._transcoded_video_response(photo, use_proxy=use_proxy)
        content_type = self._file_content_type(photo.main_file.path)

        if use_proxy:
            response = HttpResponse()
            response["Content-Type"] = content_type if photo.video else "image/webp"
            if photo.main_file.path.startswith("/nextcloud_media/"):
                internal_path = "/nextcloud_original" + photo.main_file.path[21:]
            elif photo.main_file.path.startswith(settings.PHOTOS):
                internal_path = (
                    "/original" + photo.main_file.path[len(settings.PHOTOS) :]
                )
            else:
                internal_path = quote(photo.main_file.path)
            if inline:
                response["Content-Disposition"] = 'inline; filename="{}"'.format(
                    photo.main_file.path.split("/")[-1]
                )
            response["X-Accel-Redirect"] = iri_to_uri(internal_path)
            return response
        return self._serve_file_direct(photo.main_file.path, content_type)

    def _public_album_active_q(self):
        return Q(share__enabled=True) & (
            Q(share__expires_at__isnull=True) | Q(share__expires_at__gte=timezone.now())
        )

    @staticmethod
    def _vouching_albums(photo):
        """Albums whose shares may grant access to ``photo``: its owner's only.

        A photo that sits in someone else's album (GHSA-phvg-g65q-rhq3) must
        not be served on the strength of that album's share.
        """
        return photo.albumuser_set.filter(owner_id=photo.owner_id)

    def _in_public_album(self, photo):
        """Whether an active public share of one of its owner's albums vouches."""
        return (
            self._vouching_albums(photo).filter(self._public_album_active_q()).exists()
        )

    @staticmethod
    def _is_public_photo(photo):
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

    def _resolve_requester(self, jwt):
        """Return ``(user, token_valid)`` for the value of the ``jwt`` cookie.

        ``user`` is None both when there is no usable token and when the token
        names a user that no longer exists, so callers must not assume a valid
        token yields a user.
        """
        if jwt is None:
            return None, False
        try:
            token = AccessToken(jwt)
        except TokenError:
            return None, False
        user = (
            User.objects.filter(id=token["user_id"])
            .only("id", "transcode_videos")
            .first()
        )
        return user, True

    def _pick_visible_photo(self, photos, user):
        """Choose which row a shared ``image_hash`` resolves to.

        ``Photo.image_hash`` is meant to be unique per user, but two users who
        scan the same file end up sharing one: ``File.create()`` returns the
        existing row for a path already on disk, so the second user's Photo
        inherits the first scanner's hash. Falling back to an arbitrary row
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

    def _may_access(self, photo, user):
        """Whether `user` may fetch `photo`: owner, direct share, or via album."""
        if user is None:
            return False
        if photo.owner_id == user.id or photo.shared_to.filter(id=user.id).exists():
            return True
        return (
            self._vouching_albums(photo)
            .filter(self._public_album_active_q() | Q(shared_to=user))
            .exists()
        )

    @staticmethod
    def _is_uuid_format(value):
        return len(value) == 36 and value.count("-") == 4

    def _token_or_none(self, request):
        jwt = request.COOKIES.get("jwt")
        if jwt is None:
            return None
        try:
            return AccessToken(jwt)
        except TokenError:
            return None

    def _generate_response(self, photo, path, fname, transcode_videos, use_proxy):
        if use_proxy:
            return self._generate_response_proxy(photo, path, fname, transcode_videos)
        return self._generate_response_direct(photo, path, fname, transcode_videos)

    def _lookup_photo(self, image_hash, user, allow_uuid=False):
        """Resolve a request's hash (or, where allowed, UUID) to a single Photo.

        UUID lookups exist for new-style requests made after migration 0099;
        the image_hash lookup stays for legacy/backward compatibility. Returns
        None when nothing the requester could be shown matches.
        """
        try:
            if allow_uuid and self._is_uuid_format(image_hash):
                return Photo.objects.get(pk=image_hash)
            return Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return None
        except Photo.MultipleObjectsReturned:
            return self._pick_visible_photo(
                Photo.objects.filter(image_hash=image_hash), user
            )

    def _serve_zip(self, request, path, fname, use_proxy):
        token = self._token_or_none(request)
        if token is None:
            return self._forbidden_unauthenticated()
        try:
            filename = zip_file_name(fname, token["user_id"])
            if filename is None:
                return HttpResponse(status=404)
            if use_proxy:
                response = HttpResponse()
                response["Content-Type"] = "application/x-zip-compressed"
                response["X-Accel-Redirect"] = self._protected_media_url(path, filename)
                return response
            file_path = os.path.join(settings.MEDIA_ROOT, path, filename)
            return self._serve_file_direct(file_path, "application/x-zip-compressed")
        except Exception:
            return self._forbidden_unauthenticated()

    def _serve_avatar(self, request, path, fname, use_proxy):
        token = self._token_or_none(request)
        if token is None:
            return self._forbidden_unauthenticated()
        try:
            _ = User.objects.filter(id=token["user_id"]).only("id").first()
            if use_proxy:
                response = HttpResponse()
                response["Content-Type"] = "image/png"
                response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
                return response
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            return self._serve_file_direct(file_path, "image/png")
        except Exception:
            return HttpResponse(status=404)

    def _embedded_media_query(self, request):
        query = Q(public=True)
        if request.user.is_authenticated:
            query = Q(owner=request.user)
        jwt = request.COOKIES.get("jwt")
        if jwt is not None:  # pragma: no cover
            try:
                token = AccessToken(jwt)
                user = User.objects.filter(id=token["user_id"]).only("id").first()
                query = Q(owner=user)
            except TokenError:
                pass
        return query

    def _serve_embedded_media(self, request, path, fname, use_proxy):
        query = self._embedded_media_query(request)
        if self._is_uuid_format(fname):
            photo = Photo.objects.filter(query, pk=fname).first()
        else:
            photo = Photo.objects.filter(query, image_hash=fname).first()
        embedded_media_file = photo.main_file.embedded_media.first() if photo else None
        if not embedded_media_file:
            return HttpResponse(status=404)
        if use_proxy:
            response = HttpResponse()
            response["Content-Type"] = "video/mp4"
            response["X-Accel-Redirect"] = self._protected_media_url(
                path, os.path.basename(embedded_media_file.path)
            )
            return response
        return self._serve_file_direct(embedded_media_file.path, "video/mp4")

    def _serve_shared_album_media(self, album_id, image_hash, path, fname, use_proxy):
        album = (
            AlbumUser.objects.filter(id=album_id)
            .filter(self._public_album_active_q())
            .first()
        )
        if album is None:
            return HttpResponse(status=404)
        try:
            photo = (
                album.photos.filter(owner_id=album.owner_id)
                .only("image_hash", "video", "main_file", "thumbnail")
                .get(image_hash=image_hash)
            )
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        if "thumbnail" in path or "thumbnails" in path or "faces" in path:
            return self._generate_response(photo, path, fname, False, use_proxy)

        content_type = self._file_content_type(photo.main_file.path)
        if not use_proxy:
            return self._serve_file_direct(
                photo.main_file.path, content_type if photo.video else "image/webp"
            )
        response = HttpResponse()
        response["Content-Type"] = content_type if photo.video else "image/webp"
        if photo.main_file.path.startswith(settings.PHOTOS):
            internal_path = "/original" + photo.main_file.path[len(settings.PHOTOS) :]
        else:
            internal_path = photo.main_file.path
        response["X-Accel-Redirect"] = iri_to_uri(internal_path)
        return response

    def _serve_derived_media(self, request, image_hash, path, fname, use_proxy):
        # The requester is resolved up front so that a hash shared by several
        # Photo rows can be resolved in their favour.
        user, token_valid = self._resolve_requester(request.COOKIES.get("jwt"))
        photo = self._lookup_photo(image_hash, user, allow_uuid=True)
        if photo is None:
            return HttpResponse(status=404)

        if self._in_public_album(photo):
            return self._generate_response(photo, path, fname, False, use_proxy)

        if token_valid and self._may_access(photo, user):
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

        if not token_valid:
            return self._forbidden_unauthenticated()
        return HttpResponse(status=404)

    def _serve_original_media(self, request, image_hash, use_proxy):
        user, token_valid = self._resolve_requester(request.COOKIES.get("jwt"))
        photo = self._lookup_photo(image_hash, user)
        if photo is None:
            return HttpResponse(status=404)

        if self._in_public_album(photo):
            return self._generate_response_original(photo, use_proxy, False)

        if token_valid and user is not None:
            if photo.owner_id == user.id or photo.shared_to.filter(id=user.id).exists():
                return self._generate_response_original(
                    photo, use_proxy, user.transcode_videos, inline=True
                )
            if self._may_access(photo, user):
                return self._generate_response_original(
                    photo, use_proxy, user.transcode_videos
                )

        # Same grant, and same placement, as on the derived-media route: a
        # public video plays from here (see ``_is_public_photo``).
        if self._is_public_photo(photo):
            return self._generate_response_original(photo, use_proxy, False)

        if not token_valid:
            return self._forbidden_unauthenticated()
        return HttpResponse(status=404)

    def get(self, request, path, fname, album_id=None, format=None):
        use_proxy = self._should_use_proxy()
        kind = path.lower()

        if kind == "zip":
            return self._serve_zip(request, path, fname, use_proxy)
        if kind == "avatars":
            return self._serve_avatar(request, path, fname, use_proxy)
        if kind == "embedded_media":
            return self._serve_embedded_media(request, path, fname, use_proxy)

        image_hash = fname.split(".")[0].split("_")[0]
        if album_id is not None:
            return self._serve_shared_album_media(
                album_id, image_hash, path, fname, use_proxy
            )
        if kind != "photos":
            return self._serve_derived_media(
                request, image_hash, path, fname, use_proxy
            )
        return self._serve_original_media(request, image_hash, use_proxy)
