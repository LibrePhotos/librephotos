"""The directory tree the folder picker browses (``/api/dirtree/``)."""

import logging
import os
from collections.abc import Callable
from typing import TypedDict

from rest_framework.exceptions import ValidationError

from api.directory_watcher.utils import is_hidden
from api.drf.exceptions import Conflict
from api.photos.paths import is_valid_path

logger = logging.getLogger(__name__)


class PathNode(TypedDict):
    title: str
    absolute_path: str
    children: list[PathNode]


def list_subdirectories(path: str) -> list[str]:
    try:
        with os.scandir(path) as entries:
            children = [os.path.join(path, x) for x in entries]
    except OSError as e:
        # Directories the server is not allowed to read (e.g. folders owned by
        # another user on a network mount) are listed without children instead
        # of breaking the whole directory tree.
        logger.warning("Could not list directory %s: %s", path, e)
        return []
    return [x for x in children if os.path.isdir(x) and not is_hidden(x)]


def path_to_dict(path: str, recurse: int = 2) -> PathNode:
    d = PathNode(title=os.path.basename(path), absolute_path=path, children=[])
    if recurse > 0:
        d["children"] = [
            path_to_dict(x, recurse - 1) for x in list_subdirectories(path)
        ]
    else:
        d["children"] = []
    # sort children by title alphabetically (case insensitive)
    d["children"] = sorted(d["children"], key=lambda k: k["title"].lower())
    return d


#: Names Windows keeps for devices, with or without an extension (``CON.txt``):
#: a folder of that name cannot be made there, and is a trap when a library
#: moves between systems.
_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{n}" for n in range(1, 10)}
    | {f"LPT{n}" for n in range(1, 10)}
)
#: Characters Windows refuses in a name, or that separate paths or streams
#: (``:`` would name an NTFS stream, a backslash and ``/`` a subfolder).
_FORBIDDEN_CHARACTERS = frozenset('<>:"/\\|?*')
_MAX_NAME_LENGTH = 255


def _has_forbidden_character(name: str) -> bool:
    return any(ch in _FORBIDDEN_CHARACTERS or ord(ch) < 32 for ch in name)


#: Each rule a new folder's name must pass, with what to say when it does not.
_NAME_RULES: tuple[tuple[Callable[[str], bool], str], ...] = (
    (lambda name: name.strip() == "", "Enter a folder name."),
    (lambda name: name in (".", ".."), "A folder cannot be called '.' or '..'."),
    (
        _has_forbidden_character,
        'A folder name cannot contain / \\ : * ? " < > | or control characters.',
    ),
    (
        lambda name: name != name.strip() or name.endswith("."),
        "A folder name cannot start or end with a space, or end with a dot.",
    ),
    (
        lambda name: name.split(".", 1)[0].upper() in _RESERVED_NAMES,
        "That is a name Windows keeps for a device (CON, NUL, COM1, ...).",
    ),
    (
        lambda name: len(name) > _MAX_NAME_LENGTH,
        f"A folder name can have at most {_MAX_NAME_LENGTH} characters.",
    ),
)


def folder_name_problem(name: str) -> str | None:
    """Why ``name`` cannot be a new folder's name; None when it can.

    One folder, directly where it is created: no separators, no ``.`` or
    ``..``, nothing Windows refuses (reserved device names, ``<>:"|?*``,
    control characters, a trailing dot or space), so a library stays usable
    on every system it moves to.
    """
    for broken, problem in _NAME_RULES:
        if broken(name):
            return problem
    return None


def _real(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def resolves_inside(path: str, root: str) -> bool:
    """Whether ``path``, with every symlink followed, is ``root`` or inside it.

    ``is_valid_path`` compares spellings; a link inside the data root that
    points elsewhere passes it. This compares where both really are.
    """
    real_path, real_root = _real(path), _real(root)
    if real_path == real_root:
        return True
    prefix = real_root if real_root.endswith(os.sep) else real_root + os.sep
    return real_path.startswith(prefix)


def create_folder(parent: str, name: str, data_root: str) -> str:
    """Make the folder ``name`` in ``parent`` for the folder picker (#2035).

    ``parent`` has to be an existing folder inside ``data_root``, as written
    and with its symlinks followed, so a link cannot point the new folder
    outside. Returns the new folder's path, spelled like ``parent`` (not
    normalised: the picker's tree spells paths from the data root as
    configured, and finds the new folder by that spelling). A 400 for a
    bad name or parent or a folder the server may not write to, a 409 when
    the name is taken.
    """
    problem = folder_name_problem(name)
    if problem is not None:
        raise ValidationError({"name": problem}, code="invalid_folder_name")
    inside = (
        os.path.isabs(parent)
        and is_valid_path(parent, data_root)
        and resolves_inside(parent, data_root)
    )
    if not inside or not os.path.isdir(parent):
        raise ValidationError(
            {"parent_path": "Choose an existing folder inside the data root."},
            code="invalid_parent",
        )
    folder = os.path.join(parent, name)
    try:
        # No exist_ok and no parents: one new folder, never someone else's.
        os.mkdir(folder)
    except FileExistsError as error:
        raise Conflict(
            f"There is already a folder named {name} here.", code="folder_exists"
        ) from error
    except OSError as error:
        logger.warning("Could not create a folder (errno %s)", error.errno)
        raise ValidationError(
            f"LibrePhotos cannot create folders in {parent}. Check that the "
            "folder is writable for the LibrePhotos user.",
            code="folder_not_writable",
        ) from error
    return folder
