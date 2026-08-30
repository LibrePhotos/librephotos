"""A disk cache of transcoded videos, so a converted video can be sought.

Some videos a library holds are in containers or codecs the browser cannot
decode, and the per-user "Always transcode videos" setting exists to get those
users something playable: the file is piped through ffmpeg and streamed out as
mp4 while it is being converted.

A live conversion cannot be sought, and nothing about the player can change
that. Its length is not known until it ends, so the response carries no
``Content-Length`` and no ``Accept-Ranges``; a ``Range`` request against it can
only be answered with the whole stream from the beginning. For anyone with that
setting on, every video therefore plays start to finish with no duration, no
scrub bar and no way to skip -- a limitation with no notice attached to it.

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

import logging
import os
import shutil
import subprocess
import threading
import time

from django.conf import settings

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

PART_SUFFIX = ".part"


def _root():
    return getattr(settings, "TRANSCODE_CACHE_ROOT", "") or ""


def _max_bytes():
    return float(getattr(settings, "TRANSCODE_CACHE_MAX_GB", 0)) * BYTES_PER_GB


def _min_free_bytes():
    return float(getattr(settings, "TRANSCODE_CACHE_MIN_FREE_GB", 0)) * BYTES_PER_GB


def _max_concurrent():
    return max(1, int(getattr(settings, "TRANSCODE_CACHE_MAX_CONCURRENT", 1)))


def is_enabled():
    """Caching is off when it has nowhere to write or no room to write in."""
    return bool(_root()) and _max_bytes() > 0


def final_path(image_hash):
    root = _root()
    if not root or not image_hash:
        return None
    return os.path.join(root, f"{image_hash}.mp4")


def media_name(image_hash):
    """The name the finished file is served under, relative to the media root."""
    return f"{image_hash}.mp4"


def cached_path(photo):
    """The finished transcode of ``photo``, or None. Marks it as just used.

    ``mtime`` is the cache's idea of "last served", which is why it is stamped
    on read: access times are unreliable (``relatime``, ``noatime``) and this
    is the only ordering the eviction has to go on.
    """
    if not is_enabled():
        return None
    path = final_path(getattr(photo, "image_hash", None))
    if not path or not os.path.isfile(path):
        return None
    try:
        os.utime(path, None)
    except OSError:
        pass
    return path


def discard(image_hash):
    """Forget a video: called when the photo it belongs to is deleted."""
    path = final_path(image_hash)
    for candidate in [path, (path + PART_SUFFIX) if path else None]:
        if candidate and os.path.exists(candidate):
            try:
                os.remove(candidate)
            except OSError:
                logger.warning("could not remove cached transcode %s", candidate)


def estimated_size(photo):
    """How large the conversion is likely to be, from the stored duration.

    Videos with no duration recorded are assumed to be worth a guess of one
    minute rather than skipped: the running check on free space is what
    actually protects the disk, and this only decides whether to begin.
    """
    length = getattr(photo, "video_length", None)
    try:
        seconds = float(length)
    except (TypeError, ValueError):
        seconds = 0.0
    if seconds <= 0:
        seconds = 60.0
    return int(seconds * ESTIMATED_BYTES_PER_SECOND)


def _entries(root):
    """Finished cache files as (path, mtime, size), oldest use first."""
    entries = []
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


def _in_flight(root):
    try:
        return len([n for n in os.listdir(root) if n.endswith(PART_SUFFIX)])
    except OSError:
        return 0


def _drop_stale_parts(root, now=None):
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


def free_bytes(root):
    try:
        return shutil.disk_usage(root).free
    except OSError:
        return 0


def make_room(root, wanted):
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


def _background_threads():
    """Leave at least half the machine to whoever is using it.

    ffmpeg helps itself to every core by default, which is the right answer for
    the conversion someone is waiting on and the wrong one for this. Half, and
    never fewer than one.
    """
    return max(1, (os.cpu_count() or 2) // 2)


def build_command(source, destination):
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
    return prefix + [
        "ffmpeg",
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
        "-filter:v",
        "scale=-2:'min(720,ih)'",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        destination,
    ]


def run_transcode(command, part, final, root=None):
    """Convert into ``part`` and publish it as ``final`` if it worked out.

    The rename is the commit: nothing serves a file until ffmpeg has exited
    cleanly, so a conversion cut short by a restart or a filling disk leaves
    only a part-file behind, never a truncated video that plays half way and
    stops.
    """
    root = root or os.path.dirname(part)
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError:
        logger.warning("could not start a transcode for %s", final, exc_info=True)
        _remove(part)
        return False

    ran_out_of_room = False
    while True:
        try:
            process.wait(timeout=SPACE_CHECK_SECONDS)
            break
        except subprocess.TimeoutExpired:
            if free_bytes(root) < _min_free_bytes():
                ran_out_of_room = True
                process.kill()
                process.wait()
                break

    if ran_out_of_room:
        logger.info("abandoned caching %s: the disk is close to full", final)
        _remove(part)
        return False
    if process.returncode != 0:
        logger.warning("transcode of %s failed (%s)", final, process.returncode)
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


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _start_background(command, part, final, root):
    thread = threading.Thread(
        target=run_transcode,
        args=(command, part, final, root),
        name="transcode-cache",
        daemon=True,
    )
    thread.start()
    return thread


def ensure_cached(photo, start=None):
    """Begin caching ``photo`` if it is not cached and there is room for it.

    Returns whether a conversion was started. Every reason not to start one is
    ordinary: it is already there, someone else is already doing it, too many
    are running, or the disk says no.
    """
    if not is_enabled():
        return False
    source = photo.main_file.path if photo.main_file else None
    final = final_path(getattr(photo, "image_hash", None))
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

    (start or _start_background)(build_command(source, part), part, final, root)
    return True
