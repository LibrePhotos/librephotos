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


def _file_was_modified_after(filepath, time):
    """Check if a file was modified after a given time."""
    try:
        modified = os.path.getmtime(filepath)
    except OSError:
        return False
    return datetime.datetime.fromtimestamp(modified).replace(tzinfo=pytz.utc) > time


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

    last_scan = (
        LongRunningJob.objects.filter(finished=True)
        .filter(job_type=LongRunningJob.JOB_SCAN_PHOTOS)
        .filter(started_by=user)
        .order_by("-finished_at")
        .first()
    )

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


def scan_photos(user, full_scan, job_id, scan_directory="", scan_files=[]):
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
        photo_list = []
        if scan_files:
            walk_files(scan_files, photo_list)
        else:
            walk_directory(scan_directory, photo_list)
        files_found = len(photo_list)
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=1)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )

        # === PHASE 1: Group files by (directory, basename) ===
        # This ensures RAW+JPEG pairs are processed together, eliminating race conditions
        file_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
        metadata_paths: list[str] = []

        for path in photo_list:
            if is_metadata(path):
                # Metadata files are processed after their parent photos exist
                metadata_paths.append(path)
            else:
                # Group by (directory, basename_lowercase)
                group_key = get_file_grouping_key(path)
                file_groups[group_key].append(path)

        # Determine which groups need processing
        groups_to_process: list[tuple[tuple[str, str], list[str]]] = []

        for group_key, paths in file_groups.items():
            # Check if any file in this group needs processing
            needs_processing = False

            for path in paths:
                files_to_check = [path]
                files_to_check.extend(get_sidecar_files_in_priority_order(path))

                if (
                    not Photo.objects.filter(files__path=path).exists()
                    or full_scan
                    or not last_scan
                    or any(
                        [
                            _file_was_modified_after(p, last_scan.finished_at)
                            for p in files_to_check
                        ]
                    )
                ):
                    needs_processing = True
                    break

            if needs_processing:
                groups_to_process.append((group_key, paths))

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
        image_group_id = str(uuid.uuid4())

        for group_key, paths in groups_to_process:
            AsyncTask(
                handle_file_group,
                user,
                paths,
                job_id,
                group=image_group_id,
            ).run()

        # If there are only metadata files (no image groups queued), process metadata now
        if not groups_to_process and metadata_paths:
            util.logger.info(
                f"No images to process, processing {len(metadata_paths)} metadata files directly"
            )
            for path in metadata_paths:
                photo_scanner(user, last_scan, full_scan, path, job_id)

        # If there are images and metadata, enqueue a sentinel task that waits for the image group
        if groups_to_process and metadata_paths:
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

        util.logger.info(f"Scanned {files_found} files in : {scan_directory}")

        # If no files were queued for processing (empty directory or all files already processed),
        # mark the job as finished immediately since progress_current will equal progress_target (both 0)
        LongRunningJob.objects.filter(
            job_id=job_id, progress_current=F("progress_target")
        ).update(finished=True, finished_at=timezone.now())

        util.logger.info("Finished updating album things")

        # Check for photos with missing aspect ratios but existing thumbnails
        photos_with_missing_aspect_ratio = Photo.objects.filter(
            Q(owner=user.id)
            & Q(thumbnail__isnull=False)
            & Q(thumbnail__thumbnail_big__isnull=False)
            & Q(thumbnail__aspect_ratio__isnull=True)
        )
        if photos_with_missing_aspect_ratio.exists():
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

        # if the scan type is not the default user scan directory, or if it is specified as only scanning
        # specific files, there is no need to rescan fully for missing photos.
        if full_scan or (scan_directory == user.scan_directory and not scan_files):
            AsyncTask(scan_missing_photos, user, uuid.uuid4()).run()

        # Run repair job to fix any previously ungrouped file variants
        # This handles race conditions from previous scans and incremental adds
        AsyncTask(repair_ungrouped_file_variants, user, uuid.uuid4()).run()

        AsyncTask(generate_tags, user, uuid.uuid4(), full_scan).run()
        AsyncTask(add_geolocation, user, uuid.uuid4(), full_scan).run()

        # The scan faces job will have issues if the embeddings haven't been generated before it runs
        chain = Chain()
        chain.append(batch_calculate_clip_embedding, user)
        chain.append(scan_faces, user, uuid.uuid4(), full_scan)
        chain.run()

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
