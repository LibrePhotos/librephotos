"""Keep a scan of an unmounted library from flagging every photo missing (#2195).

When a library's mount is gone but its mount point is still there (a Docker
bind mount whose host folder is missing, a dropped NFS/SMB share, an unplugged
disk), the scan directory reads as empty. The missing-file check would then
detach every file, and "Remove missing photos" delete the whole library.

Two checks: the scan directory must be readable, and not empty while the user
has photos in it; and the missing-file check changes nothing when more than
``SCAN_MISSING_MAX_FRACTION`` of the photos (and more than
``MISSING_PHOTOS_FLOOR``) would lose all their files. An admin sets the
fraction to 1 to let a user who really removed their library clear it.

A file whose own path is gone but whose exact copy is on disk (#2417) is not
missing, so its photo does not count towards that fraction
(``api.photos.files.missing_files``).
"""

import logging
import os

from constance import config as site_config

from api.models import Photo, User
from api.photos.paths import folder_path_q

logger = logging.getLogger(__name__)

# Below this many photos losing all their files, the fraction is not checked:
# a small library, or a few deleted folders, is cleaned up as before.
MISSING_PHOTOS_FLOOR = 100

_NOTHING_CHANGED = "Nothing was changed. Is the library mounted?"
_RAISE_THE_LIMIT = (
    "If you removed these files on purpose, ask an administrator to raise the"
    " missing photos limit in Site settings and scan again."
)


def _limit() -> float:
    return float(site_config.SCAN_MISSING_MAX_FRACTION)


def library_root_problem(user: User, root: str) -> str | None:
    """Why ``root`` does not look like ``user``'s mounted library, or None.

    It must exist, be a directory that can be listed, and not be empty while
    the user has photos in it (unless the limit is off).
    """
    if not os.path.exists(root):
        return f"The scan directory {root} does not exist. {_NOTHING_CHANGED}"
    if not os.path.isdir(root):
        return f"The scan directory {root} is not a directory. {_NOTHING_CHANGED}"
    try:
        with os.scandir(root) as entries:
            empty = next(entries, None) is None
    except OSError as error:
        reason = error.strerror or type(error).__name__
        return (
            f"The scan directory {root} cannot be read ({reason}). {_NOTHING_CHANGED}"
        )
    if not empty or _limit() >= 1.0:
        return None
    photos_in_root = (
        Photo.objects.owned_by(user).filter(folder_path_q("main_file__path", root))
    ).count()
    if not photos_in_root:
        return None
    return (
        f"The scan directory {root} is empty, but {photos_in_root:,} of your"
        f" photos are in it. {_NOTHING_CHANGED} {_RAISE_THE_LIMIT}"
    )


def too_many_missing(would_lose_all: int, photos_with_files: int) -> str | None:
    """Why detaching would remove too much of the library, or None.

    ``would_lose_all`` photos would be left with no file out of
    ``photos_with_files`` that have one now.
    """
    if would_lose_all <= MISSING_PHOTOS_FLOOR:
        return None
    if would_lose_all <= _limit() * photos_with_files:
        return None
    return (
        f"{would_lose_all:,} of {photos_with_files:,} photos would be marked"
        f" missing. {_NOTHING_CHANGED} {_RAISE_THE_LIMIT}"
    )
