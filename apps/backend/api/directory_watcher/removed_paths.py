"""Detach the files an outside process says were deleted or moved away (#2728).

``POST /api/scan-files/`` takes them as ``removed_paths``. Each one must lie
inside the requester's library and be gone from disk; it names the file of
one of the requester's photos recorded at that path, or, when there is none,
every such file below it (a folder deleted or moved away whole is reported
once). Those files are detached and flagged missing the way the missing-file
check after a library scan does it (``scan_jobs.scan_missing_photos``), with
the same guards: nothing changes while the library root looks unmounted, or
when too much of the library would lose all its files; and a file whose
exact copy is still on disk is taken over by the copy instead (#2417).
"""

import os
from collections.abc import Iterable
from typing import NamedTuple
from uuid import UUID

from api.directory_watcher.missing_guard import library_root_problem, too_many_missing
from api.models import File, Photo, User
from api.photos import paths as photo_paths
from api.photos.files import detach_missing_files, missing_files
from api.photos.library_files import in_library

#: Photos are loaded this many named files at a time.
_BATCH = 500


class Removal(NamedTuple):
    """What a request to forget removed paths would change."""

    #: Photo id -> the photo and its named files that are gone.
    gone: dict[UUID, tuple[Photo, list[File]]]
    #: The named paths that are not used: still on disk, outside the
    #: library, repeats, or naming no file of the requester's photos.
    ignored: list[str]
    #: Why nothing may change (the library looks unmounted), or None.
    problem: str | None
    #: Whether a named path matched a file of the requester's photos.
    matched: bool


def plan_removal(user: User, paths: Iterable[str]) -> Removal:
    """Find what ``paths`` remove from ``user``'s photos, changing nothing yet.

    The one change made here is the copy takeover of ``missing_files``.
    """
    candidates, ignored = _removed_candidates(user, paths)
    problem = _roots_problem(user, candidates)
    if problem is not None:
        return Removal({}, ignored, problem, False)
    named, unmatched = _named_file_paths(user, candidates)
    gone = _gone_files(user, named)
    return Removal(gone, ignored + unmatched, _too_many(user, gone), bool(named))


def detach_removed(removal: Removal) -> int:
    """Detach the files ``removal`` found gone; the number detached."""
    for photo, files in removal.gone.values():
        detach_missing_files(photo, files)
    return sum(len(files) for _, files in removal.gone.values())


def _removed_candidates(
    user: User, paths: Iterable[str]
) -> tuple[list[str], list[str]]:
    """Split ``paths`` into those gone from the library, each once, and the rest."""
    candidates: dict[str, None] = {}
    ignored: list[str] = []
    for path in paths:
        if path in candidates or not in_library(user, path) or os.path.exists(path):
            ignored.append(path)
        else:
            candidates[path] = None
    return list(candidates), ignored


def _roots_problem(user: User, candidates: list[str]) -> str | None:
    """Why a library root holding one of ``candidates`` looks unmounted, or None."""
    roots = photo_paths.library_roots(user)
    for root in roots:
        if any(photo_paths.is_valid_path(path, root) for path in candidates):
            problem = library_root_problem(user, root)
            if problem is not None:
                return problem
    return None


def _named_file_paths(user: User, candidates: list[str]) -> tuple[set[str], list[str]]:
    """The paths of the user's photos' files that ``candidates`` name.

    Also returns the candidates that name none. A candidate names the file at
    that path or, without one, every file below it. Only files still attached
    to a photo count: one detached before is not named again.
    """
    files = File.objects.filter(photo__in=Photo.objects.owned_by(user))
    named = set(files.filter(path__in=candidates).values_list("path", flat=True))
    unmatched: list[str] = []
    for path in candidates:
        if path in named:
            continue
        below = files.filter(photo_paths.folder_path_q("path", path))
        found = set(below.values_list("path", flat=True))
        if not found:
            unmatched.append(path)
        named |= found
    # The library check again, on what the database holds.
    return {path for path in named if in_library(user, path)}, unmatched


def _gone_files(user: User, named: set[str]) -> dict[UUID, tuple[Photo, list[File]]]:
    """The user's photos holding a file of ``named``, and those of them that are gone."""
    ordered = sorted(named)
    seen: set[UUID] = set()
    gone: dict[UUID, tuple[Photo, list[File]]] = {}
    for start in range(0, len(ordered), _BATCH):
        photos = (
            Photo.objects.owned_by(user)
            .filter(files__path__in=ordered[start : start + _BATCH])
            .distinct()
            .prefetch_related("files")
        )
        for photo in photos:
            if photo.pk in seen:
                continue
            seen.add(photo.pk)
            files = missing_files(photo, among=named)
            if files:
                gone[photo.pk] = (photo, files)
    return gone


def _too_many(user: User, gone: dict[UUID, tuple[Photo, list[File]]]) -> str | None:
    """Why detaching ``gone`` would remove too much of the library, or None."""
    would_lose_all = sum(
        len(files) == len(photo.files.all()) for photo, files in gone.values()
    )
    if not would_lose_all:
        return None
    photos_with_files = (
        Photo.objects.owned_by(user).filter(files__isnull=False).distinct().count()
    )
    return too_many_missing(would_lose_all, photos_with_files)
