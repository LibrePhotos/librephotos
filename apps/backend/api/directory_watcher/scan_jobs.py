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
from collections.abc import Callable, Mapping
from typing import Any, NamedTuple
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
from api.directory_watcher.missing_guard import (
    library_root_problem,
    too_many_missing,
)
from api.directory_watcher.processing_jobs import (
    add_geolocation,
    generate_tags,
    probe_videos,
    scan_faces,
    videos_to_probe,
)
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.directory_watcher.utils import (
    CANCELLATION_CHECK_INTERVAL,
    SkippedDirectory,
    finish_job_if_complete,
    is_job_cancelled,
    record_skipped_directories,
    update_job_result,
    update_scan_counter,
    walk_directory,
    walk_files,
)
from api.jobs.queue import JobStep, enqueue_chain, enqueue_followup, enqueue_task
from api.metadata import takeout
from api.metadata.reader import existing_sidecars
from api.mime import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extension
from api.models import File, FileCopy, LongRunningJob, Photo, Thumbnail, User
from api.photos import indexed_mtimes
from api.photos.files import detach_missing_files, missing_files
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


class KnownFile(NamedTuple):
    """A path the scan has read before, as ``_known_paths`` finds it.

    ``hash`` is its own ``File`` row's (None for an exact copy, which shares
    the row of the file it copies), ``indexed`` what the scan saw of it when
    it read it (``api.photos.indexed_mtimes``; None when nothing is recorded).
    """

    hash: str | None = None
    indexed: indexed_mtimes.Observed | None = None


# The known paths among a batch of scanned paths.
KnownPaths = Mapping[str, KnownFile]

# What the scan sees of a media file that has no record yet.
_Unrecorded = tuple[str, indexed_mtimes.Observed]


def _modified_after(mtime: float, time: datetime.datetime | None) -> bool:
    """Whether the modification time ``mtime`` (seconds) is later than ``time``."""
    # Callers pass the started_at of the baseline scan. A None would have made
    # the comparison below raise TypeError, so it is an invariant violation.
    assert time is not None
    # An aware UTC moment: without ``tz``, fromtimestamp gives the host's local
    # wall-clock time, which is not UTC on Windows (#2193).
    return datetime.datetime.fromtimestamp(mtime, tz=datetime.timezone.utc) > time


def _file_was_modified_after(filepath: str, time: datetime.datetime | None) -> bool:
    """Check if a file was modified after a given time."""
    try:
        modified = os.path.getmtime(filepath)
    except OSError:
        return False
    return _modified_after(modified, time)


def _changed_since_read(path: str, known: KnownFile, last_scan: LongRunningJob) -> bool:
    """Whether the known file ``path`` or one of its sidecars changed since it was read.

    With a record (#2296), what is on disk now is compared with it: another
    modification time, a new sidecar or a removed one is a change, a write
    LibrePhotos recorded is not. A file gone since the walk is no change.
    Without one, a file or sidecar modified after the baseline scan started
    is a change: that scan read each file some time after its walk, so a
    file edited while it ran may have been read before the edit (#2192).
    """
    if known.indexed is not None:
        seen = indexed_mtimes.observe(path)
        return seen.mtime_ns is not None and seen != known.indexed
    files_to_check = [path, *existing_sidecars(path)]
    return any(
        _file_was_modified_after(p, last_scan.started_at) for p in files_to_check
    )


def _recorded_sidecars(paths: list[str], known: KnownPaths) -> set[str]:
    """The ``sidecar_key`` of every sidecar the records of the group's files name.

    Such a sidecar is compared through its media file's record, also when
    the scan never attached it (LibrePhotos wrote it after the last scan).
    """
    names: set[str] = set()
    for path in paths:
        entry = known.get(path)
        if entry is not None and entry.indexed is not None:
            names.update(entry.indexed.sidecars)
    return names


def _group_needs_processing(
    paths: list[str],
    known: KnownPaths,
    full_scan: bool,
    last_scan: LongRunningJob | None,
) -> bool:
    """Return True if any file in a (directory, basename) group must be processed.

    Takes the already-known file paths (resolved one batch at a time by the
    caller) so the "do we have this file?" test is an in-memory lookup
    instead of one ``Photo.objects.filter(files__path=path).exists()`` query
    per file (a round-trip per file — 100k+ on a large library, the dominant
    cost of scan start-up). ``known`` only needs to cover this group's paths.

    The change check (and the sidecar paths it stats) is only reached for a
    file we already have, on an incremental scan with a baseline — i.e. the
    only case where "did it change since it was read?" is the deciding
    question (``_changed_since_read``). A sidecar named in the record of one
    of the group's media files is checked with that file.

    A Google Takeout JSON in the group (``_attach_takeout_json``) is never a
    known file. LibrePhotos never writes it, so it counts by its modified time
    against the start of the baseline scan: editing it, or adding it after the
    photo was scanned, reads the photo again (#2270).
    """
    if full_scan or not last_scan:
        return bool(paths)
    recorded_sidecars = _recorded_sidecars(paths, known)
    takeout_json = [path for path in paths if takeout.is_takeout_candidate(path)]
    for path in paths:
        if path in takeout_json:
            continue
        if is_metadata(path) and indexed_mtimes.sidecar_key(path) in recorded_sidecars:
            continue
        if path not in known:
            return True
        if _changed_since_read(path, known[path], last_scan):
            return True
    return any(
        _file_was_modified_after(path, last_scan.started_at) for path in takeout_json
    )


def _unrecorded_and_unchanged(
    paths: list[str], known: KnownPaths, last_scan: LongRunningJob
) -> list[_Unrecorded]:
    """What is on disk for the group's media files that have no record yet.

    For a group the scan leaves alone, and only what was not modified after
    the baseline scan started, judged by this observation itself: the record
    it becomes then says what that scan read (#2296). A library indexed
    before the record existed gets it on its first incremental scan, so
    LibrePhotos' writes after that do not make the next scan read the photos
    again.
    """
    found: list[_Unrecorded] = []
    for path in paths:
        entry = known.get(path)
        if entry is None or entry.hash is None or entry.indexed is not None:
            continue
        if is_metadata(path):
            continue
        seen = indexed_mtimes.observe(path)
        if seen.mtime_ns is None:
            continue
        times = [seen.mtime_ns, *seen.sidecars.values()]
        if not any(_modified_after(ns / 1e9, last_scan.started_at) for ns in times):
            found.append((path, seen))
    return found


def _record_unchanged(found: list[_Unrecorded]) -> None:
    """Store the records ``_unrecorded_and_unchanged`` found, in a few queries."""
    if not found:
        return
    rows = File.objects.in_bulk([path for path, _ in found], field_name="path")
    updated: list[File] = []
    for path, seen in found:
        row = rows.get(path)
        if row is not None:
            row.indexed_mtime_ns = seen.mtime_ns
            row.indexed_sidecar_mtimes = dict(seen.sidecars)
            updated.append(row)
    File.objects.bulk_update(
        updated, ["indexed_mtime_ns", "indexed_sidecar_mtimes"], batch_size=500
    )


def _select_groups_to_process(
    group_items: list[_FileGroup],
    known_paths_for: Callable[[list[str]], KnownPaths],
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
    covers every path each group needs to check. The groups left alone that
    have no record yet get one (``_unrecorded_and_unchanged``).
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
        unrecorded: list[_Unrecorded] = []
        for group_key, paths in batch:
            if _group_needs_processing(paths, known_paths, full_scan, last_scan):
                groups_to_process.append((group_key, paths))
            else:
                unrecorded += _unrecorded_and_unchanged(paths, known_paths, last_scan)
        _record_unchanged(unrecorded)
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
    if is_job_cancelled(job_id):
        return
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


def _discover_scan_paths(
    scan_directory: str, scan_files: list[str]
) -> tuple[list[str], list[SkippedDirectory]]:
    """Collect every candidate file path, either from an explicit list or a walk.

    Also returns the subdirectories the walk had to skip because they could
    not be listed.
    """
    photo_list: list[str] = []
    if scan_files:
        walk_files(scan_files, photo_list)
        return photo_list, []
    return photo_list, walk_directory(scan_directory, photo_list)


def _partition_scan_paths(
    photo_list: list[str], walked: bool = True
) -> tuple[dict[tuple[str, str], list[str]], list[str]]:
    """Split discovered paths into (directory, basename) file groups and metadata.

    Grouping RAW+JPEG variants together is what lets Phase 2 create one Photo per
    group. An XMP sidecar joins the group of the media file it describes, so it
    is attached in the same task that creates that Photo instead of racing it.
    Only sidecars whose media file is not part of this scan are returned as
    ``metadata_paths``: their Photo, if any, already exists.

    A Google Takeout JSON joins the group of its media file too
    (``_attach_takeout_json``); one that describes no file here (an album's
    ``metadata.json``) is dropped. ``walked``: ``photo_list`` holds every
    file of its directories, so no directory needs listing again.
    """
    file_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    sidecar_paths: list[str] = []
    takeout_names: dict[str, list[str]] = defaultdict(list)
    for path in photo_list:
        if is_metadata(path):
            sidecar_paths.append(path)
        elif takeout.is_takeout_candidate(path):
            directory, name = os.path.split(path)
            takeout_names[directory].append(name)
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
    _attach_takeout_json(file_groups, takeout_names if walked else None)
    return file_groups, metadata_paths


def _takeout_lookup_order(paths: list[str]) -> list[str]:
    """The group's media files in the order the main file is picked
    (``select_main_file``): images, then videos, then the rest, by path."""

    def rank(path: str) -> tuple[int, str]:
        ext = extension(path)
        kind = 0 if ext in IMAGE_EXTENSIONS else 1 if ext in VIDEO_EXTENSIONS else 2
        return kind, path

    return sorted((path for path in paths if not is_metadata(path)), key=rank)


def _attach_takeout_json(
    file_groups: dict[tuple[str, str], list[str]],
    walked_names: dict[str, list[str]] | None,
) -> None:
    """Add the Google Takeout JSON of each file group to its paths (#2270).

    ``walked_names`` holds the JSON names of every walked directory, so none
    is listed again; without it (a scan of chosen files) each directory of the
    groups is listed once.
    """
    known = (
        None
        if walked_names is None
        else {
            directory: walked_names.get(directory, []) for directory, _ in file_groups
        }
    )
    with takeout.directory_listings(known):
        for paths in file_groups.values():
            found = takeout.takeout_json_path(_takeout_lookup_order(paths))
            if found is not None:
                paths.append(found)


def _known_paths(batch_paths: list[str]) -> dict[str, KnownFile]:
    """The paths among *batch_paths* that belong to a photo whose metadata was read.

    Each with its ``File`` row's hash and what the scan recorded of it.

    A photo whose metadata read failed (``metadata_read_at`` is None) counts as
    unknown, so an incremental scan reads it again (#2271); its thumbnails are
    kept, ``generate_thumbnail`` skips the ones that exist.

    An exact copy of such a photo's file is known too, through its
    ``FileCopy`` (#2417), while the file it copies is still on disk: when that
    one is gone, the scan reads the copy again and it takes the file over.
    """
    known = {
        path: KnownFile(file_hash, indexed_mtimes.recorded(mtime_ns, sidecars))
        for path, file_hash, mtime_ns, sidecars in Photo.objects.filter(
            files__path__in=batch_paths, metadata_read_at__isnull=False
        ).values_list(
            "files__path",
            "files__hash",
            "files__indexed_mtime_ns",
            "files__indexed_sidecar_mtimes",
        )
    }
    copies = (
        FileCopy.objects.filter(
            path__in=batch_paths,
            file__missing=False,
            file__photo__metadata_read_at__isnull=False,
        )
        .values_list("path", "file__path")
        .distinct()
    )
    for path, original in copies:
        if path not in known and os.path.exists(original):
            known[path] = KnownFile()
    return known


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
    force_files: bool = False,
) -> None:
    """Queue the file groups and the sidecars whose photo is not in this scan.

    Sidecars of photos in this scan travel inside their file group, so the
    remaining ones have nothing to wait for and are queued directly.
    ``force_files``: the groups rebuild their thumbnails too (a rescan of
    chosen photos, #2214).
    """
    image_group_id = str(uuid.uuid4())
    group_options = {"rebuild_thumbnails": True} if force_files else {}
    for idx, (_, paths) in enumerate(_videos_first(groups_to_process)):
        if _queuing_cancelled(idx, job_id):
            return
        enqueue_task(
            handle_file_group,
            user,
            paths,
            job_id,
            group=image_group_id,
            **group_options,
        )

    if metadata_paths:
        logger.info(
            "Processing %s metadata files for photos outside this scan",
            len(metadata_paths),
        )
    for idx, path in enumerate(metadata_paths):
        if _queuing_cancelled(idx, job_id):
            return
        photo_scanner(user, last_scan, full_scan or force_files, path, job_id)


def _queuing_cancelled(idx: int, job_id: UUID | str) -> bool:
    """Whether the scan was cancelled, checked every so many queued items."""
    if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
        logger.info("job %s was cancelled, not queuing the rest of the scan", job_id)
        return True
    return False


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
    skipped_directories: bool = False,
) -> None:
    """Store what the follow-up jobs and later scans need.

    Call before any scan work is queued. A scan of the user's whole scan
    directory is marked as a library scan: only such a scan can be the change
    baseline of the next incremental one (``LongRunningJob.baselines``).
    """
    result: dict[str, Any] = dict(lrj.result) if isinstance(lrj.result, dict) else {}
    library_scan = scan_directory == user.scan_directory and not scan_files
    scan_missing = bool(full_scan or library_scan)
    if skipped_directories:
        # The files under a skipped folder were not seen. They may not even be
        # reachable for the existence check, which would flag them all
        # missing, and a change to them is not picked up by this scan, so it
        # cannot be the baseline of the next incremental one either.
        if scan_missing:
            logger.warning(
                "job %s: skipping the missing-file check, the scan skipped a directory",
                lrj.job_id,
            )
        scan_missing = False
        library_scan = False
    if library_scan:
        result[LongRunningJob.LIBRARY_SCAN] = True
    result[_FOLLOWUPS_KEY] = {
        "full_scan": bool(full_scan),
        # if the scan type is not the default user scan directory, or if it is
        # specified as only scanning specific files, there is no need to rescan
        # fully for missing photos.
        "scan_missing_photos": scan_missing,
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
    force_files: bool = False,
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
        force_files: Read every file of ``scan_files`` again, also the ones
            that did not change, and rebuild their thumbnails (#2214). The
            follow-up jobs still only cover what is new (``full_scan`` stays
            as given), and like any scan of chosen files it is not the change
            baseline of the next scan (``_remember_followups``).
    """
    if scan_files is None:
        scan_files = []
    # Only a list of files is ever forced: a forced walk would read the whole
    # library again without being a full scan.
    force_files = force_files and bool(scan_files)
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
        if scan_directory == user.scan_directory and not scan_files:
            problem = library_root_problem(user, scan_directory)
            if problem is not None:
                # A scan of an unmounted library would flag every photo missing.
                logger.warning(
                    "job %s: not scanning, the scan directory looks unmounted", job_id
                )
                lrj.fail(error=problem)
                return
        photo_list, skipped = _discover_scan_paths(scan_directory, scan_files)
        files_found = len(photo_list)
        last_scan = LongRunningJob.baseline_for(user, LongRunningJob.JOB_SCAN_PHOTOS)

        # === PHASE 1: Group files by (directory, basename) ===
        # This ensures RAW+JPEG pairs are processed together, eliminating race conditions
        file_groups, metadata_paths = _partition_scan_paths(
            photo_list, walked=not scan_files
        )

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
            list(file_groups.items()), _known_paths, full_scan or force_files, last_scan
        )

        # Progress target is number of groups (not individual files)
        # Each group = one Photo with potentially multiple file variants
        total_groups = len(groups_to_process) + len(metadata_paths)
        _remember_followups(
            lrj, user, full_scan, scan_directory, scan_files, bool(skipped)
        )
        lrj.update_progress(current=0, target=total_groups)
        record_skipped_directories(job_id, skipped)
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
            user,
            groups_to_process,
            metadata_paths,
            full_scan,
            last_scan,
            job_id,
            force_files,
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
    Flag the photos whose files no longer exist on disk.

    Every photo is checked before anything changes: when the scan directory
    looks unmounted, or too much of the library would lose all its files
    (``missing_guard``), the job fails and detaches nothing. The one change
    the check itself makes is to let an exact copy on disk take over a file
    whose own path is gone (``missing_files``, #2417): such a photo is not
    missing, and does not count towards the guard.

    Args:
        user: The user whose photos to check
        job_id: Job ID for tracking progress
    """
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_SCAN_MISSING_PHOTOS, job_id)
    if lrj is None:
        return
    try:
        # Again: the mount can drop between the scan and this follow-up.
        problem = (
            library_root_problem(user, user.scan_directory)
            if user.scan_directory
            else None
        )
        if problem is not None:
            logger.warning(
                "job %s: not checking for missing files, the scan directory"
                " looks unmounted",
                job_id,
            )
            lrj.fail(error=problem)
            return

        existing_photos = (
            Photo.objects.owned_by(user)
            .order_by("image_hash")
            .prefetch_related("files")
        )
        paginator = Paginator(existing_photos, 5000)
        # A step per page checked, and one for detaching what is missing.
        lrj.update_progress(current=0, target=paginator.num_pages + 1)
        # Photo id -> the ids of its files that are gone.
        missing: dict[UUID, list[str]] = {}
        photos_with_files = 0
        would_lose_all = 0
        for page in range(1, paginator.num_pages + 1):
            if is_job_cancelled(job_id):
                logger.info("Scan missing photos job cancelled")
                return
            for existing_photo in paginator.page(page).object_list:
                file_count = len(existing_photo.files.all())
                if not file_count:
                    continue
                photos_with_files += 1
                gone = missing_files(existing_photo)
                if gone:
                    missing[existing_photo.pk] = [file.pk for file in gone]
                    would_lose_all += len(gone) == file_count
            update_scan_counter(job_id)

        problem = too_many_missing(would_lose_all, photos_with_files)
        if problem is not None:
            logger.warning(
                "job %s: not detaching %s missing photos of %s",
                job_id,
                would_lose_all,
                photos_with_files,
            )
            lrj.fail(error=problem)
            return

        _detach_missing(missing, job_id)
        update_scan_counter(job_id)
        logger.info("Finished checking paths for missing photos")
    except Exception as e:
        logger.exception("An error occurred: ")
        lrj.fail(error=e)


def _detach_missing(missing: dict[UUID, list[str]], job_id: UUID) -> None:
    """Detach the files found missing, a batch of photos at a time."""
    photo_ids = list(missing)
    for start in range(0, len(photo_ids), 1000):
        if is_job_cancelled(job_id):
            logger.info("Scan missing photos job cancelled")
            return
        batch = photo_ids[start : start + 1000]
        for photo in Photo.objects.filter(pk__in=batch):
            files = list(File.objects.filter(pk__in=missing[photo.pk]))
            detach_missing_files(photo, files)
