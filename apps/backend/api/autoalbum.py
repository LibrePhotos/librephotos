from api.models import Photo
from api.models import Person
from api.models import AlbumAuto
from api.models import LongRunningJob

from datetime import datetime, timedelta
from itertools import groupby

import os
import shutil
import numpy as np

import ipdb

from django_rq import job

from tqdm import tqdm
import rq
from api.util import logger
import pytz

@job
def regenerate_event_titles(user):
    job_id = rq.get_current_job().id

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
            job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES)
        lrj.save()



    try:

        aus = AlbumAuto.objects.filter(owner=user).prefetch_related('photos')
        target_count = len(aus)
        for idx,au in enumerate(aus):
            logger.info('job {}: {}'.format(job_id,idx))
            au._autotitle()
            au.save()

            lrj.result = {
                'progress': {
                    "current": idx + 1,
                    "target": target_count
                }
            }
            lrj.save()

        status = True
        message = 'success'
        res = {'status': status, 'message': message}

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        logger.info('job {}: updated lrj entry to db'.format(job_id))

    except:
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1


@job
def generate_event_albums(user):
    job_id = rq.get_current_job().id

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
            job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUMS)
        lrj.save()


    try:
        photos = Photo.objects.filter(owner=user).only('exif_timestamp')

        photos_with_timestamp = [(photo.exif_timestamp, photo)
                                 for photo in photos if photo.exif_timestamp]
        timestamps = [
            photo.exif_timestamp for photo in photos if photo.exif_timestamp
        ]

        def group(photos_with_timestamp, dt=timedelta(hours=6)):
            photos_with_timestamp = sorted(
                photos_with_timestamp, key=lambda x: x[0])
            groups = []
            for idx,photo in enumerate(photos_with_timestamp):
                if len(groups) == 0:
                    groups.append([])
                    groups[-1].append(photo[1])
                else:
                    if photo[0] - groups[-1][-1].exif_timestamp < dt:
                        groups[-1].append(photo[1])
                    else:
                        groups.append([])
                        groups[-1].append(photo[1])
                logger.info('job {}: {}'.format(job_id,idx))
            return groups

        groups = group(photos_with_timestamp, dt=timedelta(days=1, hours=12))
        logger.info('job {}: made groups'.format(job_id))

        album_locations = []
        
        target_count = len(groups)

        date_format = "%Y:%m:%d %H:%M:%S"
        for idx, group in enumerate(groups):
            key = group[0].exif_timestamp
            logger.info('job {}: processing auto album with date: '.format(job_id) + key.strftime(date_format))
            items = group
            if len(group) >= 2:
                qs = AlbumAuto.objects.filter(timestamp=key).filter(owner=user)
                if qs.count() == 0:
                    album = AlbumAuto(created_on=datetime.utcnow().replace(tzinfo=pytz.utc), owner=user)
                    album.timestamp = key
                    album.save()

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
                    album._autotitle()
                    album.save()
                    logger.info('job {}: generated auto album {}'.format(job_id,album.id))

            lrj.result = {
                'progress': {
                    "current": idx + 1,
                    "target": target_count
                }
            }
            lrj.save()

        status = True
        message = 'success'
        res = {'status': status, 'message': message}

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    except:
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1
