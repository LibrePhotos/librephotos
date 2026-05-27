from datetime import datetime, timedelta

import numpy as np
import pytz
from django.db.models import Q

from api.models import (
    AlbumAuto,
    AlbumThing,
    File,
    LongRunningJob,
    Photo,
)
from api.util import logger

# Batch size for delete_missing_photos. The function snapshots a list of
# affected AlbumThing ids per batch and then bulk-deletes the batch, so a
# bound on batch size bounds peak memory regardless of how many missing
# photos a single sweep has to process.
_DELETE_MISSING_BATCH_SIZE = 200


def regenerate_event_titles(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES,
        job_id=job_id,
    )
    try:
        aus = AlbumAuto.objects.filter(owner=user).prefetch_related("photos")
        target_count = len(aus)
        for idx, au in enumerate(aus):
            logger.info(f"job {job_id}: {idx}")
            au._generate_title()
            au.save()
            lrj.update_progress(current=idx + 1, target=target_count)

        lrj.complete()
        logger.info(f"job {job_id}: updated lrj entry to db")

    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)

    return 1


def generate_event_albums(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUMS,
        job_id=job_id,
    )

    try:
        photos = (
            Photo.objects.filter(Q(owner=user))
            .exclude(Q(exif_timestamp=None))
            .only("exif_timestamp")
        )

        def group(photos, dt=timedelta(hours=6)):
            photos_with_timestamp = sorted(photos, key=lambda p: p.exif_timestamp)
            groups = []
            for idx, photo in enumerate(photos_with_timestamp):
                if len(groups) == 0:
                    groups.append([])
                    groups[-1].append(photo)
                # Photos are sorted by timestamp, so we can just check the last photo of the last group
                # to see if it is within the time delta
                elif photo.exif_timestamp - groups[-1][-1].exif_timestamp < dt:
                    groups[-1].append(photo)
                # If the photo is not within the time delta, we create a new group
                else:
                    groups.append([])
                    groups[-1].append(photo)
            return groups

        # Group images that are on the same 1 day and 12 hours interval
        groups = group(photos, dt=timedelta(days=1, hours=12))
        target_count = len(groups)
        logger.info(
            f"job {job_id}: made {target_count} groups out of {len(photos)} images"
        )

        album_locations = []

        date_format = "%Y:%m:%d %H:%M:%S"
        for idx, group in enumerate(groups):
            key = group[0].exif_timestamp - timedelta(hours=11, minutes=59)
            lastKey = group[-1].exif_timestamp + timedelta(hours=11, minutes=59)
            logger.info(str(key.date) + " - " + str(lastKey.date))
            logger.info(
                f"job {job_id}: processing auto album with date: "
                + key.strftime(date_format)
                + " to "
                + lastKey.strftime(date_format)
            )
            items = group
            if len(group) >= 2:
                qs = AlbumAuto.objects.filter(owner=user).filter(
                    timestamp__range=(key, lastKey)
                )
                if qs.count() == 0:
                    album = AlbumAuto(
                        created_on=datetime.utcnow().replace(tzinfo=pytz.utc),
                        owner=user,
                    )
                    album.timestamp = key
                    album.save()

                    logger.info(f"job {job_id}: generate auto album {album.id}")
                    locs = []
                    for item in items:
                        album.photos.add(item)
                        item.save()
                        if item.exif_gps_lat and item.exif_gps_lon:
                            locs.append([item.exif_gps_lat, item.exif_gps_lon])
                    if len(locs) > 0:
                        album_location = np.mean(np.array(locs), 0)
                        album_locations.append(album_location)
                        album.gps_lat = album_location[0]
                        album.gps_lon = album_location[1]
                    else:
                        album_locations.append([])
                    album._generate_title()
                    album.save()
                    continue
                if qs.count() == 1:
                    album = qs.first()
                    logger.info(f"job {job_id}: update auto album {album.id}")
                    for item in items:
                        if item in album.photos.all():
                            continue
                        album.photos.add(item)
                        item.save()
                    album._generate_title()
                    album.save()
                    continue
                if qs.count() > 1:
                    # To-Do: Merge both auto albums
                    logger.info(
                        f"job {job_id}: found multiple auto albums for date {key.strftime(date_format)}"
                    )
                    continue

            lrj.update_progress(current=idx + 1, target=target_count)

        lrj.complete()

    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)

    return 1


# To-Do: This does not belong here
def delete_missing_photos(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_DELETE_MISSING_PHOTOS,
        job_id=job_id,
    )
    try:
        missing_pks = list(
            Photo.objects.filter(
                Q(owner=user) & (Q(files=None) | Q(main_file=None))
            ).values_list("pk", flat=True)
        )
        target = len(missing_pks)
        lrj.update_progress(current=0, target=target)

        # AlbumDate, AlbumPlace, AlbumUser have no m2m_changed receivers, so
        # the original per-photo .remove() loops were pure overhead — cascade
        # on Photo.delete() handles the through-rows. Face.photo is
        # on_delete=CASCADE so Face rows (and their post_delete file cleanup)
        # come along too. AlbumThing.photos.through has a receiver that
        # maintains photo_count / cover_photos, but cascade bypasses the
        # signal, so we snapshot affected AlbumThing ids per batch and run
        # the refresh once after each batch completes.
        affected_album_thing_ids: set[int] = set()
        for start in range(0, target, _DELETE_MISSING_BATCH_SIZE):
            batch_pks = missing_pks[start : start + _DELETE_MISSING_BATCH_SIZE]
            batch_qs = Photo.objects.filter(pk__in=batch_pks)
            affected_album_thing_ids.update(
                AlbumThing.objects.filter(photos__in=batch_qs).values_list(
                    "id", flat=True
                )
            )
            batch_qs.delete()
            lrj.update_progress(current=start + len(batch_pks), target=target)

        for album_thing in AlbumThing.objects.filter(id__in=affected_album_thing_ids):
            album_thing.photo_count = album_thing.photos.filter(hidden=False).count()
            album_thing.save(update_fields=["photo_count"])
            album_thing.update_default_cover_photo()

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
