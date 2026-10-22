"""The folders of a user's library, as the Library page and the user dialog list them (#123).

A library is the scan directory (the main folder), the further folders an
admin adds (``LibraryFolder``) and the upload folder when it is set outside
them (``api.photos.paths.library_roots``). Each is listed with how many of
the user's photos it holds and whether it can be read now: a folder on a
disk that is unplugged is skipped by the scan, and its photos are not
flagged missing (``api.directory_watcher.missing_guard``).

Removing a further folder keeps its photos: they are outside the library
then, and the admin can move them to the user's trash
(``api.photos.outside_library``).
"""

from __future__ import annotations

from typing import Literal, TypedDict

from django.db.models import Count

from api.accounts.directories import normalize_library_folder
from api.directory_watcher.missing_guard import library_root_problem
from api.models import LibraryFolder, Photo, User
from api.photos.paths import folder_path_q, library_roots, normalised_path

#: The main folder (the scan directory), a further folder, the upload folder.
FolderKind = Literal["main", "folder", "upload"]


class LibraryFolderEntry(TypedDict):
    #: The ``LibraryFolder`` id of a further folder; None for the other two.
    id: int | None
    path: str
    kind: FolderKind
    #: Whether the folder can be read now (it exists and does not look unmounted).
    available: bool
    #: The user's photos whose main file is in it, outside the trash.
    photo_count: int


def _photo_counts(user: User, roots: list[str]) -> list[int]:
    """The user's photos below each of ``roots``, outside the trash, in one query."""
    if not roots:
        return []
    aggregates = {
        f"count_{index}": Count("pk", filter=folder_path_q("main_file__path", root))
        for index, root in enumerate(roots)
    }
    counts = (
        Photo.objects.owned_by(user)
        .filter(in_trashcan=False, removed=False)
        .aggregate(**aggregates)
    )
    return [counts[f"count_{index}"] or 0 for index in range(len(roots))]


def _kind(index: int, root: str, folder_ids: dict[str, int]) -> FolderKind:
    if index == 0:
        return "main"
    return "folder" if root in folder_ids else "upload"


def library_folder_entries(user: User) -> list[LibraryFolderEntry]:
    """Every folder of ``user``'s library, the main folder first."""
    roots = library_roots(user)
    folder_ids = {
        normalised_path(path): pk
        for pk, path in LibraryFolder.objects.owned_by(user).values_list("pk", "path")
    }
    counts = _photo_counts(user, roots)
    entries: list[LibraryFolderEntry] = []
    for index, (root, count) in enumerate(zip(roots, counts)):
        kind = _kind(index, root, folder_ids)
        label = "The scan directory" if kind == "main" else "The library folder"
        entries.append(
            LibraryFolderEntry(
                id=folder_ids.get(root) if kind == "folder" else None,
                path=root,
                kind=kind,
                available=library_root_problem(user, root, label) is None,
                photo_count=count,
            )
        )
    return entries


def add_library_folder(user: User, path: str) -> LibraryFolder:
    """Add ``path`` to ``user``'s library; ``ValidationError`` when it cannot be."""
    abs_path = normalize_library_folder(path, user)
    return LibraryFolder.objects.create(owner=user, path=abs_path)
