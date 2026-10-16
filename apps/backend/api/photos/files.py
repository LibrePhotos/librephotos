"""The files behind a photo: detaching the missing ones, removing a photo
together with the files only it uses, and moving a photo's files to another
folder.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

from __future__ import annotations

import enum
import logging
import os
import shutil
from collections.abc import Callable, Collection, Iterable, Mapping
from typing import TYPE_CHECKING, Literal, NamedTuple

from django.db import transaction

from api.metadata.reader import existing_sidecars
from api.models.file import File, FileCopy
from api.models.photo_search import PhotoSearch
from api.photos import indexed_mtimes
from api.video import transcode_cache

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


def missing_files(photo: Photo) -> list[File]:
    """The photo's files that are gone from disk.

    A file whose own path is gone but which has an exact copy on disk (a
    ``FileCopy``, #2417) is not missing: the copy takes the file over here,
    as the next scan would, so the photo is not flagged missing meanwhile.
    """
    return [file for file in photo.files.all() if not _on_disk(file)]


def _on_disk(file: File) -> bool:
    """Whether ``file`` is on disk, at its own path or at a copy that takes it over."""
    if file.path and os.path.exists(file.path):
        return True
    for copy in file.copies.values_list("path", flat=True):
        if os.path.exists(copy):
            logger.info("a copy takes over the missing file %s", file.hash)
            file.take_over_copy(copy)
            return True
    return False


def detach_missing_files(photo: Photo, missing: list[File] | None = None) -> None:
    """Unlink files that are gone from disk and flag them missing.

    ``missing`` is the result of ``missing_files(photo)`` when the caller has
    already looked (the scan checks the whole library before it changes
    anything); without it the files are checked here.

    The scan runs this over every photo in the library, from rows it loaded
    in pages of thousands. Saving each one whole wrote those old values back
    over anything that changed in the meantime -- a rating given while the
    scan ran, a field another job had just filled in -- and bumped every
    ``last_modified``, so a removed photo never got old enough for
    ``cleanup_deleted_photos``. Only a photo that actually lost a file is
    touched, and only its ``last_modified``: the relation itself is already
    written by ``remove()``, and the bump is what tells the sync feed.
    """
    if missing is None:
        missing = missing_files(photo)
    for file in missing:
        photo.files.remove(file)
        file.missing = True
        file.save()
    if missing:
        photo.save(update_fields=["last_modified"])


def remove_photo(photo: Photo) -> None:
    """Delete the photo's unshared files from disk and mark it removed.

    Files another photo still uses are only unlinked. Stacks and duplicate
    groups left with one photo or none are dissolved.
    """
    # Store stack references before cleanup (ManyToMany)
    photo_stacks = list(photo.stacks.all())

    # Store duplicate group references before cleanup (ManyToMany)
    photo_duplicates = list(photo.duplicates.all())

    # Handle file cleanup - only delete files not shared with other Photos
    for file in photo.files.all():
        # Check if this file is used by other Photos (via files M2M or as main_file)
        other_photos_using_file = (
            file.photo_set.exclude(pk=photo.pk).exists()
            or file.main_photo.exclude(pk=photo.pk).exists()
        )

        if other_photos_using_file:
            # File is shared - just unlink from this photo, don't delete
            logger.info(
                "File %s is shared with other photos, unlinking only", file.path
            )
            photo.files.remove(file)
        else:
            # File is only used by this photo - safe to delete
            if os.path.isfile(file.path):
                logger.info("Removing photo %s", file.path)
                os.remove(file.path)
            file.delete()

    photo.files.set([])
    photo.main_file = None
    photo.removed = True

    # A cached transcode outlives the photo otherwise: it is named after the
    # image hash, which no longer belongs to anything, so nothing would ever
    # serve it and nothing would ever reclaim it until the cache filled up.
    transcode_cache.discard(photo.image_hash)

    # Clear all stack references from this photo (ManyToMany)
    photo.stacks.clear()

    # Clear all duplicate group references from this photo (ManyToMany)
    photo.duplicates.clear()

    photo.save()

    # Clean up stacks if they're now empty or have only one photo left
    for photo_stack in photo_stacks:
        remaining_photos = photo_stack.photos.filter(removed=False).count()
        if remaining_photos <= 1:
            # If 0 or 1 photos left, delete the stack (no longer a valid grouping)
            logger.info(
                "Deleting photo stack %s - only %s photos remaining",
                photo_stack.id,
                remaining_photos,
            )
            # Unlink remaining photos from stack first
            for remaining_photo in photo_stack.photos.all():
                remaining_photo.stacks.remove(photo_stack)
            photo_stack.delete()

    # Clean up duplicate groups if they're now empty or have only one photo left
    for duplicate in photo_duplicates:
        remaining_photos = duplicate.photos.filter(removed=False).count()
        if remaining_photos <= 1:
            # If 0 or 1 photos left, delete the duplicate group (no longer valid)
            logger.info(
                "Deleting duplicate group %s - only %s photos remaining",
                duplicate.id,
                remaining_photos,
            )
            # Unlink remaining photos from duplicate first
            for remaining_photo in duplicate.photos.all():
                remaining_photo.duplicates.remove(duplicate)
            duplicate.delete()


class Removal(NamedTuple):
    """What ``remove_photos`` did: how many photos went, which ones failed."""

    removed: int
    failed: list[Photo]


def remove_photos(
    photos: Iterable[Photo], progress: Callable[[int], None] | None = None
) -> Removal:
    """``remove_photo`` each photo, logging and skipping one that fails.

    One unreadable file or broken row must not stop the rest: Delete
    permanently, Empty trash and the trash retention all go through here.
    ``progress`` gets the number of photos handled so far after each one; an
    exception it raises (a job's cancel) stops the loop.
    """
    removed = 0
    failed: list[Photo] = []
    for done, photo in enumerate(photos, start=1):
        try:
            remove_photo(photo)
        except Exception:
            logger.exception(
                "Could not delete photo %s, skipping it.", photo.image_hash
            )
            failed.append(photo)
        else:
            removed += 1
        if progress is not None:
            progress(done)
    return Removal(removed, failed)


# ------------------------------------------------------------------ moving

#: What to do when a name is taken in the target folder (#352): give the photo's
#: files a free name (``IMG_1 (1).jpg``), or leave the photo where it is. A file
#: in the target folder is never overwritten.
OnConflict = Literal["rename", "skip"]

#: How many `` (n)`` suffixes a rename tries before it gives up.
MAX_RENAME_ATTEMPTS = 999


class MoveOutcome(enum.Enum):
    """What ``move_photo_files`` did with a photo."""

    MOVED = "moved"
    #: A name was taken in the target folder and ``on_conflict`` said skip.
    SKIPPED = "skipped"
    #: The photo already is in the target folder.
    UNCHANGED = "unchanged"


class MoveError(Exception):
    """A photo's files could not be moved; what had moved was moved back."""


def path_key(path: str) -> str:
    """``path`` as the file system compares it: absolute, normalised, case-folded on Windows."""
    return os.path.normcase(os.path.normpath(os.path.abspath(path)))


def photo_folder(photo: Photo) -> str:
    """The folder the photo's main file is in."""
    assert photo.main_file is not None
    return os.path.dirname(photo.main_file.path)


def files_to_move(photo: Photo) -> list[str]:
    """The files that move with ``photo``, as their paths, each once.

    Every file of the photo in its main file's folder that is on disk (the
    main file, RAW and JPEG variants, a Live Photo video, attached XMP
    sidecars), plus the XMP sidecars of each of those on disk, in both
    naming conventions (``IMG.xmp``, ``IMG.jpg.xmp``, #2505) even when they
    have no row. A file elsewhere, such as a Motion Photo video extracted
    into ``protected_media``, is not part of the library folder and stays.
    """
    assert photo.main_file is not None
    folder = path_key(photo_folder(photo))
    found: dict[str, str] = {}
    for file in [photo.main_file, *photo.files.all()]:
        if path_key(os.path.dirname(file.path)) != folder:
            continue
        if not os.path.isfile(file.path):
            continue
        found.setdefault(path_key(file.path), file.path)
        if file.type == File.METADATA_FILE:
            continue
        for sidecar in existing_sidecars(file.path):
            found.setdefault(path_key(sidecar), sidecar)
    return sorted(found.values())


def _renamed(name: str, stem: str, suffix: str) -> str:
    """``name`` with ``suffix`` added after the photo's ``stem``.

    ``IMG_1.CR2`` and ``IMG_1.jpg.xmp`` of a photo whose main file is
    ``IMG_1.jpg`` become ``IMG_1 (1).CR2`` and ``IMG_1 (1).jpg.xmp``, so
    the scan still groups them as one photo.
    """
    if not suffix:
        return name
    if name.lower().startswith(stem.lower()):
        return name[: len(stem)] + suffix + name[len(stem) :]
    base, extension = os.path.splitext(name)
    return base + suffix + extension


def move_destinations(
    photo: Photo, sources: Collection[str], target_dir: str, suffix: str = ""
) -> dict[str, str]:
    """Where each of ``sources`` goes in ``target_dir``, with ``suffix`` after the stem."""
    assert photo.main_file is not None
    stem = os.path.splitext(os.path.basename(photo.main_file.path))[0]
    return {
        source: os.path.join(
            target_dir, _renamed(os.path.basename(source), stem, suffix)
        )
        for source in sources
    }


def is_taken(path: str) -> bool:
    """Whether a file is at ``path``, or the library has one recorded there."""
    return (
        os.path.lexists(path)
        or File.objects.filter(path=path).exists()
        or FileCopy.objects.filter(path=path).exists()
    )


def free_destinations(
    photo: Photo,
    sources: Collection[str],
    target_dir: str,
    reserved: Collection[str] = (),
) -> dict[str, str] | None:
    """The first renamed destinations (`` (1)``, `` (2)``, ...) that are all free.

    ``reserved`` holds the ``path_key`` of names another photo of the same
    move takes. None after ``MAX_RENAME_ATTEMPTS`` tries.
    """
    for attempt in range(1, MAX_RENAME_ATTEMPTS + 1):
        plan = move_destinations(photo, sources, target_dir, f" ({attempt})")
        if not any(
            path_key(dest) in reserved or is_taken(dest) for dest in plan.values()
        ):
            return plan
    return None


def _plan_move(
    photo: Photo, sources: list[str], target_dir: str, on_conflict: OnConflict
) -> dict[str, str] | None:
    """Where ``sources`` go, renamed if names are taken; None to skip the photo."""
    plan = move_destinations(photo, sources, target_dir)
    if not any(is_taken(dest) for dest in plan.values()):
        return plan
    if on_conflict == "skip":
        return None
    renamed = free_destinations(photo, sources, target_dir)
    if renamed is None:
        raise MoveError(f"no free name for photo {photo.image_hash}")
    return renamed


def _move_back(moved: Mapping[str, str]) -> None:
    """Undo the moves in ``moved`` (source -> destination), newest first."""
    for source, dest in reversed(list(moved.items())):
        try:
            shutil.move(dest, source)
        except OSError as error:
            # The file stays at its new path; the next scan finds it there.
            logger.error(
                "could not move a file back after a failed move: %s", error.strerror
            )


def _move_on_disk(plan: Mapping[str, str]) -> dict[str, str]:
    """Move each file of ``plan``; on a failure move the others back and raise."""
    moved: dict[str, str] = {}
    try:
        for source, dest in plan.items():
            # Checked again right before the move: a file that appeared
            # since the plan was made is not overwritten.
            if is_taken(dest):
                raise MoveError("a file appeared in the target folder")
            shutil.move(source, dest)
            moved[source] = dest
    except OSError as error:
        _move_back(moved)
        # strerror, not str(): the paths stay out of the logs and the API.
        raise MoveError(error.strerror or type(error).__name__) from error
    except MoveError:
        _move_back(moved)
        raise
    return moved


def _record_new_paths(
    photo: Photo, moved: Mapping[str, str], indexed: Collection[str]
) -> None:
    """Point the rows of the moved files at their new paths.

    A media file whose record matched the disk before the move (``indexed``,
    #2296) gets the times seen at its new path, so the next incremental scan
    does not read it again: a move is not an outside edit. Its sidecars'
    keys follow a rename too. One whose record did not match keeps it, and
    the scan reads it as it would have.
    """
    for file in File.objects.filter(path__in=list(moved)):
        source = file.path
        file.path = moved[source]
        fields = ["path"]
        if source in indexed:
            seen = indexed_mtimes.observe(file.path)
            file.indexed_mtime_ns = seen.mtime_ns
            file.indexed_sidecar_mtimes = dict(seen.sidecars)
            fields += ["indexed_mtime_ns", "indexed_sidecar_mtimes"]
        file.save(update_fields=fields)
    photo.save(update_fields=["last_modified"])
    search = PhotoSearch.objects.filter(photo=photo).first()
    if search is not None:
        # The folder names are searchable: search_captions holds the paths.
        search.recreate_search_captions()
        search.save()


def move_photo_files(
    photo: Photo, target_dir: str, on_conflict: OnConflict
) -> MoveOutcome:
    """Move every file of ``photo`` (``files_to_move``) into ``target_dir``.

    All or nothing: when one file cannot be moved, or the rows cannot be
    updated, the files already moved go back and ``MoveError`` is raised.
    Names taken in ``target_dir`` are renamed or skip the photo as
    ``on_conflict`` says; nothing is overwritten. The ``File`` rows follow
    (``File.path``, the scan's record of their times), ``last_modified`` is
    bumped for the sync feed, and thumbnails, named after the image hash,
    stay linked. ``target_dir`` must exist; the caller checked that it is
    inside the owner's library.
    """
    sources = files_to_move(photo)
    if not sources:
        raise MoveError(f"the files of photo {photo.image_hash} are not on disk")
    if path_key(photo_folder(photo)) == path_key(target_dir):
        return MoveOutcome.UNCHANGED
    plan = _plan_move(photo, sources, target_dir, on_conflict)
    if plan is None:
        return MoveOutcome.SKIPPED
    indexed = set(indexed_mtimes.as_indexed(sources))
    moved = _move_on_disk(plan)
    try:
        with transaction.atomic():
            _record_new_paths(photo, moved, indexed)
    except Exception as error:
        logger.exception("photo %s: could not record its new paths", photo.image_hash)
        _move_back(moved)
        raise MoveError("the new paths could not be recorded") from error
    logger.info("moved photo %s (%s files)", photo.image_hash, len(moved))
    return MoveOutcome.MOVED
