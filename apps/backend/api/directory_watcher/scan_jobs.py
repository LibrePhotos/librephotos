"""
Main scan jobs for photo discovery and processing.

This module contains the core scan_photos function that implements the
two-phase scan architecture to avoid race conditions with RAW+JPEG grouping.
"""

import datetime
import logging
import os
import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Any
from uuid import UUID

from django import db
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import Q

from api.directory_watcher.file_grouping import (
    get_file_grouping_key,
    get_sidecar_grouping_keys,
)
from api.directory_watcher.file_handlers import handle_file_group, handle_new_image
from api.directory_watcher.processing_jobs import (
    add_geolocation,
    generate_tags,
    probe_videos,
    scan_faces,
    videos_to_probe,
)
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.directory_watcher.utils import (
    finish_job_if_complete,
    is_job_cancelled,
    update_job_result,
    update_scan_counter,
    walk_directory,
    walk_files,
)
from api.jobs.queue import JobStep, enqueue_chain, enqueue_followup, enqueue_task
from api.metadata.reader import existing_sidecars
from api.mime import VIDEO_EXTENSIONS, extension
from api.models import LongRunningJob, Photo, Thumbnail, User
from api.photos.files import detach_missing_files
from api.photos.media_files import is_metadata
from api.runtime.features import feature_enabled
from api.search.embedding_jobs import batch_calculate_clip_embedding
from api.search.semantic import semantic_shares_tagger
from api.thumbnails import render
from api.video import color

logger = logging.getLogger(__name__)


# Number of file groups whose known-paths are resolved in a single DB query
# during scan Phase 1. Larger batches mean fewer round-trips (faster start-up)
# but a bigger transient ``known_paths`` set; ~10k groups is the knee where the
# per-batch query cost stops shrinking, while keeping the transient set tiny
# (well under 2 MB) regardless of total library size.
_PATH_PREFETCH_BATCH = 10000

# A file group: its (directory, basename) key and the paths in it.
_FileGroup = tuple[tuple[str, str], list[str]]


def _file_was_modified_after(filepath: str, time: datetime.datetime | None) -> bool:
    """Check if a file was modified after a given time."""
    try:
        modified = os.path.getmtime(filepath)
    except OSError:
        return False
    # Callers pass the started_at of the baseline scan. A None would have made
    # the comparison below raise TypeError, so it is an invariant violation.
    assert time is not None
    # An aware UTC moment: without ``tz``, fromtimestamp gives the host's local
    # wall-clock time, which is not UTC on Windows (#2193).
    return datetime.datetime.fromtimestamp(modified, tz=datetime.timezone.utc) > time


def _group_needs_processing(
    paths: list[str],
    existing_paths: set[str],
    full_scan: bool,
    last_scan: LongRunningJob | None,
) -> bool:
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
    It compares with the time the baseline scan started: that scan read each
    file some time after its walk, so a file edited while it ran may have been
    read before the edit (#2192).
    """
    for path in paths:
        if path not in existing_paths or full_scan or not last_scan:
            return True
        files_to_check = [path, *existing_sidecars(path)]
        if any(
            _file_was_modified_after(p, last_scan.started_at) for p in files_to_check
        ):
            return True
    return False


def _select_groups_to_process(
    group_items: list[_FileGroup],
    known_paths_for: Callable[[list[str]], set[str]],
    full_scan: bool,
    last_scan: LongRunningJob | None,
    batch_size: int = _PATH_PREFETCH_BATCH,
) -> list[_FileGroup]:
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

    groups_to_process: list[_FileGroup] = []
    for start in range(0, len(group_items), batch_size):
        batch = group_items[start : start + batch_size]
        batch_paths = [path for _, paths in batch for path in paths]
        known_paths = known_paths_for(batch_paths)
        for group_key, paths in batch:
            if _group_needs_processing(paths, known_paths, full_scan, last_scan):
                groups_to_process.append((group_key, paths))
    return groups_to_process


def photo_scanner(
    user: User,
    last_scan: LongRunningJob | None,
    full_scan: bool,
    path: str,
    job_id: UUID | str,
) -> None:
    """
    Check if a single file needs processing and queue it.

    Used primarily for metadata files after the main scan.
    """
    files_to_check = [path]
    files_to_check.extend(existing_sidecars(path))
    if (
        not Photo.objects.filter(files__path=path).exists()
        or full_scan
        or not last_scan
        or any(
            [_file_was_modified_after(p, last_scan.started_at) for p in files_to_check]
        )
    ):
        # Queue processing for this file. Metadata is queued here without grouping on purpose,
        # because grouping is managed at the higher-level scan phase to ensure images complete first.
        enqueue_task(handle_new_image, user, path, job_id)
    else:
        update_scan_counter(job_id)


def backfill_missing_aspect_ratios(user: User) -> int:
    """Recalculate aspect ratios for photos that have a thumbnail but no ratio.

    Every grid view filters on ``thumbnail__aspect_ratio__isnull=False``, so a
    photo without one is invisible in the UI with no other symptom — the library
    just looks short. Returns the number of photos still missing an aspect ratio
    after this pass, and logs a warning when that number is non-zero.
    """
    photos_with_missing_aspect_ratio = Photo.objects.owned_by(user).filter(
        Q(thumbnail__isnull=False)
        & Q(thumbnail__thumbnail_big__isnull=False)
        & Q(thumbnail__aspect_ratio__isnull=True)
    )
    if not photos_with_missing_aspect_ratio.exists():
        return 0

    logger.info(
        "Found %s photos with missing aspect ratios",
        photos_with_missing_aspect_ratio.count(),
    )
    for photo in photos_with_missing_aspect_ratio:
        try:
            thumbnail = getattr(photo, "thumbnail", None)
            if thumbnail and isinstance(thumbnail, Thumbnail):
                render.calculate_aspect_ratio(thumbnail)
        except Exception as e:
            logger.exception(
                "Could not calculate aspect ratio for photo %s: %s",
                photo.image_hash,
                str(e),
            )

    # ``.all()`` re-queries: iterating above cached the pre-repair rows.
    still_missing = photos_with_missing_aspect_ratio.all().count()
    if still_missing:
        logger.warning(
            "%s photos still have no aspect ratio after the repair "
            "pass; they will not appear in the timeline or album views until it "
            "can be calculated",
            still_missing,
        )
    return still_missing


def _discover_scan_paths(scan_directory: str, scan_files: list[str]) -> list[str]:
    """Collect every candidate file path, either from an explicit list or a walk."""
    photo_list: list[str] = []
    if scan_files:
        walk_files(scan_files, photo_list)
    else:
        walk_directory(scan_directory, photo_list)
    return photo_list


def _partition_scan_paths(
    photo_list: list[str],
) -> tuple[dict[tuple[str, str], list[str]], list[str]]:
    """Split discovered paths into (directory, basename) file groups and metadata.

    Grouping RAW+JPEG variants together is what lets Phase 2 create one Photo per
    group. An XMP sidecar joins the group of the media file it describes, so it
    is attached in the same task that creates that Photo instead of racing it.
    Only sidecars whose media file is not part of this scan are returned as
    ``metadata_paths``: their Photo, if any, already exists.
    """
    file_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    sidecar_paths: list[str] = []
    for path in photo_list:
        if is_metadata(path):
            sidecar_paths.append(path)
        else:
            file_groups[get_file_grouping_key(path)].append(path)

    metadata_paths: list[str] = []
    for path in sidecar_paths:
        group_key = next(
            (k for k in get_sidecar_grouping_keys(path) if k in file_groups), None
        )
        if group_key is None:
            metadata_paths.append(path)
        else:
            file_groups[group_key].append(path)
    return file_groups, metadata_paths


def _known_paths(batch_paths: list[str]) -> set[str]:
    return set(
        Photo.objects.filter(files__path__in=batch_paths).values_list(
            "files__path", flat=True
        )
    )


def _has_video(paths: list[str]) -> bool:
    return any(extension(path) in VIDEO_EXTENSIONS for path in paths)


def _videos_first(groups: list[_FileGroup]) -> list[_FileGroup]:
    """The file groups with a video first, otherwise in walk order.

    A video takes far longer than a photo (ffmpeg thumbnails, probing, often
    tens of seconds), and the walk tends to reach them last, so the scan ended
    with a few workers on videos and the rest idle. Queued first, they run
    alongside the photos (the Rust experiment's scan: +9.5% files/s).
    """
    return sorted(groups, key=lambda group: not _has_video(group[1]))


def _queue_scan_work(
    user: User,
    groups_to_process: list[_FileGroup],
    metadata_paths: list[str],
    full_scan: bool,
    last_scan: LongRunningJob | None,
    job_id: UUID | str,
) -> None:
    """Queue the file groups and the sidecars whose photo is not in this scan.

    Sidecars of photos in this scan travel inside their file group, so the
    remaining ones have nothing to wait for and are queued directly.
    """
    image_group_id = str(uuid.uuid4())
    for _, paths in _videos_first(groups_to_process):
        enqueue_task(handle_file_group, user, paths, job_id, group=image_group_id)

    if metadata_paths:
        logger.info(
            "Processing %s metadata files for photos outside this scan",
            len(metadata_paths),
        )
    for path in metadata_paths:
        photo_scanner(user, last_scan, full_scan, path, job_id)


# Key in the scan job's ``result`` holding what its follow-ups need. The scan
# job only finishes in whichever worker completes its last file group, long
# after ``scan_photos`` has returned, so this is how that worker learns them.
_FOLLOWUPS_KEY = "followups"


def _remember_followups(
    lrj: LongRunningJob,
    user: User,
    full_scan: bool,
    scan_directory: str,
    scan_files: list[str],
) -> None:
    """Store what the follow-up jobs and later scans need.

    Call before any scan work is queued. A scan of the user's whole scan
    directory is marked as a library scan: only such a scan can be the change
    baseline of the next incremental one (``LongRunningJob.baselines``).
    """
    result: dict[str, Any] = dict(lrj.result) if isinstance(lrj.result, dict) else {}
    library_scan = scan_directory == user.scan_directory and not scan_files
    if library_scan:
        result[LongRunningJob.LIBRARY_SCAN] = True
    result[_FOLLOWUPS_KEY] = {
        "full_scan": bool(full_scan),
        # if the scan type is not the default user scan directory, or if it is
        # specified as only scanning specific files, there is no need to rescan
        # fully for missing photos.
        "scan_missing_photos": bool(full_scan or library_scan),
        "photo_count_before": Photo.objects.owned_by(user).count(),
    }
    lrj.set_result(result)


def queue_scan_followups(job_id: UUID | str) -> None:
    """Queue a finished scan's follow-up jobs.

    Called once, by whoever finished the scan job (see
    ``utils.finish_job_if_complete``): the follow-ups work out what to do when
    they start, so starting them while photos were still being ingested left
    those photos for the next scan.
    """
    # Read back from the job's JSON result, so the values stay untyped here.
    options: dict[str, Any] = {}

    def take_options(result: dict[str, Any], job: LongRunningJob) -> None:
        options.clear()
        options.update(result.pop(_FOLLOWUPS_KEY, None) or {})

    job = update_job_result(job_id, take_options)
    if job is None or not options:
        return
    user = job.started_by

    added_photo_count = (
        Photo.objects.owned_by(user).count() - options["photo_count_before"]
    )
    logger.info("Added %s photos", added_photo_count)

    _queue_followup_jobs(user, options["full_scan"], options["scan_missing_photos"])


def _queue_followup_jobs(user: User, full_scan: bool, scan_missing: bool) -> None:
    """Queue the jobs that run once the scan's own work is done."""
    if scan_missing:
        enqueue_followup(
            user, LongRunningJob.JOB_SCAN_MISSING_PHOTOS, scan_missing_photos, user
        )

    # Run repair job to fix any previously ungrouped file variants
    # This handles race conditions from previous scans and incremental adds
    enqueue_followup(
        user,
        LongRunningJob.JOB_REPAIR_FILE_VARIANTS,
        repair_ungrouped_file_variants,
        user,
    )

    # Only while there is something to do, so a library whose videos have all
    # been probed -- or that has none -- does not get an empty job every scan.
    if color.can_probe() and videos_to_probe(user).exists():
        enqueue_followup(user, LongRunningJob.JOB_PROBE_VIDEOS, probe_videos, user)

    # Read once: whether the tags job runs and whether the embedding job leaves
    # photos to it have to agree, or a switch flipped between two reads leaves
    # photos with neither tags nor search embeddings.
    tags_on = semantic_shares_tagger()
    if tags_on:
        enqueue_followup(
            user,
            LongRunningJob.JOB_GENERATE_TAGS,
            generate_tags,
            user,
        )
    if feature_enabled("REVERSE_GEOCODING"):
        enqueue_followup(
            user,
            LongRunningJob.JOB_ADD_GEOLOCATION,
            add_geolocation,
            user,
            full_scan=full_scan,
        )

    # The scan faces job will have issues if the embeddings haven't been generated before it runs.
    # When the tags job stores the search embeddings too, this run leaves the
    # photos it is about to tag to it (its end queues the rest).
    steps = [
        JobStep(
            LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
            batch_calculate_clip_embedding,
            (user,),
            {"wait_for_tags": tags_on},
        )
    ]
    if feature_enabled("FACE_DETECTION"):
        steps.append(
            JobStep(
                LongRunningJob.JOB_SCAN_FACES,
                scan_faces,
                (user,),
                {"full_scan": full_scan},
            )
        )
    enqueue_chain(user, steps, exclusive=False)


def scan_photos(
    user: User,
    full_scan: bool,
    job_id: UUID | str,
    scan_directory: str = "",
    scan_files: list[str] | None = None,
) -> None:
    """
    Two-phase scan to avoid race conditions with RAW+JPEG grouping.

    Phase 1: Collect all files and group by (directory, basename)
             - IMG_001.jpg, IMG_001.CR2, IMG_001.xmp -> one group
               (IMG_001.jpg.xmp joins it too)
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

    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_SCAN_PHOTOS, job_id)
    if lrj is None:
        return

    try:
        if scan_directory == "":
            scan_directory = user.scan_directory
        photo_list = _discover_scan_paths(scan_directory, scan_files)
        files_found = len(photo_list)
        last_scan = LongRunningJob.baseline_for(user, LongRunningJob.JOB_SCAN_PHOTOS)

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
        _remember_followups(lrj, user, full_scan, scan_directory, scan_files)
        lrj.update_progress(current=0, target=total_groups)
        db.connections.close_all()

        logger.info(
            "Grouped %s files into %s groups, %s need processing",
            files_found,
            len(file_groups),
            len(groups_to_process),
        )

        # === PHASE 2: Process each file group ===
        # Process groups sequentially to avoid race conditions
        # Each group creates one Photo with all file variants
        _queue_scan_work(
            user, groups_to_process, metadata_paths, full_scan, last_scan, job_id
        )

        logger.info("Scanned %s files in : %s", files_found, scan_directory)

        # If no files were queued for processing (empty directory or all files
        # already processed) no worker will ever finish the job, so finish it
        # here; that also queues the follow-up jobs. Otherwise the worker that
        # completes the last queued item does both.
        finish_job_if_complete(job_id)

        logger.info("Finished updating album things")

        # Check for photos with missing aspect ratios but existing thumbnails
        backfill_missing_aspect_ratios(user)

    except Exception as e:
        logger.exception("An error occurred: ")
        lrj.fail(error=e)


def scan_missing_photos(user: User, job_id: UUID) -> None:
    """
    Scan for photos whose files no longer exist on disk.

    Args:
        user: The user whose photos to check
        job_id: Job ID for tracking progress
    """
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_SCAN_MISSING_PHOTOS, job_id)
    if lrj is None:
        return
    try:
        existing_photos = Photo.objects.owned_by(user).order_by("image_hash")

        paginator = Paginator(existing_photos, 5000)
        lrj.update_progress(current=0, target=paginator.num_pages)
        for page in range(1, paginator.num_pages + 1):
            # Check for cancellation
            if is_job_cancelled(job_id):
                logger.info("Scan missing photos job cancelled")
                return
            for existing_photo in paginator.page(page).object_list:
                detach_missing_files(existing_photo)

            update_scan_counter(job_id)

        logger.info("Finished checking paths for missing photos")
    except Exception as e:
        logger.exception("An error occurred: ")
        lrj.fail(error=e)
