from __future__ import annotations

import enum
import logging
import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Protocol

from django.db import models

from api.directory_watcher import handle_new_image
from api.directory_watcher.scan_jobs import remember_import_followups
from api.directory_watcher.utils import finish_job_if_complete
from api.models import File, LongRunningJob, Photo, User
from api.models.long_running_job import JobCancelledError
from api.photos.media_files import is_metadata, is_raw
from api.photos.paths import folder_path_q, nextcloud_media_root
from nextcloud.server_address import connect

if TYPE_CHECKING:
    import owncloud

logger = logging.getLogger(__name__)


class _RemoteFile(Protocol):
    """The part of a pyocclient ``FileInfo`` the scan reads."""

    path: str
    attributes: Mapping[str, str]

    def is_dir(self) -> bool: ...


def isValidNCMedia(file_obj: _RemoteFile) -> bool:
    """Tell whether a remote file is something librephotos can index.

    A remote file is only known by its WebDAV metadata, so the decision is made
    on the ``{DAV:}getcontenttype`` and - for the formats nextcloud has no mime
    type for, most notably camera raw - on the file name. What is accepted here
    mirrors what the local directory watcher indexes
    (``api.photos.media_files.is_valid_media``): images, videos, raw files and xmp
    sidecars. Anything narrower silently drops whole nextcloud folders.
    """
    try:
        file_attr = file_obj.attributes
        filetype = file_attr.get("{DAV:}getcontenttype") or ""
        if filetype.startswith("image/") or filetype.startswith("video/"):
            return True
        if is_raw(file_obj.path) or is_metadata(file_obj.path):
            return True
        logger.info(
            "Skipping %s, because '%s' is not a media type", file_obj.path, filetype
        )
        return False
    except Exception:
        logger.exception("An image thrown an exception")
        return False


def collect_photos(nc: owncloud.Client, path: str, photos: list[_RemoteFile]) -> None:
    for x in nc.list(path):
        if not x.is_dir() and isValidNCMedia(x):
            photos.append(x)
        elif x.is_dir():
            collect_photos(nc, x.path, photos)


def remote_mtime(file_obj: _RemoteFile) -> float | None:
    """The remote file's ``{DAV:}getlastmodified`` as a POSIX timestamp."""
    value = file_obj.attributes.get("{DAV:}getlastmodified")
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).timestamp()
    except TypeError, ValueError:
        return None


def remote_size(file_obj: _RemoteFile) -> int | None:
    """The remote file's ``{DAV:}getcontentlength`` in bytes."""
    try:
        return int(file_obj.attributes.get("{DAV:}getcontentlength") or "")
    except ValueError:
        return None


class LocalCopy(enum.Enum):
    """How a local copy compares with its remote file."""

    MISSING = "missing"
    CHANGED = "changed"
    RETIMED = "retimed"
    CURRENT = "current"


def compare_local_copy(local_path: str, file_obj: _RemoteFile) -> LocalCopy:
    """How the local copy compares with the remote file now (#2258).

    A download takes the remote modification time, so a copy whose mtime is
    older than the remote one, or whose size differs, was changed on the
    server since. A copy newer than the remote file was downloaded before
    downloads kept the remote time: it gets that time now (RETIMED), which is
    what a "File modified time" date rule reads.
    """
    try:
        stat = os.stat(local_path)
    except OSError:
        return LocalCopy.MISSING
    size = remote_size(file_obj)
    if size is not None and stat.st_size != size:
        return LocalCopy.CHANGED
    mtime = remote_mtime(file_obj)
    if mtime is None or int(stat.st_mtime) == int(mtime):
        return LocalCopy.CURRENT
    if stat.st_mtime < mtime:
        return LocalCopy.CHANGED
    os.utime(local_path, (mtime, mtime))
    return LocalCopy.RETIMED


def user_media_root(user: User) -> str:
    """The directory a user's Nextcloud files are downloaded into."""
    base = nextcloud_media_root()
    root = os.path.join(base, user.username)
    if os.path.dirname(os.path.normpath(root)) != os.path.normpath(base):
        raise ValueError(
            f"User name {user.username!r} does not make a directory of its own"
        )
    return root


def local_path_for(root: str, remote_path: str) -> str | None:
    """Map a remote path to its download location, or None if that leaves root.

    Remote paths come from the server's WebDAV listing, so a server that answers
    with ``..`` segments or an absolute path must not be able to write anywhere
    but below ``root``. Containment is checked on the resolved paths, so a
    symlink inside ``root`` cannot lead outside it either.
    """
    relative = remote_path.lstrip("/\\")
    if not relative:
        return None
    candidate = os.path.normpath(os.path.join(root, relative))
    try:
        real_root = os.path.realpath(root)
        real_candidate = os.path.realpath(candidate)
        inside = (
            os.path.commonpath([real_root, real_candidate]) == real_root
            and real_candidate != real_root
        )
    except ValueError, OSError:
        return None
    return candidate if inside else None


def download(
    nc: owncloud.Client,
    remote_path: str,
    local_path: str,
    mtime: float | None = None,
) -> bool:
    """Download to a temporary file next to ``local_path``, then move it there.

    ``local_path`` only ever appears complete, so an interrupted download is
    fetched again by the next scan instead of being kept as a truncated file.
    It gets the remote modification time ``mtime``, which tells the next scan
    whether the remote file changed since. Returns whether the file was
    downloaded.
    """
    local_dir = os.path.dirname(local_path)
    os.makedirs(local_dir, exist_ok=True)
    temp_path = os.path.join(local_dir, f".nextcloud-{uuid.uuid4().hex}.part")
    try:
        if not nc.get_file(remote_path, temp_path) or not os.path.isfile(temp_path):
            return False
        if mtime is not None:
            os.utime(temp_path, (mtime, mtime))
        os.replace(temp_path, local_path)
        return True
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def indexed_paths(user: User, root: str) -> set[str]:
    """The paths below ``root`` that already belong to one of the user's photos.

    A file is indexed once it is a photo's main file or one of its files (a
    RAW variant, a sidecar), the rule ``create_new_image`` reuses a photo by.
    A file flagged missing is not: it is attached again when it comes back.
    """
    photos = Photo.objects.owned_by(user)
    return set(
        File.objects.filter(folder_path_q("path", root), missing=False)
        .filter(models.Q(photo__in=photos) | models.Q(main_photo__in=photos))
        .values_list("path", flat=True)
    )


@dataclass
class _SyncResult:
    """What one pass over the remote listing found to do."""

    to_process: list[str] = field(default_factory=list)
    changed_sidecars: list[str] = field(default_factory=list)
    listed: set[str] = field(default_factory=set)


def _sync_local_copies(
    nc: owncloud.Client,
    root: str,
    remote_files: list[_RemoteFile],
    indexed: set[str],
) -> _SyncResult:
    """Download what is new or changed, and say which files need processing."""
    result = _SyncResult()
    for remote in remote_files:
        local_path = local_path_for(root, remote.path)
        if local_path is None:
            logger.warning(
                "Skipping Nextcloud file %r: it would be stored outside %s",
                remote.path,
                root,
            )
            continue
        result.listed.add(local_path)
        state = compare_local_copy(local_path, remote)
        if state is LocalCopy.CURRENT and local_path in indexed:
            continue
        if state in (LocalCopy.CURRENT, LocalCopy.RETIMED):
            # Not indexed yet, or dated by the download day until now.
            result.to_process.append(local_path)
            continue
        replaced = state is LocalCopy.CHANGED
        if not download(nc, remote.path, local_path, remote_mtime(remote)):
            logger.warning("Nextcloud did not return %r, skipping it", remote.path)
            continue
        logger.info("Downloaded photo from nextcloud to %s", local_path)
        result.to_process.append(local_path)
        if replaced and is_metadata(local_path):
            result.changed_sidecars.append(local_path)
    return result


def _photos_described_by(user: User, sidecars: list[str]) -> list[str]:
    """The main files of the user's photos that hold one of ``sidecars``.

    Handling a sidecar only attaches it; the photo it describes reads it when
    it is processed, so a changed sidecar has its photo processed again.
    """
    if not sidecars:
        return []
    return sorted(
        {
            path
            for path in Photo.objects.owned_by(user)
            .filter(files__path__in=sidecars)
            .values_list("main_file__path", flat=True)
            if path
        }
    )


def detach_deleted_files(user: User, scope: str, listed: set[str]) -> int:
    """Flag the user's files below ``scope`` that the server no longer lists.

    As a local scan does for a file gone from disk (``detach_missing_files``):
    the file leaves its photos' files and is flagged missing, so the photo
    shows up under "Remove missing photos". The local copy and the photo stay;
    removing them is the user's call. Returns how many files were flagged.
    """
    photos = Photo.objects.owned_by(user)
    gone = sorted(indexed_paths(user, scope) - listed)
    for start in range(0, len(gone), 500):
        for file in File.objects.filter(path__in=gone[start : start + 500]):
            for photo in photos.filter(files=file):
                photo.files.remove(file)
                photo.save(update_fields=["last_modified"])
            file.missing = True
            file.save(update_fields=["missing"])
    if gone:
        logger.info("%d Nextcloud files are gone from the server", len(gone))
    return len(gone)


def scan_photos(user: User, job_id: uuid.UUID | str) -> dict[str, bool]:
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_SCAN_PHOTOS, job_id)
    if lrj is None:
        return {"status": False}

    # Everything the scan does - logging in, listing the remote directory and
    # downloading the photos included - has to happen inside the try, otherwise
    # a failure (rejected app password, unreachable server, missing scan
    # directory) leaves the job at finished=False forever and blocks the queue
    # for every other job.
    try:
        root = user_media_root(user)
        nc = connect(user)

        remote_files: list[_RemoteFile] = []
        collect_photos(nc, user.nextcloud_scan_directory, remote_files)

        # Only new and changed files are handed on: every one of them is
        # processed in full, and an unchanged indexed file has nothing new to
        # give (#2257, #2258).
        synced = _sync_local_copies(nc, root, remote_files, indexed_paths(user, root))
        paths = sorted(synced.to_process)
        paths += [
            path
            for path in _photos_described_by(user, synced.changed_sidecars)
            if path not in paths
        ]

        scope = local_path_for(root, user.nextcloud_scan_directory) or root
        detach_deleted_files(user, scope, synced.listed)

        # The target goes first: handle_new_image counts each file and
        # finishes the job at the target, which queues the scan's follow-ups
        # (tags, places, search embeddings and the index, faces).
        remember_import_followups(lrj, user)
        lrj.update_progress(current=0, target=len(paths))
        for idx, image_path in enumerate(paths):
            lrj.stop_if_cancelled()
            logger.info("begin handling of photo %d/%d", idx + 1, len(paths))
            handle_new_image(user, image_path, job_id)

        logger.info("Added %s photos", len(paths))
        # With nothing to import the job is at its target already: finish it,
        # and queue the follow-ups, as a local scan with nothing new does.
        finish_job_if_complete(job_id)
    except JobCancelledError:
        logger.info("Nextcloud scan job %s was cancelled", lrj.job_id)
        return {"status": False}
    except Exception as e:
        logger.exception(str(e))
        lrj.fail(error=e)
        return {"status": False}
    return {"status": True}
