from tqdm import tqdm

from api.models import Photo
from api.util import logger


def generate_captions(overwrite=False):
    if overwrite:
        photos = Photo.objects.all()
    else:
        photos = Photo.objects.filter(search_captions=None)
    logger.info("%d photos to be processed for caption generation" % photos.count())
    for photo in photos:
        logger.info("generating captions for %s" % photo.main_file.path)
        photo._generate_captions()
        photo.save()


def geolocate(overwrite=False):
    if overwrite:
        photos = Photo.objects.all()
    else:
        photos = Photo.objects.filter(geolocation_json={})
    logger.info("%d photos to be geolocated" % photos.count())
    for photo in photos:
        try:
            logger.info("geolocating %s" % photo.main_file.path)
            photo._geolocate()
            photo._add_location_to_album_dates()
        except Exception:
            logger.exception("could not geolocate photo: " + photo)


def add_photos_to_album_things():
    photos = Photo.objects.all()
    for photo in tqdm(photos):
        photo._add_to_album_place()
