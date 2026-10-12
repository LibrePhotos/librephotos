"""The directory tree the folder picker browses (``/api/dirtree/``)."""

import logging
import os
from typing import TypedDict

from api.directory_watcher.utils import is_hidden

logger = logging.getLogger(__name__)


class PathNode(TypedDict):
    title: str
    absolute_path: str
    children: list["PathNode"]


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
