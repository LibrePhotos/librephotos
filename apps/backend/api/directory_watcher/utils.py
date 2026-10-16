"""
Utility functions for directory scanning and job management.
"""

import copy
import logging
import os
import stat
from collections.abc import Callable
from typing import Any, NamedTuple
from uuid import UUID

from constance import config as site_config
from django.db.models import F, Q
from django.utils import timezone

from api.models import LongRunningJob

logger = logging.getLogger(__name__)

# How often (in loop iterations) to check the DB for job cancellation.
# Lower values are more responsive but increase DB load.
CANCELLATION_CHECK_INTERVAL = 100

# Threshold for marking the LongRunningJob row's ``failed`` flag (which
# surfaces as the red "Failed" banner in the admin UI). A scan that
# errored on a tiny minority of photos — e.g. 4 out of 152520 — is
# overwhelmingly a success and shouldn't carry the failed flag. Per-photo
# errors are still accumulated in ``result['errors']`` regardless; the
# threshold only governs the sticky boolean.
FAILURE_ERROR_FLOOR = 10  # absolute floor — below this, never sticky
FAILURE_ERROR_RATE = 0.05  # otherwise: failed if errors exceed 5% of target

# Every failed compare-and-swap in ``update_job_result`` means another worker's
# write landed, so the job as a whole always makes progress; the bound only
# stops one unlucky worker from spinning forever under a pathological storm.
RESULT_UPDATE_ATTEMPTS = 50


def _exceeds_failure_threshold(error_count: int, target: int) -> bool:
    """Return True when aggregate errors should mark ``job.failed`` as True."""
    if target <= 0:
        return error_count > 0
    threshold = max(FAILURE_ERROR_FLOOR, FAILURE_ERROR_RATE * target)
    return error_count > threshold


def skip_patterns() -> list[str]:
    """Parse the ``SKIP_PATTERNS`` site setting (one DB read)."""
    skip_patterns = site_config.SKIP_PATTERNS
    if not skip_patterns:
        return []
    return [pattern.strip() for pattern in skip_patterns.split(",")]


def should_skip(path: str, skip_list: list[str] | None = None) -> bool:
    """Check if a path should be skipped based on configured patterns.

    ``skip_list`` is the parsed setting; a directory walk passes it in so the
    setting is read once per walk instead of once per entry.
    """
    if skip_list is None:
        skip_list = skip_patterns()
    return any(pattern in path for pattern in skip_list)


# os.name is "nt" on Windows. The old check compared it with "Windows", which is
# never true, so the hidden-attribute branch below was dead code.
_IS_WINDOWS = os.name == "nt"


def is_hidden(path: str) -> bool:
    """Check if a file is hidden.

    A dot-file is hidden everywhere; on Windows so is anything carrying the
    hidden attribute (desktop.ini, Thumbs.db, files hidden in Explorer).
    """
    if os.path.basename(os.path.abspath(path)).startswith("."):
        return True
    return _IS_WINDOWS and _has_hidden_attribute(path)


def _has_hidden_attribute(path: str) -> bool:
    """Check if file has the Windows hidden attribute."""
    try:
        # st_file_attributes only exists on Windows. It is read by name, with
        # 0 as the default, because mypy checks this module as Linux, where
        # the attribute is not declared; a missing attribute reads as "not
        # hidden", as the AttributeError branch used to.
        attributes: int = getattr(os.stat(path), "st_file_attributes", 0)
    except OSError:
        return False
    return bool(attributes & stat.FILE_ATTRIBUTE_HIDDEN)


class SkippedDirectory(NamedTuple):
    """A directory the walk could not list, and why."""

    path: str
    error: str


def walk_directory(directory: str, callback: list[str]) -> list[SkippedDirectory]:
    """
    Recursively walk a directory and collect file paths.

    Symlinks are deliberately followed, since the scan directory may itself be
    - or contain - a link to a mounted share. An entry that is neither a real
    directory nor a real file (a dangling link, a socket, a fifo) is skipped:
    handing it to the photo pipeline only produces an unopenable path that
    fails the whole scan job. A link back to a directory that is already being
    walked (a symlink loop) is skipped too, or the walk would never end.

    A subdirectory that cannot be listed (a root-owned ``lost+found``, a NAS
    recycle bin) is skipped and returned, so one folder does not fail the whole
    scan. The scan root is not: if it cannot be listed the library itself is
    unavailable, and the ``OSError`` propagates.

    Args:
        directory: Directory to scan
        callback: List to append file paths to

    Returns:
        The subdirectories that were skipped because they could not be listed.
    """
    walk = _DirectoryWalk(callback, skip_patterns())
    walk.walk_entries(directory, _list_directory(directory))
    return walk.skipped


_DirectoryIdentity = tuple[int, int] | str


def _directory_identity(path: str) -> _DirectoryIdentity:
    """Identify a directory by what it resolves to, not by the path taken to it."""
    st = os.stat(path)
    if st.st_ino:
        return (st.st_dev, st.st_ino)
    # Some network filesystems report no inode numbers.
    return os.path.normcase(os.path.realpath(path))


def _list_directory(directory: str) -> tuple[_DirectoryIdentity, list[str]]:
    """The directory's identity and the paths of its entries.

    Raises ``OSError`` when it cannot be read; listing it whole up front means
    an error halfway through (a share dropping) raises here too, not while its
    entries are being walked.
    """
    identity = _directory_identity(directory)
    with os.scandir(directory) as entries:
        return identity, [entry.path for entry in entries]


class _DirectoryWalk:
    """The state of one ``walk_directory`` call."""

    def __init__(self, callback: list[str], skip_list: list[str]) -> None:
        self.callback = callback
        self.skip_list = skip_list
        # The directories on the current path, to cut symlink loops.
        self.ancestors: set[_DirectoryIdentity] = set()
        self.skipped: list[SkippedDirectory] = []

    def walk_subdirectory(self, directory: str) -> None:
        try:
            listing = _list_directory(directory)
        except OSError as error:
            reason = error.strerror or str(error)
            # The path goes into the job's result; the log keeps to the reason.
            logger.warning("skipping a directory the scan cannot list: %s", reason)
            self.skipped.append(SkippedDirectory(directory, reason))
            return
        self.walk_entries(directory, listing)

    def walk_entries(
        self, directory: str, listing: tuple[_DirectoryIdentity, list[str]]
    ) -> None:
        identity, paths = listing
        if identity in self.ancestors:
            logger.warning(
                "skipping %s: symlink loop back to a directory already being scanned",
                directory,
            )
            return
        self.ancestors.add(identity)
        try:
            for fpath in paths:
                if is_hidden(fpath) or should_skip(fpath, self.skip_list):
                    continue
                if os.path.isdir(fpath):
                    self.walk_subdirectory(fpath)
                elif os.path.isfile(fpath):
                    self.callback.append(fpath)
                else:
                    logger.warning(
                        "skipping %s: neither a file nor a directory (broken symlink?)",
                        fpath,
                    )
        finally:
            self.ancestors.discard(identity)


def walk_files(scan_files: list[str], callback: list[str]) -> None:
    """
    Walk a list of specific files.

    Args:
        scan_files: List of file paths to check
        callback: List to append valid file paths to
    """
    for fpath in scan_files:
        if os.path.isfile(fpath):
            callback.append(fpath)


def is_job_cancelled(job_id: UUID | str) -> bool:
    """
    Check if a long-running job has been cancelled.

    Use this in processing loops to cooperatively stop work when the user
    cancels a job. Typically called every N iterations to avoid excessive
    DB queries.

    Args:
        job_id: The job ID to check

    Returns:
        True if the job has been cancelled, False otherwise
    """
    return LongRunningJob.objects.filter(job_id=job_id, cancelled=True).exists()


def update_job_result(
    job_id: UUID | str,
    mutate: Callable[[dict[str, Any], LongRunningJob], dict[str, Any] | None],
) -> LongRunningJob | None:
    """Apply ``mutate`` to a job's ``result`` JSON without losing concurrent writes.

    Many workers report into one job row at once. A plain read-modify-write
    lets a worker that writes between another's read and save wipe out that
    save. ``select_for_update`` would serialize them on PostgreSQL but is a
    no-op on SQLite (the Windows standalone build, dev_windows and the test
    suite), so this is a compare-and-swap instead: the write only lands if
    ``result`` is still what was read, otherwise it re-reads and re-applies.

    ``mutate(result, job)`` edits ``result`` (a private copy) in place and
    returns a dict of other fields to write with it. Returns the job as read
    for the successful write, or ``None`` if the job is gone or cancelled.
    """
    for _ in range(RESULT_UPDATE_ATTEMPTS):
        job = LongRunningJob.objects.filter(job_id=job_id).first()
        if job is None or job.cancelled:
            return None
        read = job.result
        result: dict[str, Any] = copy.deepcopy(read) if isinstance(read, dict) else {}
        other_fields = mutate(result, job) or {}
        unchanged = Q(result__isnull=True) if read is None else Q(result=read)
        written = LongRunningJob.objects.filter(
            unchanged, pk=job.pk, cancelled=False
        ).update(result=result, **other_fields)
        if written:
            return job
    logger.error(
        "job %s: gave up updating its result after %s conflicting writes",
        job_id,
        RESULT_UPDATE_ATTEMPTS,
    )
    return None


# Key in a scan job's ``result`` counting the directories it skipped, which
# ``error_count`` includes but the failure threshold leaves out.
_SKIPPED_DIRECTORIES_KEY = "skipped_directories"


def record_skipped_directories(
    job_id: UUID | str, skipped: list[SkippedDirectory]
) -> None:
    """List the directories a scan could not read in the job's ``errors``.

    Each one counts as a failed item, so the finished job shows as a partial
    failure naming the folder, but not towards the failure threshold: one
    unreadable folder does not make the whole scan fail.
    """
    if not skipped:
        return

    def add_skipped(result: dict[str, Any], job: LongRunningJob) -> None:
        errors: list[str] = result.get("errors") or []
        errors.extend(f"{entry.path}: {entry.error}, skipped" for entry in skipped)
        result["errors"] = errors[-100:]
        result["error_count"] = result.get("error_count", 0) + len(skipped)
        result[_SKIPPED_DIRECTORIES_KEY] = result.get(
            _SKIPPED_DIRECTORIES_KEY, 0
        ) + len(skipped)
        if result.get("status") != "failed":
            result["status"] = "partial_failure"

    update_job_result(job_id, add_skipped)


def _record_error(result: dict[str, Any], error: str | None, target: int) -> bool:
    """Add one failed item to ``result``; return whether the job counts as failed.

    ``error_count`` tracks the aggregate (uncapped); the ``errors`` list itself
    is capped at 100 to prevent unbounded growth, so its length under-reports.
    """
    result["error_count"] = result.get("error_count", 0) + 1
    if "errors" not in result:
        result["errors"] = []
    if error:
        error_str = str(error)
        # Avoid duplicate errors (limit to last 100 to prevent unbounded growth)
        if error_str not in result["errors"]:
            result["errors"].append(error_str)
            if len(result["errors"]) > 100:
                result["errors"] = result["errors"][-100:]
    # Set main error field for backward compatibility
    if "error" not in result and error:
        result["error"] = str(error)
    elif "error" not in result and result.get("errors"):
        result["error"] = result["errors"][0]  # Use first error as main error

    # A skipped directory is listed and counted, but never fails the job.
    job_failed = _exceeds_failure_threshold(
        result["error_count"] - result.get(_SKIPPED_DIRECTORIES_KEY, 0), target
    )
    result["status"] = "failed" if job_failed else "partial_failure"
    return job_failed


def finish_job_if_complete(job_id: UUID | str) -> bool:
    """Mark the job finished once its progress has reached the target.

    The conditional UPDATE is the whole transition, so it happens exactly once:
    of any number of callers racing past the target, only the one whose UPDATE
    flips ``finished`` gets a row back, and only that one runs the job's
    completion hook. Returns whether this call finished the job.
    """
    finished = LongRunningJob.objects.filter(
        job_id=job_id,
        finished=False,
        cancelled=False,
        progress_current__gte=F("progress_target"),
    ).update(finished=True, finished_at=timezone.now())
    if not finished:
        return False
    _on_job_finished(job_id)
    return True


def _on_job_finished(job_id: UUID | str) -> None:
    """Start whatever had to wait for this job's work to be done."""
    job = (
        LongRunningJob.objects.filter(job_id=job_id)
        .values("job_type", "started_by_id")
        .first()
    )
    if job is None:
        return
    job_type = job["job_type"]
    if job_type == LongRunningJob.JOB_GENERATE_TAGS:
        _queue_embeddings_after_tags(job_id, job["started_by_id"])
        return
    if job_type != LongRunningJob.JOB_SCAN_PHOTOS:
        return
    # Imported here because scan_jobs imports this module.
    from api.directory_watcher.scan_jobs import queue_scan_followups

    try:
        queue_scan_followups(job_id)
    except Exception:
        logger.exception("job %s: could not queue the scan follow-ups", job_id)


def _queue_embeddings_after_tags(job_id: UUID | str, user_id: int | None) -> None:
    """Fill the gaps the tags job left in the search embeddings.

    A scan queues the tags job only while tagging is on, and then the tags job
    stores each photo's search embedding and the scan's own embedding job
    leaves those photos to it. This run embeds the photos it could not tag and
    rebuilds the index. It does not ask whether tagging is still on: when an
    admin turned it off while the job ran, the photos it skipped are exactly
    the ones still missing an embedding.
    """
    if user_id is None:
        return
    from api.jobs.queue import enqueue_followup
    from api.models import User
    from api.search.embedding_jobs import batch_calculate_clip_embedding

    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return
    try:
        enqueue_followup(
            user,
            LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
            batch_calculate_clip_embedding,
            user,
        )
    except Exception:
        logger.exception("job %s: could not queue the search embeddings", job_id)


def update_scan_counter(
    job_id: UUID | str, failed: bool = False, error: str | None = None
) -> None:
    """
    Update the progress counter for a long-running job.

    Increments progress_current and marks job as finished when complete.
    Also tracks errors for failed items.

    Args:
        job_id: The job ID to update
        failed: Whether this item failed processing
        error: Error message if failed
    """
    LongRunningJob.objects.filter(job_id=job_id).update(
        progress_current=F("progress_current") + 1, last_progress_at=timezone.now()
    )

    if failed or error:

        def add_error(result: dict[str, Any], job: LongRunningJob) -> dict[str, bool]:
            return {"failed": _record_error(result, error, job.progress_target)}

        if update_job_result(job_id, add_error) is None:
            # Gone, or cancelled: a cancelled job keeps its "cancelled" result.
            return

    finish_job_if_complete(job_id)


def update_batch_counter(
    job_id: UUID | str,
    done: int,
    counts: dict[str, int],
    errors: list[str],
) -> None:
    """``update_scan_counter`` for a batch of ``done`` items.

    Adds ``counts`` to the same keys of the job's result (``{"moved": 3}``),
    records ``errors`` as failed items and advances the progress by ``done``,
    all in one write, then finishes the job once it reached its target. A
    cancelled job is left as it is.
    """

    def add_batch(result: dict[str, Any], job: LongRunningJob) -> dict[str, Any]:
        for key, count in counts.items():
            result[key] = result.get(key, 0) + count
        fields: dict[str, Any] = {
            "progress_current": F("progress_current") + done,
            "last_progress_at": timezone.now(),
        }
        for error in errors:
            fields["failed"] = _record_error(result, error, job.progress_target)
        return fields

    if update_job_result(job_id, add_batch) is None:
        return
    finish_job_if_complete(job_id)
