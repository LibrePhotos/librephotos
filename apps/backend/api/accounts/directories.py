"""A user's own folders under ``DATA_ROOT``: library and upload directories.

A photo has exactly one owner, so no two users may point at overlapping trees
(#2034); ``normalize_scan_directory`` checks a directory an admin or the user
sets, and ``auto_create_user_directory`` gives a new account its own folder
when the ``AUTO_CREATE_USER_DIRECTORY`` site setting is on (#2038).
``normalize_library_folder`` checks a further library folder an admin adds
(#123): no two users' folders, nor two folders of one library, overlap.
"""

import logging
import os
from collections.abc import Iterator

from django.conf import settings
from rest_framework.exceptions import ValidationError

from api.models import LibraryFolder, User
from api.photos.paths import is_valid_path

logger = logging.getLogger(__name__)


def comparable_path(path: str) -> str:
    """Spell ``path`` the way the filesystem tells directories apart.

    ``realpath`` folds a symlink onto its target, so a link into another
    user's library is seen for what it is. ``normcase`` folds case and
    separators on Windows, where ``C:\\Data\\alice`` and ``c:/data/alice``
    are the same directory; it is a no-op on POSIX. Neither needs the path to
    exist: ``realpath`` resolves as much of it as it can.
    """
    return os.path.normcase(os.path.realpath(path))


def directories_overlap(one: str, other: str) -> bool:
    """True when two directories are the same or one contains the other."""
    one, other = comparable_path(one), comparable_path(other)
    return is_valid_path(one, other) or is_valid_path(other, one)


def reject_overlap_with_another_user(
    abs_scan_directory: str,
    user: User | None,
    label: str = "Scan directory",
    field: str = "scan_directory",
) -> None:
    """Refuse a directory that reaches into a tree another user owns.

    A photo has exactly one owner, so two users pointed at overlapping trees
    give an outcome that depends on which scan runs first: the second either
    skips the files the first already owns, or takes them over. Equal, parent
    and child paths all have that problem, so all three are rejected (#2034).

    Another user's tree is both its library (``scan_directory``) and its
    upload folder (``upload_directory``, #2033): uploads are scanned into the
    uploader's library, so a folder that one user uploads into and another
    scans would have the same race. The rule holds in both directions, for a
    scan directory and for an upload folder. A user's own library and upload
    folder never conflict with each other.

    ``field`` is the attribute on ``user`` that the directory is being set
    for. Leaving it as it is never conflicts, even when it already overlaps --
    an install that predates this check has to stay editable, rather than
    having every other field on that user locked behind a directory the admin
    may not want to move.
    """
    # Compare normalised forms: a directory stored before this check, or by an
    # older version, may carry a trailing separator or a non-canonical
    # spelling, and a raw string compare would read that as a change and lock
    # the user out of its own directory.
    current = getattr(user, field, "") if user is not None else ""
    if current and comparable_path(abs_scan_directory) == comparable_path(current):
        return

    for username, taken, kind in _taken_by_others(user):
        if directories_overlap(abs_scan_directory, taken):
            raise ValidationError(
                f"{label} overlaps the {kind} of user "
                f"'{username}' ({taken}). Every photo has "
                f"exactly one owner, so two users cannot scan the same files."
            )


def _taken_by_others(user: User | None) -> Iterator[tuple[str, str, str]]:
    """(username, directory, kind) of every folder another user's library uses.

    The scan directory, the upload folder and the further library folders
    (#123) of every user but ``user``.
    """
    # exclude() with two lookups drops only the users that have neither.
    others = User.objects.exclude(scan_directory="", upload_directory="")
    folders = LibraryFolder.objects.select_related("owner")
    if user is not None and user.pk is not None:
        others = others.exclude(pk=user.pk)
        folders = folders.exclude(LibraryFolder.objects.owner_q(user))

    others = others.only("pk", "username", "scan_directory", "upload_directory")
    for other in others.iterator():
        if other.scan_directory:
            yield other.username, other.scan_directory, "library"
        if other.upload_directory:
            yield other.username, other.upload_directory, "upload folder"
    for folder in folders.only("path", "owner__username").iterator():
        yield folder.owner.username, folder.path, "library folder"


def reject_overlap_with_own_folders(
    abs_directory: str, user: User, label: str, folder_id: int | None = None
) -> None:
    """Refuse a directory that overlaps one of ``user``'s further library folders.

    The roots of one library never overlap (#123): a folder inside another
    would be walked twice and its photos counted under both. ``folder_id``
    is the folder being set, which never conflicts with itself.
    """
    if user.pk is None:
        return
    folders = LibraryFolder.objects.owned_by(user)
    if folder_id is not None:
        folders = folders.exclude(pk=folder_id)
    for path in folders.values_list("path", flat=True):
        if directories_overlap(abs_directory, path):
            raise ValidationError(
                f"{label} overlaps the library folder {path} of this user."
                " Remove that folder from the library first."
            )


def normalize_scan_directory(
    scan_directory: str,
    user: User | None = None,
    label: str = "Scan directory",
    field: str = "scan_directory",
) -> str | None:
    """Return ``scan_directory`` as a usable absolute library root.

    Returns ``None`` when nothing was supplied, so callers can leave the
    stored value untouched. Raises ``ValidationError`` when the path escapes
    ``settings.DATA_ROOT``, does not exist on disk, or overlaps another
    user's library.

    ``user`` is the account the directory is being set on, so that its own
    current directory is not read as a conflict with itself. Leave it out when
    creating a user, where there is no account yet and every other user's
    directory is somebody else's. ``label`` names the field in the error
    messages, and ``field`` is the attribute on ``user`` being set, whose
    current value is never a conflict.
    """
    if not scan_directory:
        return None

    abs_scan_directory = os.path.abspath(scan_directory)

    if not is_valid_path(abs_scan_directory, settings.DATA_ROOT):
        raise ValidationError(f"{label} must be inside the data root.")

    if not os.path.exists(abs_scan_directory):
        raise ValidationError(f"{label} does not exist")

    reject_overlap_with_another_user(abs_scan_directory, user, label, field)
    if user is not None and field == "scan_directory":
        reject_overlap_with_own_folders(abs_scan_directory, user, label)

    return abs_scan_directory


#: The most further library folders one user may have (#123).
MAX_LIBRARY_FOLDERS = 50


def normalize_library_folder(path: str, user: User) -> str:
    """Return ``path`` as a usable further library folder of ``user`` (#123).

    It must be an existing folder inside ``settings.DATA_ROOT``, overlap no
    folder of another user's library (#2034) and no folder of ``user``'s own
    library: the scan directory, the upload folder or another library folder.
    ``user`` must have a scan directory, the library's main folder. Raises
    ``ValidationError`` naming the ``path`` field otherwise.
    """
    label = "The folder"
    abs_path = os.path.normpath(os.path.abspath(path))
    if not user.scan_directory:
        raise ValidationError({"path": "Set the user's scan directory first."})
    if LibraryFolder.objects.owned_by(user).count() >= MAX_LIBRARY_FOLDERS:
        raise ValidationError(
            {"path": f"A library has at most {MAX_LIBRARY_FOLDERS} further folders."}
        )
    if not is_valid_path(abs_path, settings.DATA_ROOT):
        raise ValidationError({"path": f"{label} must be inside the data root."})
    if not os.path.isdir(abs_path):
        raise ValidationError({"path": f"{label} does not exist."})
    try:
        _reject_overlap_with_main_folders(abs_path, user)
        reject_overlap_with_own_folders(abs_path, user, label)
        reject_overlap_with_another_user(abs_path, user, label, field="")
    except ValidationError as error:
        raise ValidationError({"path": error.detail}) from error
    return abs_path


def _reject_overlap_with_main_folders(abs_path: str, user: User) -> None:
    """Refuse a further folder that overlaps the scan directory or upload folder."""
    for taken, kind in (
        (user.scan_directory, "scan directory"),
        (user.upload_root(), "upload folder"),
    ):
        if directories_overlap(abs_path, taken):
            raise ValidationError(
                f"The folder overlaps the {kind} of this user ({taken}),"
                " which is already in the library."
            )


def auto_create_user_directory(user: User, claim_existing: bool = False) -> None:
    """Give ``user`` its own folder under ``DATA_ROOT``, when that is enabled.

    Off unless the ``AUTO_CREATE_USER_DIRECTORY`` site setting is on. A
    directory supplied on create is never overwritten -- an admin who typed a
    path meant it (#2038).

    The folder is ``DATA_ROOT/<username>``. Everything that can refuse it is
    checked before anything is created, so a refusal leaves nothing behind:

    - the username has to name a direct child of ``DATA_ROOT`` (``.`` and
      ``..`` do not);
    - it must not overlap another user's scan directory (#2034). On the
      default layout, where the admin scans ``DATA_ROOT`` itself, every
      candidate overlaps, so the feature needs the admin on a subfolder;
    - a folder that already exists is only taken over when
      ``claim_existing`` is set. That is for an admin creating the account,
      who can see what is in it. A self-registered or SSO user must not be
      able to claim a folder just by picking its name as a username -- an
      account called ``family`` would otherwise get ``DATA_ROOT/family``.

    Nothing here can fail user creation. A library mount is often read-only,
    and an account with no scan directory is still a usable account: the user
    sees an empty library and an admin can assign one later. So every refusal
    is logged and returned from, not raised.
    """
    from constance import config as site_config

    if not site_config.AUTO_CREATE_USER_DIRECTORY or user.scan_directory:
        return

    data_root = os.path.abspath(settings.DATA_ROOT)
    candidate = os.path.abspath(os.path.join(data_root, user.username))
    reason = _refusal(user, data_root, candidate, claim_existing)
    if reason is not None:
        logger.warning(
            "Not creating a data folder for user %s: %s. "
            "The account was created without a scan directory; assign one "
            "in the Admin Area.",
            user.username,
            reason,
        )
        return

    user.scan_directory = candidate
    user.save(update_fields=["scan_directory"])
    logger.info("Assigned data folder %s to user %s", candidate, user.username)


def _refusal(
    user: User, data_root: str, candidate: str, claim_existing: bool
) -> str | None:
    """Why ``candidate`` cannot be ``user``'s folder; None once it is there and
    ``user`` may take it (the folder is created here when it is missing)."""
    if os.path.dirname(candidate) != data_root:
        return f"the username does not name a folder directly inside {data_root}"

    try:
        reject_overlap_with_another_user(candidate, user)
    except ValidationError as error:
        # error.detail is a list of messages here: the reason is a plain string.
        reasons = " ".join(str(detail) for detail in error.detail)
        return f"{candidate} is not available. {reasons}"

    if os.path.lexists(candidate):
        return _existing_folder_refusal(candidate, claim_existing)
    return _create_folder(candidate, claim_existing)


def _existing_folder_refusal(candidate: str, claim_existing: bool) -> str | None:
    if not claim_existing:
        return (
            f"{candidate} already exists and may hold someone else's photos, "
            f"so it is not handed to a self-registered or single sign-on "
            f"account"
        )
    if not os.path.isdir(candidate):
        return f"{candidate} exists but is not a directory"
    return None


def _create_folder(candidate: str, claim_existing: bool) -> str | None:
    try:
        # No exist_ok: if the folder appeared since the check above, it is
        # not ours to claim.
        os.makedirs(candidate)
    except FileExistsError:
        if not claim_existing:
            return f"{candidate} was created by something else meanwhile"
    except OSError as error:
        return f"could not create {candidate}: {error}"
    return None
