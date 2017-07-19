from api.models import Photo
from api.models import Person
from api.models import AlbumAuto

from datetime import datetime, timedelta
from itertools import groupby

import os
import shutil
import numpy as np

import ipdb

def is_auto_albums_being_processed():
    # check if there are auto albums being generated right now
    if AlbumAuto.objects.count() > 0:
        last_album_auto_created_on = AlbumAuto.objects.order_by('-created_on')[0].created_on
        now = datetime.utcnow().replace(tzinfo=last_album_auto_created_on.tzinfo)
        td = (now-last_album_auto_created_on).total_seconds()
        if abs(td) < 10:
            status = True
        else:
            status = False
    else:
        status = False
    return {"status":status}
    
# go through all photos
def generate_event_albums():
    photo_count = Photo.objects.count()
    if photo_count == 0:
        status = False
        message = "Please add some more photos!"
        return {'status':status, 'message':message}
    else:
        # check if there has been a new photo added to the library within the
        # past 10 seconds. if so, return status false, as autoalbum generation
        # may behave wierdly if performed while photos are being added.
        last_photo_addedon = Photo.objects.order_by('-added_on')[0].added_on
        now = datetime.utcnow().replace(tzinfo=last_photo_addedon.tzinfo)
        td = (now-last_photo_addedon).total_seconds()
        if abs(td) < 10:
            status = False
            message = "There are photos being added to the library. Please try again later."
            return {'status':status, 'message':message}

    # check if there are auto albums being generated right now
    if AlbumAuto.objects.count() > 0:
        last_album_auto_created_on = AlbumAuto.objects.order_by('-created_on')[0].created_on
        now = datetime.utcnow().replace(tzinfo=last_album_auto_created_on.tzinfo)
        td = (now-last_album_auto_created_on).total_seconds()
        if abs(td) < 10:
            status = False
            message = "There are even albums being created at the moment. Please try again later."
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
                    album = AlbumAuto()
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
    except Exception as e:
        status = False
        message = e.message

    return {'status':status, 'message':message}
