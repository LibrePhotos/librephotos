from datetime import datetime, timedelta

import numpy as np
import pytz
from django.db.models import Q

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Face,
    File,
    LongRunningJob,
    Photo,
)
from api.util import logger


def regenerate_event_titles(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES,
        )
        lrj.save()
    try:
        aus = AlbumAuto.objects.filter(owner=user).prefetch_related("photos")
        target_count = len(aus)
        for idx, au in enumerate(aus):
            logger.info(f"job {job_id}: {idx}")
            au._generate_title()
            au.save()

            lrj.progress_current = idx + 1
            lrj.progress_target = target_count
            lrj.save()

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        logger.info(f"job {job_id}: updated lrj entry to db")

    except Exception:
        logger.exception("An error occurred")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1


def generate_event_albums(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUMS,
        )
        lrj.save()

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

            lrj.progress_current = idx + 1
            lrj.progress_target = target_count
            lrj.save()

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    except Exception:
        logger.exception("An error occurred")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1


# To-Do: This does not belong here
def delete_missing_photos(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_DELETE_MISSING_PHOTOS,
        )
        lrj.save()
    try:
        missing_photos = Photo.objects.filter(
            Q(owner=user) & Q(files=None) | Q(main_file=None)
        )
        for missing_photo in missing_photos:
            album_dates = AlbumDate.objects.filter(photos=missing_photo)
            for album_date in album_dates:
                album_date.photos.remove(missing_photo)
            album_things = AlbumThing.objects.filter(photos=missing_photo)
            for album_thing in album_things:
                album_thing.photos.remove(missing_photo)
            album_places = AlbumPlace.objects.filter(photos=missing_photo)
            for album_place in album_places:
                album_place.photos.remove(missing_photo)
            album_users = AlbumUser.objects.filter(photos=missing_photo)
            for album_user in album_users:
                album_user.photos.remove(missing_photo)
            faces = Face.objects.filter(photo=missing_photo)
            faces.delete()
            # To-Do: Remove thumbnails

        missing_photos.delete()

        missing_files = File.objects.filter(Q(hash__endswith=user) & Q(missing=True))
        missing_files.delete()

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    except Exception:
        logger.exception("An error occurred")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    return 1
