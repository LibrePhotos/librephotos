"""A disk cache of transcoded videos, so a converted video can be sought.

Some videos a library holds are in containers or codecs the browser cannot
decode. Those, and every video of a user with "Always transcode videos" on, are
piped through ffmpeg and streamed out as mp4 while they are being converted.

A live conversion cannot be sought, and nothing about the player can change
that. Its length is not known until it ends, so the response carries no
``Content-Length`` and no ``Accept-Ranges``; a ``Range`` request against it can
only be answered with the whole stream from the beginning. Every converted
video therefore plays start to finish with no duration, no scrub bar and no way
to skip.

So the conversion is also written to a real file, once, in the background. The
next play of that video is served from the file: an ordinary mp4 with a length
and byte ranges, which the browser seeks natively. The first play still streams
live, so nothing gets slower.

Two ceilings keep the cache from being a liability. It never grows past
``TRANSCODE_CACHE_MAX_GB``, and it never eats into the last
``TRANSCODE_CACHE_MIN_FREE_GB`` of the filesystem -- the same volume usually
holds the thumbnails and the database, and a full disk is a far worse outcome
than a video that has to be converted again. When either ceiling is reached the
least recently served entries are dropped, and when dropping them is not enough
the video simply is not cached: playback falls back to streaming it live, which
is what happens today anyway.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Callable
from typing import IO, TYPE_CHECKING

from django.conf import settings

from api import binaries, video_color

if TYPE_CHECKING:
    # Not imported at run time: api.models reaches this module through
    # api.photo_files, so the import would be circular.
    from api.models.photo import Photo

logger = logging.getLogger(__name__)

BYTES_PER_GB = 1024**3

# What a minute of output costs, measured across real phone footage at the
# preset below: roughly 15 MB. Used only to judge in advance whether a video can
# possibly fit, never to report a size that matters.
ESTIMATED_BYTES_PER_SECOND = 15 * BYTES_PER_GB / 1024 / 60

# A part-file abandoned by a killed worker would otherwise keep its video from
# ever being cached again, since its presence is what marks the work as taken.
STALE_PART_SECONDS = 6 * 60 * 60

# How often a conversion in progress re-checks that it is still welcome on the
# disk. Sizes are estimates and something else may be filling the volume.
SPACE_CHECK_SECONDS = 15

# No single timeout fits a conversion: a two-hour HDR film on a two-core ARM
# box can take hours. What a stuck one does not do is make progress, so it is
# killed once its part-file has not changed for this long. A live conversion,
# even niced on a busy host, writes every few seconds, and the faststart pass
# that rewrites the file at the end keeps touching it too. Generous on purpose:
# killing a slow but live conversion throws its work away.
STALL_SECONDS = 30 * 60

PART_SUFFIX = ".part"


def _root() -> str:
    return getattr(settings, "TRANSCODE_CACHE_ROOT", "") or ""


def _max_bytes() -> float:
    return float(getattr(settings, "TRANSCODE_CACHE_MAX_GB", 0)) * BYTES_PER_GB


def _min_free_bytes() -> float:
    return float(getattr(settings, "TRANSCODE_CACHE_MIN_FREE_GB", 0)) * BYTES_PER_GB


def _max_concurrent() -> int:
    return max(1, int(getattr(settings, "TRANSCODE_CACHE_MAX_CONCURRENT", 1)))


def is_enabled() -> bool:
    """Caching is off when it has nowhere to write or no room to write in."""
    return bool(_root()) and _max_bytes() > 0


def final_path(image_hash: str | None) -> str | None:
    root = _root()
    if not root or not image_hash:
        return None
    return os.path.join(root, f"{image_hash}.mp4")


def cached_path(photo: Photo) -> str | None:
    """The finished transcode of ``photo``, or None. Marks it as just used.

    ``mtime`` is the cache's idea of "last served", which is why it is stamped
    on read: access times are unreliable (``relatime``, ``noatime``) and this
    is the only ordering the eviction has to go on.
    """
    if not is_enabled():
        return None
    path = final_path(photo.image_hash)
    if not path or not os.path.isfile(path):
        return None
    try:
        os.utime(path, None)
    except OSError:
        pass
    return path


def discard(image_hash: str | None) -> None:
    """Forget a video: called when the photo it belongs to is deleted."""
    path = final_path(image_hash)
    for candidate in [path, (path + PART_SUFFIX) if path else None]:
        if candidate and os.path.exists(candidate):
            try:
                os.remove(candidate)
            except OSError:
                logger.warning("could not remove cached transcode %s", candidate)


def estimated_size(photo: Photo) -> int:
    """How large the conversion is likely to be, from the stored duration.

    Videos with no duration recorded are assumed to be worth a guess of one
    minute rather than skipped: the running check on free space is what
    actually protects the disk, and this only decides whether to begin.
    """
    # A missing duration (None) and one that is not a number both count as
    # unknown, which is what the float() failure used to say.
    seconds = 0.0
    if photo.video_length is not None:
        try:
            seconds = float(photo.video_length)
        except ValueError:
            seconds = 0.0
    if seconds <= 0:
        seconds = 60.0
    return int(seconds * ESTIMATED_BYTES_PER_SECOND)


def _entries(root: str) -> list[tuple[str, float, int]]:
    """Finished cache files as (path, mtime, size), oldest use first."""
    entries: list[tuple[str, float, int]] = []
    try:
        names = os.listdir(root)
    except OSError:
        return entries
    for name in names:
        if name.endswith(PART_SUFFIX):
            continue
        path = os.path.join(root, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        if os.path.isfile(path):
            entries.append((path, stat.st_mtime, stat.st_size))
    entries.sort(key=lambda entry: entry[1])
    return entries


def _in_flight(root: str) -> int:
    try:
        return len([n for n in os.listdir(root) if n.endswith(PART_SUFFIX)])
    except OSError:
        return 0


def _drop_stale_parts(root: str, now: float | None = None) -> None:
    """Remove part-files whose writer is long gone.

    ffmpeg touches its output continuously, so a part-file that has not grown
    in hours belongs to a process that no longer exists -- a recycled worker, a
    restarted container -- and holding its claim forever would make that one
    video permanently uncacheable.
    """
    now = time.time() if now is None else now
    try:
        names = os.listdir(root)
    except OSError:
        return
    for name in names:
        if not name.endswith(PART_SUFFIX):
            continue
        path = os.path.join(root, name)
        try:
            if now - os.stat(path).st_mtime > STALE_PART_SECONDS:
                os.remove(path)
                logger.info("removed abandoned transcode %s", path)
        except OSError:
            continue


def free_bytes(root: str) -> int:
    try:
        return shutil.disk_usage(root).free
    except OSError:
        return 0


def make_room(root: str, wanted: int) -> bool:
    """Free up ``wanted`` bytes of headroom, evicting least recently served.

    Returns False when the room cannot be had, which is not an error: the
    caller then leaves the video uncached and it streams live as before.
    """
    entries = _entries(root)
    used = sum(entry[2] for entry in entries)
    budget = _max_bytes()
    reserve = _min_free_bytes()

    for path, _, size in entries:
        over_budget = used + wanted > budget
        under_reserve = free_bytes(root) - wanted < reserve
        if not over_budget and not under_reserve:
            return True
        try:
            os.remove(path)
        except OSError:
            continue
        used -= size
        logger.info("evicted cached transcode %s", path)

    return used + wanted <= budget and free_bytes(root) - wanted >= reserve


def _background_threads() -> int:
    """Leave at least half the machine to whoever is using it.

    ffmpeg helps itself to every core by default, which is the right answer for
    the conversion someone is waiting on and the wrong one for this. Half, and
    never fewer than one.
    """
    return max(1, (os.cpu_count() or 2) // 2)


def build_command(
    source: str, destination: str, transfer: str | None = None
) -> list[str]:
    """The conversion that produces a seekable file.

    Three deliberate differences from the live stream, all of them because
    nobody is waiting for this one. It is niced and given half the cores, so
    playback, thumbnails and the scan all outrank it. The preset is slower,
    since ``ultrafast`` costs roughly double the bytes for the same picture --
    about 30 MB a minute against 15. And the height is a ceiling rather than a
    target: the live command scales everything to 720 lines, which quietly
    *upscales* the phone clips that most often need converting, spending disk
    and CPU to add nothing.
    """
    nice = shutil.which("nice")
    niceness = int(getattr(settings, "TRANSCODE_CACHE_NICE", 10))
    # Without the binary the conversion still runs, just without the courtesy.
    prefix = [nice, "-n", str(niceness)] if nice and niceness else []
    command = prefix + [
        binaries.ffmpeg(),
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        source,
        # After the input, so it limits the encoder -- which is what costs the
        # CPU. Before it, ffmpeg would read it as a decoder setting.
        "-threads",
        str(_background_threads()),
        "-vcodec",
        "libx264",
        "-preset",
        getattr(settings, "TRANSCODE_CACHE_PRESET", "veryfast"),
    ]

    # An HDR source converted without tonemapping comes out washed out, because
    # the browser reads its PQ or HLG curve as bt709. See :mod:`api.video_color`.
    command += video_color.h264_video_args(source, video_color.PLAYBACK_SCALE, transfer)

    return command + ["-movflags", "+faststart", "-f", "mp4", destination]


def run_transcode(
    command: list[str], part: str, final: str, root: str | None = None
) -> bool:
    """Convert into ``part`` and publish it as ``final`` if it worked out.

    The rename is the commit: nothing serves a file until ffmpeg has exited
    cleanly, so a conversion cut short by a restart or a filling disk leaves
    only a part-file behind, never a truncated video that plays half way and
    stops. A conversion that stops making progress is killed (STALL_SECONDS).
    """
    root = root or os.path.dirname(part)
    # Not a pipe: nobody reads it while ffmpeg runs, and a file that decodes
    # badly makes ffmpeg write an error per frame even at -loglevel error, which
    # filled a pipe and blocked it in write() for good. A file only keeps it.
    with tempfile.TemporaryFile() as stderr:
        try:
            # The command may start with nice rather than ffmpeg (build_command).
            process = binaries.start_tool(
                command[0], command[1:], stdout=binaries.DEVNULL, stderr=stderr
            )
        except binaries.ToolMissingError:
            logger.warning("could not start a transcode for %s", final)
            _remove(part)
            return False
        abandoned = _watch(process, part, root, final)
        complaint = _tail(stderr) if process.returncode != 0 else ""

    if abandoned:
        _remove(part)
        return False
    if process.returncode != 0:
        logger.warning(
            "transcode of %s failed (%s): %s", final, process.returncode, complaint
        )
        _remove(part)
        return False
    try:
        if os.path.getsize(part) == 0:
            _remove(part)
            return False
        os.replace(part, final)
    except OSError:
        logger.warning("could not publish cached transcode %s", final, exc_info=True)
        _remove(part)
        return False
    logger.info("cached a seekable copy of %s", final)
    return True


def _watch(process: binaries.Process, part: str, root: str, final: str) -> bool:
    """Wait for ``process``; kill it and return True if it has to be abandoned.

    It is abandoned when the disk gets close to full, or when its part-file
    stops changing for STALL_SECONDS.
    """
    progress = _progress(part)
    last_change = time.monotonic()
    while binaries.wait(process, SPACE_CHECK_SECONDS) is None:
        if free_bytes(root) < _min_free_bytes():
            logger.info("abandoned caching %s: the disk is close to full", final)
        else:
            now = _progress(part)
            if now != progress:
                progress, last_change = now, time.monotonic()
                continue
            if time.monotonic() - last_change < STALL_SECONDS:
                continue
            logger.warning(
                "abandoned caching %s: no progress for %s s", final, STALL_SECONDS
            )
        process.kill()
        process.wait()
        return True
    return False


def _progress(part: str) -> tuple[int, int] | None:
    """Size and modification time of the part-file: what changes while ffmpeg works."""
    try:
        stat = os.stat(part)
    except OSError:
        return None
    return stat.st_size, stat.st_mtime_ns


def _tail(stderr: IO[bytes]) -> str:
    """The end of what ffmpeg wrote to ``stderr``, a file still open."""
    size = stderr.seek(0, os.SEEK_END)
    stderr.seek(max(0, size - binaries.STDERR_TAIL_CHARS))
    return binaries.stderr_tail(stderr.read())


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _start_background(
    command: list[str], part: str, final: str, root: str
) -> threading.Thread:
    thread = threading.Thread(
        target=run_transcode,
        args=(command, part, final, root),
        name="transcode-cache",
        daemon=True,
    )
    thread.start()
    return thread


def ensure_cached(
    photo: Photo,
    start: Callable[[list[str], str, str, str], object] | None = None,
) -> bool:
    """Begin caching ``photo`` if it is not cached and there is room for it.

    Returns whether a conversion was started. Every reason not to start one is
    ordinary: it is already there, someone else is already doing it, too many
    are running, or the disk says no.
    """
    if not is_enabled():
        return False
    source = photo.main_file.path if photo.main_file else None
    final = final_path(photo.image_hash)
    if not source or not final or os.path.isfile(final):
        return False

    root = _root()
    try:
        os.makedirs(root, exist_ok=True)
    except OSError:
        logger.warning("cannot create the transcode cache at %s", root)
        return False

    _drop_stale_parts(root)
    if _in_flight(root) >= _max_concurrent():
        return False
    if not make_room(root, estimated_size(photo)):
        logger.info("no room to cache a transcode of %s", final)
        return False

    part = final + PART_SUFFIX
    try:
        # O_EXCL is the claim, and it is the only one that holds across the
        # several worker processes the backend runs: whoever creates the
        # part-file owns the conversion, and everyone else moves on.
        os.close(os.open(part, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
    except FileExistsError:
        return False
    except OSError:
        logger.warning("cannot write to the transcode cache at %s", root)
        return False

    command = build_command(source, part, photo.video_color_transfer)
    (start or _start_background)(command, part, final, root)
    return True
