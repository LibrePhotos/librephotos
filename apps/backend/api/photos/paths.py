"""Where a path lies: inside a user's root, and the files of a folder.

``is_valid_path`` keeps a requested path inside a scan root; ``folder_path_q``
selects the files recorded below a folder without picking up its siblings;
``is_nextcloud_copy`` tells a file the Nextcloud scan downloaded;
``library_roots`` names the folders a user's library lives in, and
``library_of`` reads them, with the folders left out of it, once for a run
of checks.
"""

from __future__ import annotations

import os
import os.path
import re
from dataclasses import dataclass
from types import ModuleType
from typing import TYPE_CHECKING

from django.conf import settings
from django.db.models import Q

from api.models.library_folder import LibraryFolder

if TYPE_CHECKING:
    from api.models.user import User


def nextcloud_media_root() -> str:
    """``DATA_ROOT/nextcloud_media``, below which the Nextcloud scan downloads.

    Each user gets a directory of their own in it
    (``nextcloud.directory_watcher.user_media_root``).
    """
    return os.path.join(settings.DATA_ROOT, "nextcloud_media")


def is_nextcloud_copy(path: str) -> bool:
    """Whether ``path`` is a local copy of a file on a Nextcloud server.

    Such a copy is overwritten by the next download of its file, and nothing
    is ever uploaded back, so an edit written into it would be lost.
    """
    root = nextcloud_media_root()
    return is_valid_path(path, root) and not is_valid_path(root, path)


def library_folder_paths(user: User) -> list[str]:
    """The further library folders of ``user`` (#123), in path order."""
    if user.pk is None:
        return []
    paths = LibraryFolder.objects.owned_by(user).order_by("path")
    return list(paths.values_list("path", flat=True))


def library_roots(user: User) -> list[str]:
    """The folders ``user``'s library lives in, absolute.

    The scan directory (the main folder) first, then the further library
    folders an admin added (#123), then the upload folder when it is set
    outside all of them (``User.upload_root``). Empty for a user without a
    scan directory. Scans, moves (#352) and every "is this in the library"
    check go by these. One query, for the further folders.

    Each is spelled as it is stored, which is how the scan spelled the paths
    it recorded below it (``C:/data\\2024`` on Windows): a prefix query such
    as ``folder_path_q`` only matches that spelling. ``is_valid_path``
    normalises both sides, so containment checks do not depend on it.
    """
    if not user.scan_directory:
        return []
    roots = [user.scan_directory, *library_folder_paths(user)]
    upload_root = user.upload_root()
    if not any(is_valid_path(upload_root, root) for root in roots):
        roots.append(upload_root)
    return roots


@dataclass(frozen=True)
class Library:
    """Where a user's library lies, read once for a run of path checks."""

    #: ``library_roots``: the main folder first.
    roots: tuple[str, ...]
    #: Folders inside the roots the user left out (#791).
    excluded: tuple[str, ...] = ()

    def root_of(self, path: str) -> str | None:
        """The root holding ``path`` (or equal to it), or None, left out or not."""
        return next((root for root in self.roots if is_valid_path(path, root)), None)

    def is_excluded(self, path: str) -> bool:
        """Whether ``path`` is a left-out folder or lies inside one."""
        return any(is_valid_path(path, folder) for folder in self.excluded)

    def contains(self, path: str) -> bool:
        """Whether ``path`` is in the library: in a root, and not left out."""
        return self.root_of(path) is not None and not self.is_excluded(path)


def excluded_folders(user: User) -> list[str]:
    """The folders ``user`` left out of their library (#791)."""
    stored = user.excluded_folders
    if not isinstance(stored, list):
        return []
    return [path for path in stored if isinstance(path, str) and path]


def library_of(user: User) -> Library:
    """``user``'s library: its roots and left-out folders, read once."""
    return Library(tuple(library_roots(user)), tuple(excluded_folders(user)))


def is_valid_path(path: str, root_path: str) -> bool:
    """Return True when ``path`` is ``root_path`` itself or lies inside it.

    Both paths are made absolute and normalised first, so ``..`` segments
    cannot climb out of the root, and on Windows mixed separators and letter
    case do not matter. The root is compared with exactly one trailing
    separator: that keeps a sibling sharing the root's prefix (``/data/alice2``
    against ``/data/alice``) out, while a root that already ends in a
    separator (``/``, ``D:\\``) or has no root component (a UNC share such as
    ``\\\\nas\\photos``) still admits its children.
    """
    return _is_within(path, root_path, os.path)


def _is_within(path: str, root_path: str, pathmod: ModuleType) -> bool:
    # pathmod is os.path in production; tests pass ntpath/posixpath to pin the
    # Windows and POSIX behaviour on whichever OS runs the suite.
    abs_path = pathmod.normcase(pathmod.abspath(path))
    abs_root = pathmod.normcase(pathmod.abspath(root_path))

    if abs_path == abs_root:
        return True

    sep = pathmod.sep
    root_prefix = abs_root if abs_root.endswith(sep) else abs_root + sep
    return abs_path.startswith(root_prefix)


def path_label(path: str, root_path: str | None) -> str:
    """*path* as the owner sees it: below their library folder, else the file name.

    Shown in place of an absolute server path (the All metadata view, #2277):
    ``2024/summer/IMG_1.jpg`` with forward slashes for a file inside
    *root_path*, ``IMG_1.jpg`` for one outside it or without a root.
    """
    if (
        root_path
        and is_valid_path(path, root_path)
        and not is_valid_path(root_path, path)
    ):
        relative = os.path.relpath(os.path.abspath(path), os.path.abspath(root_path))
        return relative.replace(os.sep, "/")
    return os.path.basename(path)


#: A drive-letter path (``C:\x``, ``C:/x``, ``C:``) or a UNC path (``\\host\share``).
_WINDOWS_PATH = re.compile(r"^(?:[A-Za-z]:(?:[\\/]|$)|\\\\)")


def folder_path_prefixes(folder_path: str) -> tuple[str, ...]:
    r"""Return the prefixes that match files stored inside ``folder_path``.

    A bare ``path__startswith=folder_path`` also matches a sibling whose name
    merely starts with it, so ``/photos/test`` picks up ``/photos/test2`` as
    well. Anchoring on a trailing separator keeps a folder to its own files,
    while still matching anything nested below it.

    These are paths recorded in the database by whichever host ran the scan,
    so the separator comes from the path rather than from ``os.sep``. A POSIX
    path only ever uses ``/`` (a backslash there is part of a file name). A
    Windows path can mix both, as in ``C:/data\test``, because
    ``os.path.join`` adds a backslash to whatever the configured root used, so
    a child may follow either separator.
    """
    stripped = folder_path.rstrip("/\\")
    if _WINDOWS_PATH.match(folder_path) or (
        "\\" in stripped and not stripped.startswith("/")
    ):
        return (stripped + "\\", stripped + "/")
    return (stripped + "/",)


def folder_path_q(lookup: str, folder_path: str) -> Q:
    """``Q`` matching ``<lookup>__startswith`` any prefix of ``folder_path``."""
    query = Q()
    for prefix in folder_path_prefixes(folder_path):
        query |= Q(**{f"{lookup}__startswith": prefix})
    return query
