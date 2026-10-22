"""Leaving subfolders out of a library (#791).

A user may leave folders inside their library folders out of it, such as a
family member's trip in a shared folder. Scans and the walk of a scan of
chosen folders skip them (``api.directory_watcher.utils``), no "is this in
the library" check accepts a path below one (``api.photos.paths.Library``),
moves refuse them, and the photos already imported from them count as
outside the library (``api.photos.outside_library``): they stay until the
user moves them to the trash. Files on disk are never touched.

``set_excluded_folders`` checks and stores the folders, ``library_subfolders``
lists the folders of a library folder for the tree the user ticks them in.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from typing import TypedDict

from rest_framework.exceptions import NotFound, ValidationError

from api.directory_watcher.utils import skip_patterns
from api.models import User
from api.photos.library_folders import photo_counts
from api.photos.moves import MAX_LISTED_FOLDERS, visible_subfolders
from api.photos.paths import is_valid_path, library_of, library_roots

#: The most folders one library may leave out.
MAX_EXCLUDED_FOLDERS = 500

_FIELD = "excluded_folders"


def _refuse(message: str) -> ValidationError:
    return ValidationError({_FIELD: message})


def _spelled_from_root(path: str, root: str) -> str:
    """``path`` spelled from ``root`` as the scan spells the paths it finds.

    The scan joins the names it lists to the root as stored, so a prefix
    query only matches that spelling (``C:/data\\family`` on Windows).
    """
    relative = os.path.relpath(
        os.path.normpath(os.path.abspath(path)), os.path.normpath(os.path.abspath(root))
    )
    return os.path.join(root, relative)


def _checked(path: str, roots: list[str], upload_root: str) -> str:
    """``path`` as a folder ``roots`` may leave out, spelled from its root."""
    if "\x00" in path or not os.path.isabs(path):
        raise _refuse(f"{path!r} is not an absolute path.")
    root = next((root for root in roots if is_valid_path(path, root)), None)
    if root is None:
        raise _refuse(f"{path} is not in your library.")
    if is_valid_path(root, path):
        raise _refuse(f"{path} is a library folder: it cannot be left out of itself.")
    if is_valid_path(upload_root, path):
        raise _refuse(f"{path} holds your upload folder, which stays in the library.")
    return _spelled_from_root(path, root)


def normalize_excluded_folders(user: User, paths: Iterable[str]) -> list[str]:
    """The folders ``user`` may leave out of their library, from ``paths``.

    Each must lie strictly inside one of the user's library folders and not
    hold the upload folder; a folder inside another one given is dropped, as
    leaving out the outer one covers it. Raises ``ValidationError`` naming
    ``excluded_folders`` otherwise.
    """
    given = list(dict.fromkeys(paths))
    if len(given) > MAX_EXCLUDED_FOLDERS:
        raise _refuse(f"At most {MAX_EXCLUDED_FOLDERS} folders can be left out.")
    roots = library_roots(user)
    if given and not roots:
        raise _refuse("You have no library folder yet.")
    upload_root = user.upload_root()
    checked = sorted(
        (_checked(path, roots, upload_root) for path in given),
        key=lambda path: len(os.path.normpath(path)),
    )
    kept: list[str] = []
    for path in checked:
        if not any(is_valid_path(path, outer) for outer in kept):
            kept.append(path)
    return sorted(kept)


def set_excluded_folders(user: User, paths: Iterable[str]) -> list[str]:
    """Check ``paths`` and store them as the folders ``user`` leaves out."""
    user.excluded_folders = normalize_excluded_folders(user, paths)
    user.save(update_fields=["excluded_folders"])
    return list(user.excluded_folders)


class LibrarySubfolder(TypedDict):
    name: str
    path: str
    #: Left out itself; a folder inside a left-out one is not listed.
    excluded: bool
    has_subfolders: bool
    #: The user's photos in it and below it, outside the trash.
    photo_count: int


class SubfolderListing(TypedDict):
    path: str
    subfolders: list[LibrarySubfolder]
    truncated: bool


def library_subfolders(user: User, path: str) -> SubfolderListing:
    """The folders inside ``path``, a folder of ``user``'s library, for the tree.

    The scan's view of them: hidden folders and those ``SKIP_PATTERNS``
    names are not listed. 404 for a path outside the library or inside a
    folder already left out, so the listing tells nothing about other folders.
    """
    library = library_of(user)
    root = library.root_of(path)
    if root is None or library.is_excluded(path) or not os.path.isdir(path):
        raise NotFound("No such folder in your library.")
    skip_list = skip_patterns()
    children = visible_subfolders(path, root, skip_list)
    shown = children[:MAX_LISTED_FOLDERS]
    counts = photo_counts(user, shown)
    return SubfolderListing(
        path=path,
        subfolders=[
            LibrarySubfolder(
                name=os.path.basename(child),
                path=child,
                excluded=library.is_excluded(child),
                has_subfolders=bool(visible_subfolders(child, root, skip_list)),
                photo_count=count,
            )
            for child, count in zip(shown, counts)
        ],
        truncated=len(children) > MAX_LISTED_FOLDERS,
    )
