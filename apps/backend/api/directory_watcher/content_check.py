"""Check file contents: find files replaced with their old date kept (#2040).

The scan only reads a file again when its modification time moved. Tools that
keep it (``cp -p``, ``rsync --times``, some sync apps) replace the contents
unseen, so the stale hash, thumbnails and labels stay forever. This reads
every indexed file again, compares its hash with the stored one and hands a
changed file to ``rekey_replaced_file``, as the scan would have. The photos
holding a changed file are then rescanned as their owners' file scan, which
reads their metadata again and runs the usual follow-ups.

An admin starts it for every user or one user, optionally one folder of that
user's library (Admin Area, ``manage.py rehash_files``).
"""

import logging
import os
from collections import defaultdict
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from django.db.models import QuerySet

from api.directory_watcher.file_handlers import (
    NEW_PICTURE,
    SAME_PICTURE,
    SIMILAR_PICTURE,
    UNCOMPARABLE,
    rekey_replaced_file,
)
from api.directory_watcher.scan_jobs import scan_photos
from api.jobs.queue import enqueue_followup
from api.models import Face, File, LongRunningJob, Photo, User
from api.models.file import content_hash, hash_owner_part
from api.models.long_running_job import JobCancelledError
from api.photos.library_files import rescan_targets
from api.photos.media_files import calculate_hash
from api.photos.paths import folder_path_q, is_valid_path

logger = logging.getLogger(__name__)

VERDICTS = (NEW_PICTURE, SAME_PICTURE, SIMILAR_PICTURE, UNCOMPARABLE)
# Every count a run keeps, overall and per user.
COUNTS = ("checked", "unchanged", "missing", "unreadable", *VERDICTS)

# How many changed files, failed items and users the job's result lists.
MAX_LISTED = 100
# Progress is written after this many files.
PROGRESS_EVERY = 25

Progress = Callable[[int, int], None]


class FolderError(ValueError):
    """The folder to check is not inside the user's scan directory."""


@dataclass
class CheckResult:
    """What a run found, for the job's result and the command's summary."""

    totals: dict[str, int] = field(default_factory=lambda: dict.fromkeys(COUNTS, 0))
    by_user: dict[int, dict[str, int]] = field(default_factory=dict)
    changed: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    error_count: int = 0
    # Owner id -> their photos holding a changed file, rescanned afterwards.
    rescan: dict[int, set[UUID]] = field(default_factory=lambda: defaultdict(set))

    def count(self, user_id: int, outcome: str) -> None:
        self.totals[outcome] += 1
        counts = self.by_user.setdefault(user_id, dict.fromkeys(COUNTS, 0))
        counts[outcome] += 1

    def fail(self, path: str, reason: str) -> None:
        self.error_count += 1
        if len(self.errors) < MAX_LISTED:
            self.errors.append(f"{path}: {reason}")


def resolve_folder(user: User, folder: str) -> str:
    """``folder``, relative to ``user``'s scan directory, as an absolute path.

    Raises ``FolderError`` when the user has no scan directory or the folder
    is outside it or does not exist.
    """
    if not user.scan_directory:
        raise FolderError("This user has no scan directory.")
    root = os.path.abspath(user.scan_directory)
    path = os.path.normpath(os.path.join(root, folder))
    if not is_valid_path(path, root):
        raise FolderError("The folder is not inside the user's scan directory.")
    if not os.path.isdir(path):
        raise FolderError("The folder does not exist.")
    return path


def users_to_check(user: User | None) -> list[User]:
    """``user``, or every user with photos, in a fixed order."""
    if user is not None:
        return [user]
    owners = Photo.objects.exclude(removed=True).values("owner_id")
    return list(User.objects.filter(pk__in=owners).order_by("pk"))


def files_to_check(user: User, folder: str | None = None) -> QuerySet[File]:
    """The files of ``user``'s photos that a run reads, sidecars included.

    Not the motion videos LibrePhotos extracted itself, nor files already
    flagged missing.
    """
    photos = Photo.objects.owned_by(user).exclude(removed=True)
    extracted = File.embedded_media.through.objects.values("to_file_id")
    files = (
        File.objects.filter(photo__in=photos)
        .exclude(missing=True)
        .exclude(pk__in=extracted)
    )
    if folder:
        files = files.filter(folder_path_q("path", folder))
    return files.distinct().order_by("path")


def _affected_photos(file_hash: str) -> list[tuple[UUID, int | None]]:
    """(id, owner id) of the photos holding the file, before it is re-keyed."""
    return list(
        Photo.objects.filter(files__pk=file_hash)
        .exclude(removed=True)
        .distinct()
        .values_list("pk", "owner_id")
    )


def _named_faces(photo_ids: list[UUID]) -> int:
    return Face.objects.filter(photo__in=photo_ids, person__isnull=False).count()


class _Checker:
    """One run: hashes each file once, whichever user's library it is in."""

    def __init__(self, result: CheckResult) -> None:
        self.result = result
        self.seen: set[str] = set()
        self.owners: dict[str, User | None] = {}

    def _owner(self, file_hash: str) -> User | None:
        """The user whose id the stored hash carries (``calculate_hash``)."""
        owner_part = hash_owner_part(file_hash)
        if owner_part not in self.owners:
            self.owners[owner_part] = (
                User.objects.filter(pk=int(owner_part)).first()
                if owner_part.isdigit()
                else None
            )
        return self.owners[owner_part]

    def check(self, user: User, file_hash: str, path: str) -> None:
        """Read one file and count what became of it under ``user``."""
        self.seen.add(file_hash)
        outcome = self._outcome(file_hash, path)
        self.result.count(user.pk, "checked")
        if outcome is not None:
            self.result.count(user.pk, outcome)

    def _outcome(self, file_hash: str, path: str) -> str | None:
        if not os.path.isfile(path):
            # The next scan flags it missing; not this run's business.
            return "missing"
        owner = self._owner(file_hash)
        if owner is None:
            self.result.fail(path, "indexed under a user that no longer exists")
            return "unreadable"
        try:
            disk_hash = calculate_hash(owner, path)
        except OSError as error:
            self.result.fail(path, error.strerror or str(error))
            return "unreadable"
        if content_hash(disk_hash) == content_hash(file_hash):
            return "unchanged"
        return self._rekey(owner, file_hash, path, disk_hash)

    def _rekey(
        self, owner: User, file_hash: str, path: str, disk_hash: str
    ) -> str | None:
        affected = _affected_photos(file_hash)
        photo_ids = [pk for pk, _ in affected]
        named_faces = _named_faces(photo_ids)
        reindexed = rekey_replaced_file(owner, path, disk_hash)
        # Another user's library lists the file under its new hash now.
        self.seen.add(disk_hash)
        if reindexed is None:
            self.result.fail(path, "the new contents match another indexed file")
            return None
        for pk, owner_id in affected:
            if owner_id is not None:
                self.result.rescan[owner_id].add(pk)
        self._list_change(path, reindexed.verdict, photo_ids, named_faces)
        return reindexed.verdict

    def _list_change(
        self, path: str, verdict: str, photo_ids: list[UUID], named_faces: int
    ) -> None:
        if len(self.result.changed) >= MAX_LISTED:
            return
        self.result.changed.append(
            {
                "path": path,
                "verdict": verdict,
                "photo_id": str(photo_ids[0]) if photo_ids else None,
                # A new picture's faces go, the names people gave them too.
                "named_faces_removed": named_faces if verdict == NEW_PICTURE else 0,
            }
        )


def _files_of(users: list[User], folder: str | None) -> Iterator[tuple[User, str, str]]:
    for user in users:
        for file_hash, path in files_to_check(user, folder).values_list("hash", "path"):
            yield user, file_hash, path


def count_files(users: list[User], folder: str | None) -> int:
    """How many files a run reads (a file in two libraries counts twice)."""
    return sum(files_to_check(user, folder).count() for user in users)


def check_file_contents(
    user: User | None = None,
    folder: str | None = None,
    progress: Progress | None = None,
    result: CheckResult | None = None,
) -> CheckResult:
    """Read the files of ``user`` (every user when None) and re-key changed ones.

    ``folder`` is an absolute folder inside ``user``'s library
    (``resolve_folder``). ``progress(done, total)`` is called at the start,
    every ``PROGRESS_EVERY`` files and at the end; what it raises (a
    cancelled job) stops the run, with what was found so far in ``result``.
    """
    users = users_to_check(user)
    total = count_files(users, folder)
    result = result if result is not None else CheckResult()
    checker = _Checker(result)
    done = 0
    if progress:
        progress(0, total)
    for owner, file_hash, path in _files_of(users, folder):
        done += 1
        if file_hash not in checker.seen:
            checker.check(owner, file_hash, path)
        if progress and done % PROGRESS_EVERY == 0:
            progress(done, total)
    if progress:
        progress(total, total)
    return result


def queue_rescans(result: CheckResult) -> int:
    """Rescan the photos holding a changed file, as each owner's file scan.

    The scan reads their metadata again and runs the follow-ups that make
    faces, things and search data again. Returns how many scans were queued.
    """
    queued = 0
    for owner in User.objects.filter(pk__in=list(result.rescan)).order_by("pk"):
        paths = rescan_targets(owner, result.rescan[owner.pk]).paths
        if not paths:
            continue
        enqueue_followup(
            owner,
            LongRunningJob.JOB_SCAN_PHOTOS,
            scan_photos,
            owner,
            False,
            scan_files=paths,
            force_files=True,
        )
        queued += 1
    return queued


def job_result(result: CheckResult, rescans: int) -> dict[str, Any]:
    """The job's result: counts overall and per user, the changed files, the failures."""
    usernames = dict(
        User.objects.filter(pk__in=list(result.by_user)).values_list("pk", "username")
    )
    return {
        "status": "partial_failure" if result.error_count else "completed",
        **result.totals,
        "users": [
            {"user_id": user_id, "username": usernames.get(user_id, ""), **counts}
            for user_id, counts in sorted(result.by_user.items())[:MAX_LISTED]
        ],
        "changed": result.changed,
        "rescans": rescans,
        "error_count": result.error_count,
        "errors": result.errors,
    }


def check_file_contents_job(
    admin: User,
    user_id: int | None = None,
    folder: str | None = None,
    job_id: UUID | str | None = None,
) -> None:
    """The Check file contents job an admin starts from the Admin Area (#2040).

    ``user_id`` limits it to that user's library and ``folder`` (absolute,
    resolved by the view) to one folder of it. Progress and the outcome go on
    the job's row; a cancel stops it at the next progress write.
    """
    job = LongRunningJob.claim(admin, LongRunningJob.JOB_CHECK_FILE_CONTENTS, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    user = User.objects.filter(pk=user_id).first() if user_id is not None else None
    if user_id is not None and user is None:
        job.fail(error="The user no longer exists.")
        return
    result = CheckResult()
    try:
        check_file_contents(user, folder, progress=report, result=result)
    except JobCancelledError:
        # The files re-keyed so far are not read again by a scan: rescan them.
        queue_rescans(result)
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not check file contents", job.job_id)
        job.fail(error=error)
        return
    job.complete(result=job_result(result, queue_rescans(result)))
