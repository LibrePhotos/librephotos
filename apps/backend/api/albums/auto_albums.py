import logging
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.lazy_import import LazyModule
from api.models import (
    AlbumAuto,
    AlbumThing,
    File,
    LongRunningJob,
    Photo,
    User,
)
from api.models.long_running_job import JobCancelledError
from api.models.tag import refresh_tag_photo_counts, tag_ids_for_photos

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

# Batch size for delete_missing_photos. The function snapshots a list of
# affected AlbumThing ids per batch and then bulk-deletes the batch, so a
# bound on batch size bounds peak memory regardless of how many missing
# photos a single sweep has to process.
_DELETE_MISSING_BATCH_SIZE = 200


def _taken_at(photo: Photo) -> datetime:
    """The photo's capture time. Every photo handed here has one (see the query)."""
    assert photo.exif_timestamp is not None
    return photo.exif_timestamp


def _group_photos(
    photos: Iterable[Photo], dt: timedelta = timedelta(hours=6)
) -> list[list[Photo]]:
    photos_with_timestamp = sorted(photos, key=_taken_at)
    groups: list[list[Photo]] = []
    for photo in photos_with_timestamp:
        if len(groups) == 0:
            groups.append([])
            groups[-1].append(photo)
        # Photos are sorted by timestamp, so we can just check the last photo of the last group
        # to see if it is within the time delta
        elif _taken_at(photo) - _taken_at(groups[-1][-1]) < dt:
            groups[-1].append(photo)
        # If the photo is not within the time delta, we create a new group
        else:
            groups.append([])
            groups[-1].append(photo)
    return groups


def regenerate_event_titles(user: User, job_id: uuid.UUID | str) -> int:
    lrj = LongRunningJob.claim(
        user, LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES, job_id
    )
    if lrj is None:
        return 0
    try:
        aus = AlbumAuto.objects.filter(owner=user).prefetch_related("photos")
        target_count = len(aus)
        for idx, au in enumerate(aus):
            lrj.stop_if_cancelled()
            logger.debug("job %s: %s", job_id, idx)
            au._generate_title()
            au.save()
            lrj.update_progress(current=idx + 1, target=target_count)

        lrj.complete()
        logger.info("job %s: updated lrj entry to db", job_id)

    except JobCancelledError:
        logger.info("job %s: regenerating event titles was cancelled", job_id)
    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)

    return 1


def _merge_album(
    album: AlbumAuto, duplicate: AlbumAuto, job_id: uuid.UUID | str
) -> None:
    """Fold ``duplicate`` into ``album`` and delete it."""
    logger.info("job %s: merging auto album %s into %s", job_id, duplicate.id, album.id)
    with transaction.atomic():
        album.photos.add(*duplicate.photos.all())
        # The merged album carries user state that only exists on it, so move
        # it over before it is gone.
        album.favorited = album.favorited or duplicate.favorited
        # A picked cover is one of the duplicate's photos, which are the
        # album's now. The album's own pick wins (#429).
        if album.cover_photo_id is None:
            album.cover_photo_id = duplicate.cover_photo_id
        album.shared_to.add(*duplicate.shared_to.all())
        album.save()
        duplicate.delete()


def _event_album(
    user: User, group: list[Photo], key: datetime, job_id: uuid.UUID | str
) -> tuple[AlbumAuto, bool]:
    """The auto album of the event ``group``, and whether finding it changed it.

    An auto album is identified by the photos it holds, not by its timestamp.
    The timestamp is only an anchor on the first photo of the group as it was
    when the album got created, and that photo may well be gone by the next
    run. Every photo taken between the first and the last photo of a group
    belongs to that group, so an album holding one of them is the album of this
    event (#462). An album that is anchored on this group but lost all of its
    photos is claimed as well, both to reuse it and because (timestamp, owner)
    is unique.

    The two excludes keep albums that reach outside this event out of the
    running. Photos are only ever added to an auto album, never removed, so
    correcting the date of a single photo leaves its old album listing a photo
    that now belongs to a different event. Such an album overlaps this group by
    that one stale entry only, and treating it as this group's album would move
    - and, once it looked like a duplicate, delete - an album of unrelated
    photos.
    """
    first, last = _taken_at(group[0]), _taken_at(group[-1])
    albums = list(
        AlbumAuto.objects.filter(owner=user)
        .filter(Q(photos__exif_timestamp__range=(first, last)) | Q(timestamp=key))
        .exclude(photos__exif_timestamp__lt=first)
        .exclude(photos__exif_timestamp__gt=last)
        .distinct()
        .order_by("created_on", "id")
    )
    if not albums:
        album = AlbumAuto(
            created_on=timezone.now(),
            owner=user,
            timestamp=key,
        )
        album.save()
        logger.info("job %s: generate auto album %s", job_id, album.id)
        return album, True
    album = albums[0]
    logger.info("job %s: update auto album %s", job_id, album.id)
    # Newly imported photos can bridge the gap between two events, which turns
    # them into a single group. Fold the albums of the former events into the
    # oldest one instead of leaving duplicates behind.
    for duplicate in albums[1:]:
        _merge_album(album, duplicate, job_id)
    return album, len(albums) > 1


def _update_event_album(
    album: AlbumAuto, group: list[Photo], key: datetime, changed: bool
) -> None:
    """Add the group's new photos to ``album`` and refresh its anchor, place and title."""
    # Read the membership once instead of once per photo, otherwise re-running
    # generation is quadratic in the album size (#836).
    known_photos = set(album.photos.values_list("pk", flat=True))
    new_items = [item for item in group if item.pk not in known_photos]
    if new_items:
        album.photos.add(*new_items)
        changed = True

    # Keep the anchor on the earliest photo the album actually holds, so that
    # the album is still recognized as the album of this event after its first
    # photo has been removed.
    if album.timestamp != key:
        album.timestamp = key
        changed = True

    if changed:
        locs = [
            [item.exif_gps_lat, item.exif_gps_lon]
            for item in group
            if item.exif_gps_lat and item.exif_gps_lon
        ]
        if locs:
            album_location = np.mean(np.array(locs), 0)
            album.gps_lat = album_location[0]
            album.gps_lon = album_location[1]

    # Regenerate the title on every run, not just when the album changed: the
    # people and places a title is built from are recognized long after the
    # album itself was created.
    album._generate_title()
    album.save()


def generate_event_albums(user: User, job_id: uuid.UUID | str) -> int:
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_GENERATE_AUTO_ALBUMS, job_id)
    if lrj is None:
        return 0

    try:
        photos = (
            Photo.objects.owned_by(user)
            .exclude(Q(exif_timestamp=None))
            .only("exif_timestamp", "exif_gps_lat", "exif_gps_lon")
        )

        # Group images that are on the same 1 day and 12 hours interval
        groups = _group_photos(photos, dt=timedelta(days=1, hours=12))
        target_count = len(groups)
        logger.info(
            "job %s: made %s groups out of %s images", job_id, target_count, len(photos)
        )

        date_format = "%Y:%m:%d %H:%M:%S"
        for idx, group in enumerate(groups):
            lrj.stop_if_cancelled()
            key = _taken_at(group[0]) - timedelta(hours=11, minutes=59)
            last_key = _taken_at(group[-1]) + timedelta(hours=11, minutes=59)
            logger.info(
                "job %s: processing auto album with date: %s to %s",
                job_id,
                key.strftime(date_format),
                last_key.strftime(date_format),
            )
            if len(group) >= 2:
                album, changed = _event_album(user, group, key, job_id)
                _update_event_album(album, group, key, changed=changed)

            lrj.update_progress(current=idx + 1, target=target_count)

        lrj.complete()

    except JobCancelledError:
        logger.info("job %s: generating event albums was cancelled", job_id)
    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)

    return 1


# To-Do: This does not belong here
def delete_missing_photos(user: User, job_id: uuid.UUID | str) -> int:
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_DELETE_MISSING_PHOTOS, job_id)
    if lrj is None:
        return 0
    try:
        missing_pks = list(
            Photo.objects.owned_by(user)
            .filter(Q(files=None) | Q(main_file=None))
            .values_list("pk", flat=True)
        )
        target = len(missing_pks)
        lrj.update_progress(current=0, target=target)

        # AlbumDate, AlbumPlace, AlbumUser have no m2m_changed receivers, so
        # the original per-photo .remove() loops were pure overhead — cascade
        # on Photo.delete() handles the through-rows. Face.photo is
        # on_delete=CASCADE so Face rows (and their post_delete file cleanup)
        # come along too. AlbumThing.photos.through and Tag.photos.through both
        # have receivers that maintain photo_count / cover_photos, but cascade
        # bypasses the signal, so we snapshot the affected ids per batch and
        # run the refresh once after each batch completes.
        affected_album_thing_ids: set[int] = set()
        affected_tag_ids: set[int] = set()
        for start in range(0, target, _DELETE_MISSING_BATCH_SIZE):
            batch_pks = missing_pks[start : start + _DELETE_MISSING_BATCH_SIZE]
            batch_qs = Photo.objects.filter(pk__in=batch_pks)
            affected_album_thing_ids.update(
                AlbumThing.objects.filter(photos__in=batch_qs).values_list(
                    "id", flat=True
                )
            )
            affected_tag_ids.update(tag_ids_for_photos(batch_qs))
            batch_qs.delete()
            lrj.update_progress(current=start + len(batch_pks), target=target)

        for album_thing in AlbumThing.objects.filter(id__in=affected_album_thing_ids):
            album_thing.photo_count = album_thing.photos.filter(hidden=False).count()
            album_thing.save(update_fields=["photo_count"])
            album_thing.update_default_cover_photo()

        refresh_tag_photo_counts(affected_tag_ids)

        # File.hash is composed as `md5 + str(user.id)` (see api/models/file.py),
        # so the user-owned subset of missing files is identified by that suffix.
        missing_files = File.objects.filter(
            Q(hash__endswith=str(user.id)) & Q(missing=True)
        )
        missing_files.delete()

        lrj.complete()
    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)
    return 1
