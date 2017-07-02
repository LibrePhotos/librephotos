from albums.models import Photo
from albums.models import Person
from albums.models import AlbumAuto

from datetime import datetime, timedelta
from itertools import groupby

import os
import shutil
import numpy as np

import ipdb

# go through all photos
photos = Photo.objects.all()

photos_with_timestamp = [(photo.exif_timestamp,photo) for photo in photos if photo.exif_timestamp]
timestamps = [photo.exif_timestamp for photo in photos if photo.exif_timestamp]

ipdb.set_trace()


def group(photos_with_timestamp,dt=timedelta(days=1)):
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

if 'albums' not in os.listdir('data'):
    os.makedirs('data/albums')

album_locations = []

for group in groups:
    key = group[0].exif_timestamp
    print(key)
    items = group
    if len(group) >= 1:
        album = AlbumAuto()
        album.timestamp = key
        album.save()

        album_dir_name = key.isoformat().replace('T','-').replace(':','-').replace(' ','-').replace('+','-')
        album_abs_dir = os.path.abspath(os.path.join('data/albums',album_dir_name))
        if album_dir_name not in os.listdir('data/albums'):
            os.makedirs('data/albums/%s'%album_dir_name)
        locs = []
        for item in items:
            item.album_auto.add(album)
            item.save()
            if item.exif_gps_lat and item.exif_gps_lon:
                locs.append([item.exif_gps_lat,item.exif_gps_lon])
#             shutil.copyfile(os.path.join('data/thumbnails/',item[1].image_hash),os.path.join(album_abs_dir,item[1].image_hash))
            shutil.copyfile(item.image_path,os.path.join(album_abs_dir,item.image_hash))
            print('-', item.image_hash, item.exif_gps_lat, item.exif_gps_lon)
        if len(locs) > 0:
            album_location = np.mean(np.array(locs),0)
            album_locations.append(album_location)
            album.gps_lat = album_location[0]
            album.gps_lon = album_location[1]
        else:
            album_locations.append([])
        album.save()


for album in AlbumAuto.objects.all():
    photos = album.photo_set.all()
    print(album.timestamp,album.gps_lat,album.gps_lon)



