"""The files of a user's library that a scan may read on request.

A rescan of chosen photos (#2214), a scan of files an outside watcher names
(#900) and face detection in one folder (#524) all take paths or photos from
a request. Only what lies inside the user's own library is ever read; anything else is
left out, so a request cannot make the scan read a file of another user or
of the server. The library is every root of ``api.photos.paths.library_roots``:
the scan directory, the further library folders (#123) and the upload folder.
"""

import os
from collections.abc import Iterable
from typing import NamedTuple
from uuid import UUID

from api.models import Photo
from api.models.user import User
from api.photos.paths import Library, library_of

#: The most photos or paths one request may name. A bigger set is a library
#: scan: the Library page's Scan or Rescan.
MAX_REQUESTED = 1000


def in_library(user: User, path: str) -> bool:
    """Whether ``path`` is one of the user's library roots or lies inside one.

    One query: a caller checking many paths reads ``library_of`` once.
    """
    return library_of(user).contains(path)


def scannable_files(
    user: User, paths: Iterable[str], folders: bool = False
) -> tuple[list[str], list[str]]:
    """Split ``paths`` into the files a scan may read and the rest.

    Kept: existing files inside the user's library, each once, in the order
    given; with ``folders`` also existing folders inside it, which the scan
    walks (#2727). Left out: anything outside it, folders unless asked for,
    and paths that do not exist (any more).
    """
    return _split(library_of(user), paths, folders)


def _split(
    library: Library, paths: Iterable[str], folders: bool = False
) -> tuple[list[str], list[str]]:
    kept: dict[str, None] = {}
    ignored: list[str] = []
    for path in paths:
        if path not in kept and _scannable(library, path, folders):
            kept[path] = None
        else:
            ignored.append(path)
    return list(kept), ignored


def _scannable(library: Library, path: str, folders: bool) -> bool:
    """Whether ``path`` is an existing file (or, with ``folders``, folder) of the library."""
    if not library.contains(path):
        return False
    return os.path.isfile(path) or (folders and os.path.isdir(path))


class RescanTargets(NamedTuple):
    """What a rescan of chosen photos reads: the photos found and their files."""

    #: The requested photos that are the user's.
    found: int
    #: Those of them that have a file to read.
    photo_count: int
    #: Their files (the main file, variants and sidecars) that a scan may read.
    paths: list[str]


def _photo_paths(photo: Photo) -> list[str]:
    paths = [photo.main_file.path] if photo.main_file else []
    paths += [file.path for file in photo.files.all() if not file.missing]
    return paths


def rescan_targets(user: User, photo_ids: Iterable[UUID]) -> RescanTargets:
    """The files of the user's own photos among ``photo_ids`` that a scan may read.

    Someone else's photo counts as not found. A photo whose files are all
    gone or outside the library is left out.
    """
    photos = (
        Photo.objects.owned_by(user)
        .filter(pk__in=list(photo_ids))
        .select_related("main_file")
        .prefetch_related("files")
    )
    library = library_of(user)
    found = photo_count = 0
    paths: dict[str, None] = {}
    for photo in photos:
        found += 1
        kept, _ = _split(library, _photo_paths(photo))
        if kept:
            photo_count += 1
            paths.update(dict.fromkeys(kept))
    return RescanTargets(found, photo_count, list(paths))
