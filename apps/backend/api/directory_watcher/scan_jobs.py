"""
Main scan jobs for photo discovery and processing.

This module contains the core scan_photos function that implements the
two-phase scan architecture to avoid race conditions with RAW+JPEG grouping.
"""

import datetime
import os
import uuid
from collections import defaultdict
from uuid import UUID

import pytz
from django import db
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import F, Q
from django.utils import timezone
from django_q.tasks import AsyncTask, Chain

from api import util
from api.metadata.reader import get_sidecar_files_in_priority_order
from api.batch_jobs import batch_calculate_clip_embedding
from api.models import LongRunningJob, Photo, Thumbnail
from api.models.file import is_metadata

from api.directory_watcher.file_grouping import get_file_grouping_key
from api.directory_watcher.file_handlers import handle_new_image, handle_file_group
from api.directory_watcher.processing_jobs import (
    generate_tags,
    add_geolocation,
    scan_faces,
)
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.directory_watcher.utils import (
    walk_directory,
    walk_files,
    is_job_cancelled,
    update_scan_counter,
)


# Number of file groups whose known-paths are resolved in a single DB query
# during scan Phase 1. Larger batches mean fewer round-trips (faster start-up)
# but a bigger transient ``known_paths`` set; ~10k groups is the knee where the
# per-batch query cost stops shrinking, while keeping the transient set tiny
# (well under 2 MB) regardless of total library size.
_PATH_PREFETCH_BATCH = 10000


def _file_was_modified_after(filepath, time):
    """Check if a file was modified after a given time."""
    try:
        modified = os.path.getmtime(filepath)
    except OSError:
        return False
    return datetime.datetime.fromtimestamp(modified).replace(tzinfo=pytz.utc) > time


def _group_needs_processing(paths, existing_paths, full_scan, last_scan):
    """Return True if any file in a (directory, basename) group must be processed.

    This mirrors the original per-file decision exactly, but takes a set of
    already-known file paths (resolved one batch at a time by the caller) so the
    "do we have this file?" test is an in-memory lookup instead of one
    ``Photo.objects.filter(files__path=path).exists()`` query per file (a
    round-trip per file — 100k+ on a large library, the dominant cost of scan
    start-up). ``existing_paths`` only needs to cover this group's paths.

    The modified-time check (and the sidecar paths it stats) is only reached for
    a file we already have, on an incremental scan with a baseline — i.e. the
    only case where "did it change since last scan?" is the deciding question.
    """
    for path in paths:
        if path not in existing_paths or full_scan or not last_scan:
            return True
        files_to_check = [path, *get_sidecar_files_in_priority_order(path)]
        if any(
            _file_was_modified_after(p, last_scan.finished_at) for p in files_to_check
        ):
            return True
    return False


def _select_groups_to_process(
    group_items, known_paths_for, full_scan, last_scan, batch_size=_PATH_PREFETCH_BATCH
):
    """Pick the file groups that need processing, resolving known paths in batches.

    ``group_items`` is ``list(file_groups.items())`` — (group_key, paths) pairs.
    ``known_paths_for(batch_paths)`` returns the subset of those paths already in
    the DB; the caller injects the actual query. Resolving known paths one batch
    of groups at a time (instead of loading every known path up front) bounds
    memory to a single batch — important on very large libraries in
    constrained-RAM environments — while still replacing the old per-file
    ``Photo...exists()`` round-trip with one query per ``batch_size`` groups.
    Whole groups are always kept within a batch, so the per-batch known set
    covers every path each group needs to check.
    """
    if full_scan or last_scan is None:
        # Every group is processed regardless of what's already known, so the
        # known-path lookup is never consulted — skip the DB queries entirely.
        return list(group_items)

    groups_to_process: list[tuple[tuple[str, str], list[str]]] = []
    for start in range(0, len(group_items), batch_size):
        batch = group_items[start : start + batch_size]
        batch_paths = [path for _, paths in batch for path in paths]
        known_paths = known_paths_for(batch_paths)
        for group_key, paths in batch:
            if _group_needs_processing(paths, known_paths, full_scan, last_scan):
                groups_to_process.append((group_key, paths))
    return groups_to_process


def _last_finished_scan(user):
    """Most recent finished photo scan for ``user``, used as the change baseline."""
    return (
        LongRunningJob.objects.filter(finished=True)
        .filter(job_type=LongRunningJob.JOB_SCAN_PHOTOS)
        .filter(started_by=user)
        .order_by("-finished_at")
        .first()
    )


def wait_for_group_and_process_metadata(
    group_id: str,
    metadata_paths: list[str],
    user_id: int,
    full_scan: bool,
    job_id: UUID | str,
    expected_count: int,
    *,
    attempt: int = 1,
    max_attempts: int = 2,
    **kwargs,  # Django-Q may pass additional arguments like 'schedule'
):
    """
    Sentinel task: waits until the expected number of image/video tasks in the group complete,
    then processes metadata files. It runs inside a django-q worker (non-blocking for the caller).

    Failure handling:
    - If the group is not complete yet, it will re-enqueue itself up to `max_attempts`.
    - After exhausting attempts, it proceeds with metadata processing anyway (best-effort).
    """
    from django_q.tasks import count_group
    from django.contrib.auth import get_user_model

    util.logger.info(
        f"Sentinel attempt {attempt}/{max_attempts} for group {group_id} (expecting {expected_count} tasks)"
    )

    # Check current completion count for the group
    try:
        completed = count_group(group_id)  # counts successes by default
    except Exception as e:
        util.logger.warning(
            f"Could not read group status for {group_id}: {e}. Treating as incomplete."
        )
        completed = 0

    # Normalize to an int to avoid None-related type issues
    completed_int = int(completed or 0)

    if completed_int < expected_count and attempt < max_attempts:
        util.logger.info(
            f"Group {group_id} not complete yet: {completed_int}/{expected_count}. Re-enqueue sentinel (attempt {attempt + 1})."
        )
        # Requeue the sentinel to check again later
        AsyncTask(
            wait_for_group_and_process_metadata,
            group_id,
            metadata_paths,
            user_id,
            full_scan,
            job_id,
            expected_count,
            attempt=attempt + 1,
            max_attempts=max_attempts,
            schedule=datetime.timedelta(seconds=5),
        ).run()
        return

    # Proceed with metadata processing (either completed or after exhausting attempts)
    if completed_int < expected_count:
        util.logger.warning(
            f"Proceeding with metadata despite incomplete image group {group_id}: {completed_int}/{expected_count}."
        )
    else:
        util.logger.info(
            f"Image group {group_id} completed. Processing {len(metadata_paths)} metadata files"
        )

    if not metadata_paths:
        util.logger.info("No metadata files to process after images completion")
        return

    User = get_user_model()
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        util.logger.warning(
            f"User {user_id} not found when processing metadata for job {job_id}"
        )
        return

    last_scan = _last_finished_scan(user)

    for path in metadata_paths:
        try:
            photo_scanner(user, last_scan, full_scan, path, job_id)
        except Exception as e:
            util.logger.exception(
                f"Failed processing metadata {path} for job {job_id}: {e}"
            )


def photo_scanner(user, last_scan, full_scan, path, job_id):
    """
    Check if a single file needs processing and queue it.

    Used primarily for metadata files after the main scan.
    """
    files_to_check = [path]
    files_to_check.extend(get_sidecar_files_in_priority_order(path))
    if (
        not Photo.objects.filter(files__path=path).exists()
        or full_scan
        or not last_scan
        or any(
            [_file_was_modified_after(p, last_scan.finished_at) for p in files_to_check]
        )
    ):
        # Queue processing for this file. Metadata is queued here without grouping on purpose,
        # because grouping is managed at the higher-level scan phase to ensure images complete first.
        AsyncTask(handle_new_image, user, path, job_id).run()
    else:
        update_scan_counter(job_id)


def backfill_missing_aspect_ratios(user):
    """Recalculate aspect ratios for photos that have a thumbnail but no ratio.

    Every grid view filters on ``thumbnail__aspect_ratio__isnull=False``, so a
    photo without one is invisible in the UI with no other symptom — the library
    just looks short. Returns the number of photos still missing an aspect ratio
    after this pass, and logs a warning when that number is non-zero.
    """
    photos_with_missing_aspect_ratio = Photo.objects.filter(
        Q(owner=user.id)
        & Q(thumbnail__isnull=False)
        & Q(thumbnail__thumbnail_big__isnull=False)
        & Q(thumbnail__aspect_ratio__isnull=True)
    )
    if not photos_with_missing_aspect_ratio.exists():
        return 0

    util.logger.info(
        f"Found {photos_with_missing_aspect_ratio.count()} photos with missing aspect ratios"
    )
    for photo in photos_with_missing_aspect_ratio:
        try:
            thumbnail = getattr(photo, "thumbnail", None)
            if thumbnail and isinstance(thumbnail, Thumbnail):
                thumbnail._calculate_aspect_ratio()
        except Exception as e:
            util.logger.exception(
                f"Could not calculate aspect ratio for photo {photo.image_hash}: {str(e)}"
            )

    # ``.all()`` re-queries: iterating above cached the pre-repair rows.
    still_missing = photos_with_missing_aspect_ratio.all().count()
    if still_missing:
        util.logger.warning(
            f"{still_missing} photos still have no aspect ratio after the repair "
            "pass; they will not appear in the timeline or album views until it "
            "can be calculated"
        )
    return still_missing


def _discover_scan_paths(scan_directory, scan_files):
    """Collect every candidate file path, either from an explicit list or a walk."""
    photo_list = []
    if scan_files:
        walk_files(scan_files, photo_list)
    else:
        walk_directory(scan_directory, photo_list)
    return photo_list


def _partition_scan_paths(photo_list):
    """Split discovered paths into (directory, basename) file groups and metadata.

    Grouping RAW+JPEG variants together is what lets Phase 2 create one Photo per
    group; metadata files are held back because they need their parent photo to
    exist first.
    """
    file_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    metadata_paths: list[str] = []
    for path in photo_list:
        if is_metadata(path):
            metadata_paths.append(path)
        else:
            file_groups[get_file_grouping_key(path)].append(path)
    return file_groups, metadata_paths


def _known_paths(batch_paths):
    return set(
        Photo.objects.filter(files__path__in=batch_paths).values_list(
            "files__path", flat=True
        )
    )


def _queue_scan_work(
    user, groups_to_process, metadata_paths, full_scan, last_scan, job_id
):
    """Queue the image groups, then arrange for the metadata files to follow them."""
    image_group_id = str(uuid.uuid4())
    for _, paths in groups_to_process:
        AsyncTask(
            handle_file_group,
            user,
            paths,
            job_id,
            group=image_group_id,
        ).run()

    if not metadata_paths:
        return

    if not groups_to_process:
        util.logger.info(
            f"No images to process, processing {len(metadata_paths)} metadata files directly"
        )
        for path in metadata_paths:
            photo_scanner(user, last_scan, full_scan, path, job_id)
        return

    util.logger.info(
        f"Scheduling sentinel to process {len(metadata_paths)} metadata files after {len(groups_to_process)} image groups"
    )
    AsyncTask(
        wait_for_group_and_process_metadata,
        image_group_id,
        metadata_paths,
        user.id,
        full_scan,
        job_id,
        len(groups_to_process),
        attempt=1,
        max_attempts=2,
    ).run()


def _queue_followup_jobs(user, full_scan, scan_directory, scan_files):
    """Queue the jobs that run once the scan itself has been dispatched."""
    # if the scan type is not the default user scan directory, or if it is specified as only scanning
    # specific files, there is no need to rescan fully for missing photos.
    if full_scan or (scan_directory == user.scan_directory and not scan_files):
        AsyncTask(scan_missing_photos, user, uuid.uuid4()).run()

    # Run repair job to fix any previously ungrouped file variants
    # This handles race conditions from previous scans and incremental adds
    AsyncTask(repair_ungrouped_file_variants, user, uuid.uuid4()).run()

    if settings.FEATURE_SCENE_CLASSIFICATION:
        AsyncTask(generate_tags, user, uuid.uuid4(), full_scan).run()
    if settings.FEATURE_REVERSE_GEOCODING:
        AsyncTask(add_geolocation, user, uuid.uuid4(), full_scan).run()

    # The scan faces job will have issues if the embeddings haven't been generated before it runs
    chain = Chain()
    chain.append(batch_calculate_clip_embedding, user)
    if settings.FEATURE_FACE_DETECTION:
        chain.append(scan_faces, user, uuid.uuid4(), full_scan)
    chain.run()


def scan_photos(user, full_scan, job_id, scan_directory="", scan_files=None):
    """
    Two-phase scan to avoid race conditions with RAW+JPEG grouping.

    Phase 1: Collect all files and group by (directory, basename)
             - IMG_001.jpg, IMG_001.CR2, IMG_001.xmp -> one group
             - IMG_002.jpg -> separate group

    Phase 2: Process each group sequentially, creating one Photo per group
             with all file variants attached.

    This eliminates the race condition where concurrent processing of
    RAW and JPEG files could create separate Photos.

    Args:
        user: The user performing the scan
        full_scan: If True, rescan all files; otherwise only new/modified
        job_id: Job ID for tracking progress
        scan_directory: Directory to scan (defaults to user's scan_directory)
        scan_files: Optional list of specific files to scan
    """
    if scan_files is None:
        scan_files = []
    thumbnail_dirs = [
        os.path.join(settings.MEDIA_ROOT, "square_thumbnails_small"),
        os.path.join(settings.MEDIA_ROOT, "square_thumbnails"),
        os.path.join(settings.MEDIA_ROOT, "thumbnails_big"),
    ]
    for directory in thumbnail_dirs:
        os.makedirs(directory, exist_ok=True)

    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        job_id=job_id,
    )
    photo_count_before = Photo.objects.count()

    try:
        if scan_directory == "":
            scan_directory = user.scan_directory
        photo_list = _discover_scan_paths(scan_directory, scan_files)
        files_found = len(photo_list)
        last_scan = _last_finished_scan(user)

        # === PHASE 1: Group files by (directory, basename) ===
        # This ensures RAW+JPEG pairs are processed together, eliminating race conditions
        file_groups, metadata_paths = _partition_scan_paths(photo_list)

        # Determine which groups need processing.
        #
        # The "do we already have this file?" test is answered from the DB in
        # BATCHES rather than one query per file: for each batch of groups we
        # fetch the known paths among that batch in a single ``files__path__in``
        # query, decide the batch, then discard the set. This keeps the win of
        # the original change (one round-trip per ~10k groups instead of a
        # ``Photo...exists()`` per file — 30-35x faster scan start-up on a large
        # library) while bounding memory to one batch. Loading every known path
        # at once would be O(library) and, on top of the already-resident
        # ``file_groups``, could spike RAM on very large collections in
        # constrained-RAM environments (e.g. ~725 MB at 5M photos vs <2 MB here).
        groups_to_process = _select_groups_to_process(
            list(file_groups.items()), _known_paths, full_scan, last_scan
        )

        # Progress target is number of groups (not individual files)
        # Each group = one Photo with potentially multiple file variants
        total_groups = len(groups_to_process) + len(metadata_paths)
        lrj.update_progress(current=0, target=total_groups)
        db.connections.close_all()

        util.logger.info(
            f"Grouped {files_found} files into {len(file_groups)} groups, {len(groups_to_process)} need processing"
        )

        # === PHASE 2: Process each file group ===
        # Process groups sequentially to avoid race conditions
        # Each group creates one Photo with all file variants
        _queue_scan_work(
            user, groups_to_process, metadata_paths, full_scan, last_scan, job_id
        )

        util.logger.info(f"Scanned {files_found} files in : {scan_directory}")

        # If no files were queued for processing (empty directory or all files already processed),
        # mark the job as finished immediately since progress_current will equal progress_target (both 0)
        LongRunningJob.objects.filter(
            job_id=job_id, progress_current=F("progress_target")
        ).update(finished=True, finished_at=timezone.now())

        util.logger.info("Finished updating album things")

        # Check for photos with missing aspect ratios but existing thumbnails
        backfill_missing_aspect_ratios(user)

        _queue_followup_jobs(user, full_scan, scan_directory, scan_files)

    except Exception as e:
        util.logger.exception("An error occurred: ")
        lrj.fail(error=e)

    added_photo_count = Photo.objects.count() - photo_count_before
    util.logger.info(f"Added {added_photo_count} photos")


def scan_missing_photos(user, job_id: UUID):
    """
    Scan for photos whose files no longer exist on disk.

    Args:
        user: The user whose photos to check
        job_id: Job ID for tracking progress
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_MISSING_PHOTOS,
        job_id=job_id,
    )
    try:
        existing_photos = Photo.objects.filter(owner=user.id).order_by("image_hash")

        paginator = Paginator(existing_photos, 5000)
        lrj.update_progress(current=0, target=paginator.num_pages)
        for page in range(1, paginator.num_pages + 1):
            # Check for cancellation
            if is_job_cancelled(job_id):
                util.logger.info("Scan missing photos job cancelled")
                return
            for existing_photo in paginator.page(page).object_list:
                existing_photo._check_files()

            update_scan_counter(job_id)

        util.logger.info("Finished checking paths for missing photos")
    except Exception as e:
        util.logger.exception("An error occurred: ")
        lrj.fail(error=e)
