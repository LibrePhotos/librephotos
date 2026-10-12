"""A user's own folders under ``DATA_ROOT``: library and upload directories.

A photo has exactly one owner, so no two users may point at overlapping trees
(#2034); ``normalize_scan_directory`` checks a directory an admin or the user
sets, and ``auto_create_user_directory`` gives a new account its own folder
when the ``AUTO_CREATE_USER_DIRECTORY`` site setting is on (#2038).
"""

import logging
import os

from django.conf import settings
from rest_framework.exceptions import ValidationError

from api.models import User
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

    # exclude() with two lookups drops only the users that have neither.
    others = User.objects.exclude(scan_directory="", upload_directory="")
    if user is not None and user.pk is not None:
        others = others.exclude(pk=user.pk)

    others = others.only("pk", "username", "scan_directory", "upload_directory")
    for other in others.iterator():
        for taken, kind in (
            (other.scan_directory, "library"),
            (other.upload_directory, "upload folder"),
        ):
            if taken and directories_overlap(abs_scan_directory, taken):
                raise ValidationError(
                    f"{label} overlaps the {kind} of user "
                    f"'{other.username}' ({taken}). Every photo has "
                    f"exactly one owner, so two users cannot scan the same files."
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

    return abs_scan_directory


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
