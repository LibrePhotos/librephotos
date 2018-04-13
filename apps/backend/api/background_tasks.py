from api.models import Photo
from api.util import logger

def generate_captions():
    photos = Photo.objects.filter(search_captions=None)
    logger.info('%d photos to be processed for caption generation'%photos.count())
    for photo in photos:
        photo._generate_captions()
        photo.save()

def geolocate(overwrite=False):
    if overwrite:
        photos = Photo.objects.all()
    else:   
        photos = Photo.objects.filter(geolocation_json=None)
    logger.info('%d photos to be geolocated'%photos.count())
    for photo in photos:
        photo._geolocate_mapbox()
