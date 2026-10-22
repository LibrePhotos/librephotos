"""Full-size copies without metadata, for a library shared without originals.

An original file carries its GPS position, camera serial, keywords and the
rest inside it, whatever the owner's Location switch says. When the owner of
a library does not share original files (#2731), the recipient downloads and
plays this copy instead: a still re-encoded as a JPEG at its full size with
only its colour profile kept (as the thumbnails are), a video remuxed without
its container metadata (the recorded location lives there), its streams
copied as they are.

Copies are made on the first request and kept under
``MEDIA_ROOT/library_copies/<owner id>/``, named by ``image_hash`` like the
thumbnails, so every recipient reuses one. They go when the thumbnails of
that hash go (``api.photos.file_cleanup``) and, all of an owner's, when the
owner's last library share ends (``forget_owner_copies``).

Making one costs a decode and an encode (or a remux), so it is bounded: one
request makes a given copy (a lock file beside it) and the others are told to
come back (503 with ``Retry-After``), and each recipient makes at most
``COPIES_PER_HOUR`` new copies of one library an hour, counted on the share
row. An owner's copies go when their last share is deleted, by the API or by
a cascade (``register``).
"""

from __future__ import annotations

import datetime
import glob
import logging
import os
import shutil
import time
import uuid
from collections.abc import Callable
from functools import partial

import pyvips
from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.db.models.signals import post_delete
from django.utils import timezone
from PIL import UnidentifiedImageError

from api.mime import JPEG_EXTENSION, MP4_EXTENSION, extension
from api.models import CopyBudget, LibraryShare, Photo
from api.runtime import binaries
from api.thumbnails import decoding
from api.video.no_metadata import NO_METADATA

logger = logging.getLogger(__name__)

COPIES_DIR = "library_copies"
JPEG_QUALITY = 92
# Remuxing copies the streams, so it runs at disk speed; a video still being
# remuxed after this is stuck on the file.
REMUX_TIMEOUT = 600
# Without the container's metadata, and per stream too (a phone writes its
# handler and creation time there, a camera sometimes more).
VIDEO_NO_METADATA = (*NO_METADATA, "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1")
# New copies one recipient may have made in an hour; a copy already made is
# served without counting.
COPIES_PER_HOUR = 300
# A lock older than the longest a copy may take was left by a dead worker.
STALE_LOCK_SECONDS = REMUX_TIMEOUT + 60

_DECODE_ERRORS = (pyvips.Error, OSError, ValueError, UnidentifiedImageError)


class CopyUnavailableError(Exception):
    """No copy now: being made too slowly, or the recipient made too many."""


def copies_root() -> str:
    return os.path.join(settings.MEDIA_ROOT, COPIES_DIR)


def owner_copies_dir(owner_id: int | None) -> str:
    return os.path.join(copies_root(), str(owner_id))


def copy_name(photo: Photo, original: str) -> str:
    """The copy's file name: the hash, ``.jpg`` for a still, a video's own
    extension (its container is kept)."""
    if photo.video:
        return photo.image_hash + (extension(original) or MP4_EXTENSION)
    return photo.image_hash + JPEG_EXTENSION


def _part_path(final: str) -> str:
    """A unique file beside ``final`` with the same extension, so ffmpeg and
    libvips pick the format from it and two writers never share one."""
    stem, suffix = os.path.splitext(final)
    return f"{stem}.{uuid.uuid4().hex}.part{suffix}"


def _write_still(source: str, part: str) -> None:
    image = decoding.full_size(source)
    image.write_to_file(part, Q=JPEG_QUALITY, keep="icc")


def _write_video(source: str, part: str) -> None:
    binaries.run_tool(
        "ffmpeg",
        [
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-i",
            source,
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-dn",
            "-sn",
            "-c",
            "copy",
            *VIDEO_NO_METADATA,
            part,
        ],
        timeout=REMUX_TIMEOUT,
    )


def _create(lock: str) -> bool:
    try:
        os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return True
    except FileExistsError:
        return False


def _is_stale(lock: str) -> bool:
    try:
        return time.time() - os.path.getmtime(lock) > STALE_LOCK_SECONDS
    except OSError:
        return True


def _take_lock(lock: str) -> bool:
    """Create ``lock``; False while another request holds it.

    A lock older than any copy takes was left by a dead worker: it is taken
    over once, and if that fails too the caller answers "try again later".
    """
    if _create(lock):
        return True
    if not _is_stale(lock):
        return False
    _remove(lock)
    return _create(lock)


def _hour() -> datetime.datetime:
    return timezone.now().replace(minute=0, second=0, microsecond=0)


def _allow_new_copy(owner_id: int | None, requester_id: int) -> bool:
    """Count one new copy of ``owner_id``'s photos for ``requester_id``; False
    past ``COPIES_PER_HOUR`` this hour.

    The count lives on the share row, so every worker process sees the same
    one. Two conditional updates, no read: one counts within the current
    hour, the other starts a new hour at one.
    """
    share = LibraryShare.objects.filter(
        owner_id=owner_id,  # owner-scope: the library the copy is of
        recipient_id=requester_id,
    )
    hour = _hour()
    counted = share.filter(copies_hour=hour, copies_made__lt=COPIES_PER_HOUR).update(
        copies_made=F("copies_made") + 1
    )
    if counted:
        return True
    if COPIES_PER_HOUR < 1:
        return False
    started = share.filter(
        Q(copies_hour__isnull=True) | Q(copies_hour__lt=hour)
    ).update(copies_hour=hour, copies_made=1)
    return bool(started)


def allow_album_copy(requester_id: int) -> bool:
    """Count one new copy for a reader through an album or a shared person
    (#464, #668); False past ``COPIES_PER_HOUR`` this hour.

    They have no library share row to count on, so the count is on their
    ``CopyBudget`` row, with the same two conditional updates as
    ``_allow_new_copy``: every worker process sees one count.
    """
    CopyBudget.objects.bulk_create(
        [CopyBudget(user_id=requester_id)], ignore_conflicts=True
    )
    budget = CopyBudget.objects.filter(user_id=requester_id)
    hour = _hour()
    counted = budget.filter(hour=hour, made__lt=COPIES_PER_HOUR).update(
        made=F("made") + 1
    )
    if counted:
        return True
    if COPIES_PER_HOUR < 1:
        return False
    started = budget.filter(Q(hour__isnull=True) | Q(hour__lt=hour)).update(
        hour=hour, made=1
    )
    return bool(started)


def _make(photo: Photo, original: str, final: str) -> str | None:
    part = _part_path(final)
    try:
        if photo.video:
            _write_video(original, part)
        else:
            _write_still(original, part)
        os.replace(part, final)
    except (binaries.ToolError, *_DECODE_ERRORS):
        logger.warning("Could not make a copy without metadata of %s", photo.image_hash)
        _remove(part)
        return None
    return final


def ensure_copy(
    photo: Photo,
    original: str,
    requester_id: int,
    allow_new: Callable[[], bool] | None = None,
) -> str | None:
    """The path of ``photo``'s copy without metadata, made now if missing.

    None when it cannot be made (an unreadable file, a codec the container
    cannot carry): the caller refuses rather than handing out the original.
    Raises ``CopyUnavailableError`` while another request is making it, or
    when ``requester_id`` made too many this hour: the view answers 503 with
    ``Retry-After`` at once instead of holding a worker. ``allow_new`` counts
    a new copy; by default on the library share of ``photo``'s owner.
    """
    final = os.path.join(owner_copies_dir(photo.owner_id), copy_name(photo, original))
    if os.path.exists(final):
        return final
    os.makedirs(os.path.dirname(final), exist_ok=True)
    lock = final + ".lock"
    if not _take_lock(lock):
        # Another request is making it: no worker waits for it.
        raise CopyUnavailableError(photo.image_hash)
    try:
        if os.path.exists(final):
            return final
        allowed = (
            allow_new()
            if allow_new is not None
            else _allow_new_copy(photo.owner_id, requester_id)
        )
        if not allowed:
            raise CopyUnavailableError(photo.image_hash)
        return _make(photo, original, final)
    finally:
        _remove(lock)


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def delete_copies(image_hash: str) -> None:
    """Remove the copies of ``image_hash`` (when its thumbnails go)."""
    pattern = os.path.join(
        glob.escape(copies_root()), "*", glob.escape(image_hash) + ".*"
    )
    for path in glob.glob(pattern):
        _remove(path)


def forget_owner_copies(owner_id: int) -> None:
    """Remove every copy of ``owner_id``'s photos: their last share ended."""
    shutil.rmtree(owner_copies_dir(owner_id), ignore_errors=True)


def forget_copies_after_last_share(
    sender: type[LibraryShare], instance: LibraryShare, using: str, **kwargs: object
) -> None:
    """When an owner's last library share goes, by the API or by a cascade
    (a deleted account), their copies go once the delete commits."""
    owner_id = instance.owner_id
    remaining = LibraryShare.objects.using(using).filter(
        owner_id=owner_id  # owner-scope: the deleted share's owner
    )
    if not remaining.exists():
        transaction.on_commit(partial(forget_owner_copies, owner_id), using=using)


def register() -> None:
    post_delete.connect(
        forget_copies_after_last_share,
        sender=LibraryShare,
        dispatch_uid="api.sharing.copies.forget_copies_after_last_share",
    )
