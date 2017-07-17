from api.models import Photo
from api.models import Person
from api.models import AlbumAuto

from datetime import datetime, timedelta
from itertools import groupby

import os
import shutil
import numpy as np

import ipdb

# go through all photos
def generate_event_albums():
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
