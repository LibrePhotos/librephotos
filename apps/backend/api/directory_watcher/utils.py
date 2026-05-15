"""
Utility functions for directory scanning and job management.
"""

import os
import stat

from constance import config as site_config
from django.db.models import F
from django.utils import timezone

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


def _exceeds_failure_threshold(error_count: int, target: int) -> bool:
    """Return True when aggregate errors should mark ``job.failed`` as True."""
    if target <= 0:
        return error_count > 0
    threshold = max(FAILURE_ERROR_FLOOR, FAILURE_ERROR_RATE * target)
    return error_count > threshold


def should_skip(path):
    """Check if a path should be skipped based on configured patterns."""
    if not site_config.SKIP_PATTERNS:
        return False

    skip_patterns = site_config.SKIP_PATTERNS
    skip_list = skip_patterns.split(",")
    skip_list = map(str.strip, skip_list)

    res = [ele for ele in skip_list if (ele in path)]
    return bool(res)


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

    Args:
        directory: Directory to scan
        callback: List to append file paths to
    """
    for file in os.scandir(directory):
        fpath = os.path.join(directory, file)
        if not is_hidden(fpath) and not should_skip(fpath):
            if os.path.isdir(fpath):
                walk_directory(fpath, callback)
            else:
                callback.append(fpath)


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
    # Increment the current progress and get the updated job
    LongRunningJob.objects.filter(job_id=job_id).update(
        progress_current=F("progress_current") + 1
    )

    # Refetch the job to get the updated progress_current value
    job = LongRunningJob.objects.filter(job_id=job_id).first()
    if not job:
        return

    # If job has been cancelled, stop processing
    if job.cancelled:
        return

    is_finishing = job.progress_current >= job.progress_target
    result = job.result or {}

    # Accumulate this item's error, if any. ``error_count`` tracks the
    # aggregate (uncapped) — the ``errors`` list itself is capped at 100
    # to prevent unbounded growth, so its length under-reports.
    if failed or error:
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

    job_failed = _exceeds_failure_threshold(
        result.get("error_count", 0), job.progress_target
    )

    if is_finishing:
        if result.get("error_count", 0) > 0:
            result["status"] = "failed" if job_failed else "partial_failure"
        job.finished = True
        job.finished_at = timezone.now()
        job.failed = job_failed
        job.result = result
        job.save(update_fields=["finished", "finished_at", "failed", "result"])
    elif failed or error:
        result["status"] = "partial_failure"
        job.result = result
        job.failed = job_failed
        job.save(update_fields=["failed", "result"])
