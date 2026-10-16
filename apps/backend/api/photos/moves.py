"""Moving a user's photos to another folder of their library (#352).

The owner moves their own photos within their own library folders
(``library_roots``: the scan directory and the upload folder). A target is
checked here (``resolve_target``) on its normalised path and on the path its
links resolve to, so neither ``..`` nor a link leads out of the library.
``preview_move`` says what a move would do, ``move_photos`` does it one photo
at a time through ``api.photos.files.move_photo_files``, and
``move_photos_job`` runs it as a job for a large selection.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

from django.db.models import Q

from api.directory_watcher.utils import is_hidden, should_skip, skip_patterns
from api.models import LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.models.user import User
from api.photos.files import (
    MoveError,
    MoveOutcome,
    OnConflict,
    files_to_move,
    free_destinations,
    is_taken,
    move_destinations,
    move_photo_files,
    path_key,
    photo_folder,
)
from api.photos.paths import (
    is_nextcloud_copy,
    is_valid_path,
    library_roots,
    nextcloud_media_root,
)

logger = logging.getLogger(__name__)

#: The most photos one move takes; a larger selection is a 400.
MOVE_LIMIT = 1000
#: Up to this many photos move within the request; more go to a job. Moving a
#: photo is a rename on one file system, a few milliseconds, but a copy when
#: the upload folder is on another disk: a hundred videos can take a minute.
SYNC_MOVE_LIMIT = 100

#: Why a photo of a selection does not move.
REFUSED_NEXTCLOUD = "nextcloud"
REFUSED_SHARED_FILE = "shared_file"
REFUSED_NOT_ON_DISK = "not_on_disk"
REFUSAL_REASONS = (REFUSED_NEXTCLOUD, REFUSED_SHARED_FILE, REFUSED_NOT_ON_DISK)

#: The jobs a move must not run beside: they read the paths a move changes.
SCAN_JOB_TYPES = (
    LongRunningJob.JOB_SCAN_PHOTOS,
    LongRunningJob.JOB_SCAN_MISSING_PHOTOS,
    LongRunningJob.JOB_DELETE_MISSING_PHOTOS,
    LongRunningJob.JOB_REPAIR_FILE_VARIANTS,
)


class InvalidTargetError(Exception):
    """The target folder is not one the user may move photos to.

    ``code`` is what the API answers (``no_library``, ``outside_library``,
    ``hidden_folder``, ``not_a_folder``).
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _within(path: str, root: str) -> bool:
    """``path`` inside ``root`` both as written and as its links resolve."""
    return is_valid_path(path, root) and is_valid_path(
        os.path.realpath(path), os.path.realpath(root)
    )


def root_of(user: User, path: str) -> str | None:
    """The library root of ``user`` that holds ``path``, or None."""
    for root in library_roots(user):
        if _within(path, root):
            return root
    return None


def _hidden_below(path: str, root: str) -> bool:
    """Whether a folder between ``root`` and ``path`` is one the scan skips."""
    relative = os.path.relpath(path, root)
    if relative == os.curdir:
        return False
    current = root
    for part in relative.split(os.sep):
        current = os.path.join(current, part)
        if part.startswith(".") or (os.path.exists(current) and is_hidden(current)):
            return True
    return should_skip(path)


def resolve_target(user: User, target_folder: str) -> str:
    """``target_folder`` as an absolute, normalised path inside ``user``'s library.

    It may not exist yet (the move creates it), but it may not be a file, be
    in a folder the scan skips (hidden, ``SKIP_PATTERNS``), or be in the
    folder the Nextcloud scan downloads to, which it overwrites.
    """
    if not library_roots(user):
        raise InvalidTargetError("no_library", "You have no library folder to move to.")
    if "\x00" in target_folder or not os.path.isabs(target_folder):
        raise InvalidTargetError(
            "outside_library", "The folder is not in your library."
        )
    target = os.path.normpath(os.path.abspath(target_folder))
    root = root_of(user, target)
    if root is None or _within(target, nextcloud_media_root()):
        raise InvalidTargetError(
            "outside_library", "The folder is not in your library."
        )
    if _hidden_below(target, root):
        raise InvalidTargetError(
            "hidden_folder", "The scan skips this folder: photos in it would be lost."
        )
    if os.path.lexists(target) and not os.path.isdir(target):
        raise InvalidTargetError("not_a_folder", "This is a file, not a folder.")
    return target


def refusal(photo: Photo) -> str | None:
    """Why ``photo`` cannot move, or None: one of ``REFUSAL_REASONS``.

    A local copy of a Nextcloud file is downloaded again to its old path, a
    file another photo also uses would move from under it, and a photo
    without its files on disk has nothing to move.
    """
    if photo.main_file is None or not files_to_move(photo):
        return REFUSED_NOT_ON_DISK
    file_ids = [photo.main_file.pk, *photo.files.values_list("pk", flat=True)]
    paths = photo.files.values_list("path", flat=True)
    if is_nextcloud_copy(photo.main_file.path) or any(
        is_nextcloud_copy(path) for path in paths
    ):
        return REFUSED_NEXTCLOUD
    shared = (
        Photo.objects.filter(Q(files__in=file_ids) | Q(main_file__in=file_ids))
        .exclude(pk=photo.pk)
        .exists()
    )
    return REFUSED_SHARED_FILE if shared else None


def scan_running(user: User) -> bool:
    """Whether a scan of ``user``'s library is queued or running."""
    return (
        LongRunningJob.objects.owned_by(user)
        .running()
        .filter(job_type__in=SCAN_JOB_TYPES)
        .exists()
    )


@dataclass(frozen=True)
class Clash:
    """A photo whose name is taken in the target folder."""

    photo_id: uuid.UUID
    name: str
    #: The name "Rename" gives it, or None when no free name was found.
    renamed_to: str | None


@dataclass
class MovePreview:
    """What moving a selection to a folder would do."""

    photos: int = 0
    files: int = 0
    unchanged: int = 0
    refused: dict[str, int] = field(default_factory=dict)
    clashes: list[Clash] = field(default_factory=list)


def _main_name(plan: dict[str, str], photo: Photo) -> str:
    assert photo.main_file is not None
    return os.path.basename(plan.get(photo.main_file.path, photo.main_file.path))


def _preview_photo(
    preview: MovePreview, photo: Photo, target: str, reserved: set[str]
) -> None:
    """Count ``photo`` into ``preview``; ``reserved`` holds the names taken so far."""
    reason = refusal(photo)
    if reason is not None:
        preview.refused[reason] = preview.refused.get(reason, 0) + 1
        return
    if path_key(photo_folder(photo)) == path_key(target):
        preview.unchanged += 1
        return
    sources = files_to_move(photo)
    plan = move_destinations(photo, sources, target)
    if any(path_key(d) in reserved or is_taken(d) for d in plan.values()):
        renamed = free_destinations(photo, sources, target, reserved)
        preview.clashes.append(
            Clash(
                photo.pk,
                _main_name(plan, photo),
                None if renamed is None else _main_name(renamed, photo),
            )
        )
        plan = renamed or {}
    reserved.update(path_key(dest) for dest in plan.values())
    preview.photos += 1
    preview.files += len(sources)


def preview_move(photos: Iterable[Photo], target: str) -> MovePreview:
    """What ``move_photos(photos, target, ...)`` would do, changing nothing.

    Names are checked in the order the photos move, so two photos of the
    selection with one name clash with each other too.
    """
    preview = MovePreview()
    reserved: set[str] = set()
    for photo in photos:
        _preview_photo(preview, photo, target, reserved)
    return preview


@dataclass
class MoveResult:
    """What ``move_photos`` did, in photos."""

    moved: int = 0
    skipped: int = 0
    unchanged: int = 0
    refused: int = 0
    failed: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "moved": self.moved,
            "skipped": self.skipped,
            "unchanged": self.unchanged,
            "refused": self.refused,
            "failed": self.failed,
        }


def _move_one(
    result: MoveResult, photo: Photo, target: str, on_conflict: OnConflict
) -> None:
    if refusal(photo) is not None:
        result.refused += 1
        return
    try:
        outcome = move_photo_files(photo, target, on_conflict)
    except MoveError as error:
        logger.warning("photo %s was not moved: %s", photo.image_hash, error)
        result.failed += 1
        return
    if outcome is MoveOutcome.MOVED:
        result.moved += 1
    elif outcome is MoveOutcome.SKIPPED:
        result.skipped += 1
    else:
        result.unchanged += 1


def move_photos(
    photos: Iterable[Photo],
    target: str,
    on_conflict: OnConflict,
    progress: Callable[[int], None] | None = None,
) -> MoveResult:
    """Move each of ``photos`` into ``target`` (made if missing), one after the other.

    ``target`` comes from ``resolve_target``. A photo that cannot move is
    counted, not raised: one locked file does not stop the rest.
    ``progress`` gets the number of photos handled after each; an exception
    it raises (a job's cancel) stops the loop.
    """
    os.makedirs(target, exist_ok=True)
    result = MoveResult()
    for done, photo in enumerate(photos, start=1):
        _move_one(result, photo, target, on_conflict)
        if progress is not None:
            progress(done)
    return result


def photos_to_move(user: User, photo_ids: Sequence[uuid.UUID]) -> list[Photo]:
    """``user``'s own photos among ``photo_ids``, in the order they move."""
    return list(
        Photo.objects.owned_by(user)
        .filter(pk__in=photo_ids)
        .select_related("main_file")
        .order_by("main_file__path", "pk")
    )


def move_photos_job(
    user: User,
    photo_ids: list[uuid.UUID],
    target: str,
    on_conflict: OnConflict,
    job_id: uuid.UUID | str | None = None,
) -> None:
    """The "Move Photos" job: ``move_photos`` with progress and cancel.

    The target is checked again: the library folders may have changed
    since the request. A cancel stops after the photo the job is on; the
    photos moved until then stay moved.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_MOVE_PHOTOS, job_id)
    if job is None:
        return
    try:
        target = resolve_target(user, target)
    except InvalidTargetError as error:
        job.fail(error=str(error))
        return
    photos = photos_to_move(user, photo_ids)
    job.update_progress(0, len(photos))

    def report(done: int) -> None:
        job.update_progress(done)
        job.stop_if_cancelled()

    try:
        result = move_photos(photos, target, on_conflict, progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    job.complete(result=result.as_dict())


#: The most subfolders a folder listing returns; ``truncated`` says when more exist.
MAX_LISTED_FOLDERS = 500


@dataclass(frozen=True)
class LibraryFolder:
    """A folder the move picker shows."""

    name: str
    path: str
    has_subfolders: bool


@dataclass
class FolderListing:
    """The folders inside ``path`` (None: the library roots themselves)."""

    path: str | None
    folders: list[LibraryFolder]
    truncated: bool = False


def _visible_subfolders(path: str, root: str, skip_list: list[str]) -> list[str]:
    """The folders in ``path`` the scan walks into and that stay inside ``root``.

    ``skip_list`` is the parsed ``SKIP_PATTERNS`` (``skip_patterns``).
    """
    try:
        with os.scandir(path) as entries:
            names = [entry.name for entry in entries if entry.is_dir()]
    except OSError as error:
        logger.warning("could not list a library folder: %s", error.strerror)
        return []
    nextcloud = nextcloud_media_root()
    found = []
    for name in sorted(names, key=str.lower):
        child = os.path.join(path, name)
        if name.startswith(".") or is_hidden(child) or should_skip(child, skip_list):
            continue
        if _within(child, root) and not _within(child, nextcloud):
            found.append(child)
    return found


def _folder(path: str, root: str, skip_list: list[str]) -> LibraryFolder:
    return LibraryFolder(
        # A drive or share root has no last part: its path is its name.
        name=os.path.basename(path) or path,
        path=path,
        has_subfolders=bool(_visible_subfolders(path, root, skip_list)),
    )


def library_folders(user: User, path: str | None = None) -> FolderListing:
    """The folders of ``user``'s library inside ``path``, for the move picker.

    Without ``path``, the library roots that exist. ``path`` is checked as a
    move target is (``resolve_target``) before anything about it is read,
    so the listing tells nothing about folders outside the library.
    """
    skip_list = skip_patterns()
    if path is None:
        roots = [root for root in library_roots(user) if os.path.isdir(root)]
        return FolderListing(None, [_folder(root, root, skip_list) for root in roots])
    folder = resolve_target(user, path)
    if not os.path.isdir(folder):
        raise InvalidTargetError("not_a_folder", "The folder does not exist.")
    root = root_of(user, folder)
    assert root is not None  # resolve_target found it
    children = _visible_subfolders(folder, root, skip_list)
    return FolderListing(
        folder,
        [_folder(child, root, skip_list) for child in children[:MAX_LISTED_FOLDERS]],
        truncated=len(children) > MAX_LISTED_FOLDERS,
    )
