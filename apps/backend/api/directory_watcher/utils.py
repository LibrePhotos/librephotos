"""
Utility functions for directory scanning and job management.
"""

import os
import stat

from constance import config as site_config
from django.db.models import F
from django.utils import timezone

from api.models import LongRunningJob


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

    # Mark the job as finished if the current progress equals the target
    if job.progress_current >= job.progress_target:
        # Job is finishing, update result with errors if any
        result = job.result or {}
        if failed or error:
            result["status"] = "failed"
            if "errors" not in result:
                result["errors"] = []
            if error:
                error_str = str(error)
                # Avoid duplicate errors
                if error_str not in result["errors"]:
                    result["errors"].append(error_str)
            # Set main error field for backward compatibility
            if "error" not in result and error:
                result["error"] = str(error)
            elif "error" not in result and result.get("errors"):
                result["error"] = result["errors"][0]  # Use first error as main error
        job.finished = True
        job.finished_at = timezone.now()
        if failed:
            job.failed = True
        job.result = result
        job.save(update_fields=["finished", "finished_at", "failed", "result"])
    else:
        # Job is still running, accumulate errors in result
        if failed or error:
            job = LongRunningJob.objects.filter(job_id=job_id).first()
            if job:
                result = job.result or {}
                result["status"] = "partial_failure" if not job.finished else "failed"
                if "errors" not in result:
                    result["errors"] = []
                if error:
                    error_str = str(error)
                    # Avoid duplicate errors (limit to last 100 to prevent unbounded growth)
                    if error_str not in result["errors"]:
                        result["errors"].append(error_str)
                        if len(result["errors"]) > 100:
                            result["errors"] = result["errors"][-100:]  # Keep last 100 errors
                # Set main error field for backward compatibility
                if "error" not in result and error:
                    result["error"] = str(error)
                elif "error" not in result and result.get("errors"):
                    result["error"] = result["errors"][0]  # Use first error as main error
                job.result = result
                job.failed = failed or job.failed
                job.save(update_fields=["failed", "result"])
