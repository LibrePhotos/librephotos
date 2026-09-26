"""
Utility functions for directory scanning and job management.
"""

import copy
import os
import stat

from constance import config as site_config
from django.db.models import F, Q
from django.utils import timezone

from api import util
from api.models import LongRunningJob

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


def _skip_patterns():
    """Parse the ``SKIP_PATTERNS`` site setting (one DB read)."""
    skip_patterns = site_config.SKIP_PATTERNS
    if not skip_patterns:
        return []
    return [pattern.strip() for pattern in skip_patterns.split(",")]


def should_skip(path, skip_list=None):
    """Check if a path should be skipped based on configured patterns.

    ``skip_list`` is the parsed setting; a directory walk passes it in so the
    setting is read once per walk instead of once per entry.
    """
    if skip_list is None:
        skip_list = _skip_patterns()
    return any(pattern in path for pattern in skip_list)


if os.name == "Windows":

    def is_hidden(path):
        """Check if a file is hidden (Windows version)."""
        name = os.path.basename(os.path.abspath(path))
        return name.startswith(".") or _has_hidden_attribute(path)

    def _has_hidden_attribute(path):
        """Check if file has Windows hidden attribute."""
        try:
            return bool(os.stat(path).st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN)
        except Exception:
            return False

else:

    def is_hidden(path):
        """Check if a file is hidden (Unix version - starts with dot)."""
        return os.path.basename(path).startswith(".")


def walk_directory(directory, callback):
    """
    Recursively walk a directory and collect file paths.

    Symlinks are deliberately followed, since the scan directory may itself be
    - or contain - a link to a mounted share. An entry that is neither a real
    directory nor a real file (a dangling link, a socket, a fifo) is skipped:
    handing it to the photo pipeline only produces an unopenable path that
    fails the whole scan job. A link back to a directory that is already being
    walked (a symlink loop) is skipped too, or the walk would never end.

    Args:
        directory: Directory to scan
        callback: List to append file paths to
    """
    _walk_directory(directory, callback, _skip_patterns(), set())


def _directory_identity(path):
    """Identify a directory by what it resolves to, not by the path taken to it."""
    st = os.stat(path)
    if st.st_ino:
        return (st.st_dev, st.st_ino)
    # Some network filesystems report no inode numbers.
    return os.path.normcase(os.path.realpath(path))


def _walk_directory(directory, callback, skip_list, ancestors):
    identity = _directory_identity(directory)
    if identity in ancestors:
        util.logger.warning(
            f"skipping {directory}: symlink loop back to a directory already "
            "being scanned"
        )
        return
    ancestors.add(identity)
    try:
        for file in os.scandir(directory):
            fpath = os.path.join(directory, file)
            if is_hidden(fpath) or should_skip(fpath, skip_list):
                continue
            if os.path.isdir(fpath):
                _walk_directory(fpath, callback, skip_list, ancestors)
            elif os.path.isfile(fpath):
                callback.append(fpath)
            else:
                util.logger.warning(
                    f"skipping {fpath}: neither a file nor a directory (broken symlink?)"
                )
    finally:
        ancestors.discard(identity)


def walk_files(scan_files, callback):
    """
    Walk a list of specific files.

    Args:
        scan_files: List of file paths to check
        callback: List to append valid file paths to
    """
    for fpath in scan_files:
        if os.path.isfile(fpath):
            callback.append(fpath)


def is_job_cancelled(job_id) -> bool:
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


def update_job_result(job_id, mutate):
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
        result = copy.deepcopy(read) if isinstance(read, dict) else {}
        other_fields = mutate(result, job) or {}
        unchanged = Q(result__isnull=True) if read is None else Q(result=read)
        written = LongRunningJob.objects.filter(
            unchanged, pk=job.pk, cancelled=False
        ).update(result=result, **other_fields)
        if written:
            return job
    util.logger.error(
        f"job {job_id}: gave up updating its result after "
        f"{RESULT_UPDATE_ATTEMPTS} conflicting writes"
    )
    return None


def _record_error(result, error, target):
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

    job_failed = _exceeds_failure_threshold(result["error_count"], target)
    result["status"] = "failed" if job_failed else "partial_failure"
    return job_failed


def finish_job_if_complete(job_id) -> bool:
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


def _on_job_finished(job_id):
    """Start whatever had to wait for this job's work to be done."""
    job_type = (
        LongRunningJob.objects.filter(job_id=job_id)
        .values_list("job_type", flat=True)
        .first()
    )
    if job_type != LongRunningJob.JOB_SCAN_PHOTOS:
        return
    # Imported here because scan_jobs imports this module.
    from api.directory_watcher.scan_jobs import queue_scan_followups

    try:
        queue_scan_followups(job_id)
    except Exception:
        util.logger.exception(f"job {job_id}: could not queue the scan follow-ups")


def update_scan_counter(job_id, failed=False, error=None):
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
        progress_current=F("progress_current") + 1
    )

    if failed or error:

        def add_error(result, job):
            return {"failed": _record_error(result, error, job.progress_target)}

        if update_job_result(job_id, add_error) is None:
            # Gone, or cancelled: a cancelled job keeps its "cancelled" result.
            return

    finish_job_if_complete(job_id)
