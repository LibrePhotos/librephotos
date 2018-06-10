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

from api.flags import \
    is_auto_albums_being_processed, \
    is_photos_being_added, \
    set_auto_album_processing_flag_on, \
    set_auto_album_processing_flag_off
from django_rq import job

from tqdm import tqdm
import rq

# def is_auto_albums_being_processed():
#     global FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED
#     return {"status":FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED}

#     # check if there are auto albums being generated right now
#     if AlbumAuto.objects.count() > 0:
#         last_album_auto_created_on = AlbumAuto.objects.order_by('-created_on')[0].created_on
#         now = datetime.utcnow().replace(tzinfo=last_album_auto_created_on.tzinfo)
#         td = (now-last_album_auto_created_on).total_seconds()
#         if abs(td) < 10:
#             status = True
#         else:
#             status = False
#     else:
#         status = False
#     return {"status":status}
    
# go through all photos


@job
def regenerate_event_titles():
    lrj = LongRunningJob(
        job_id=rq.get_current_job().id,
        started_at=datetime.now(),
        job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES)
    lrj.save()

    try:

        aus = AlbumAuto.objects.all().prefetch_related('photos')
        for au in tqdm(aus):
            au._autotitle()
            au.save()

        status = True
        message = 'success'
        res = {'status':status, 'message':message}

        lrj = LongRunningJob.objects.get(job_id=rq.get_current_job().id)
        lrj.finished = True
        lrj.finished_at = datetime.now()
        lrj.result = res
        lrj.save()


    except:
        status = False
        res = {'status':status, 'message':'failed'}

        lrj = LongRunningJob.objects.get(job_id=rq.get_current_job().id)
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now()
        lrj.save()    

    return True


@job
def generate_event_albums():
    lrj = LongRunningJob(
        job_id=rq.get_current_job().id,
        started_at=datetime.now(),
        job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUMS)
    lrj.save()

    if is_auto_albums_being_processed()['status']:
        status = False
        message = "There are even albums being created at the moment. Please try again later."
        return {'status':status, 'message':message}


    set_auto_album_processing_flag_on()
    photo_count = Photo.objects.count()
    if photo_count == 0:
        status = False
        message = "Please add some more photos!"
        set_auto_album_processing_flag_off()
        return {'status':status, 'message':message}
    else:
        if is_photos_being_added()['status']:
            status = False
            message = "There are photos being added to the library. Please try again later."
            set_auto_album_processing_flag_off()
            return {'status':status, 'message':message}






    try:
        photos = Photo.objects.all()

        photos_with_timestamp = [(photo.exif_timestamp,photo) for photo in photos if photo.exif_timestamp]
        timestamps = [photo.exif_timestamp for photo in photos if photo.exif_timestamp]

        def group(photos_with_timestamp,dt=timedelta(hours=6)):
            photos_with_timestamp = sorted(photos_with_timestamp, key=lambda x: x[0])
            groups = []
            for photo in photos_with_timestamp:
                if len(groups) == 0:
                    groups.append([])
                    groups[-1].append(photo[1])
                else:
                    if photo[0]-groups[-1][-1].exif_timestamp < dt:
                        groups[-1].append(photo[1])
                    else:
                        groups.append([])
                        groups[-1].append(photo[1])
            return groups


        groups = group(photos_with_timestamp,dt=timedelta(days=1,hours=12))

        album_locations = []

        for group in groups:
            key = group[0].exif_timestamp
            print(key)
            items = group
            if len(group) >= 2:
                qs = AlbumAuto.objects.filter(timestamp=key)
                if qs.count() == 0:
                    album = AlbumAuto(created_on=datetime.utcnow())
                    album.timestamp = key
                    album.save()

                    locs = []
                    for item in items:
                        album.photos.add(item)
                        item.save()
                        if item.exif_gps_lat and item.exif_gps_lon:
                            locs.append([item.exif_gps_lat,item.exif_gps_lon])
                        print('-', item.image_hash, item.exif_gps_lat, item.exif_gps_lon)
                    if len(locs) > 0:
                        album_location = np.mean(np.array(locs),0)
                        album_locations.append(album_location)
                        album.gps_lat = album_location[0]
                        album.gps_lon = album_location[1]
                    else:
                        album_locations.append([])
                    album._autotitle()
                    album.save()
        status = True
        message = 'success'
        res = {'status':status, 'message':message}

        lrj = LongRunningJob.objects.get(job_id=rq.get_current_job().id)
        lrj.finished = True
        lrj.finished_at = datetime.now()
        lrj.result = res
        lrj.save()


    except:
        status = False
        res = {'status':status, 'message':'failed'}

        lrj = LongRunningJob.objects.get(job_id=rq.get_current_job().id)
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now()
        lrj.save()    

    set_auto_album_processing_flag_off()
    return 1