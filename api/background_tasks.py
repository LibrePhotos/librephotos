from api.models import Photo, AlbumAuto
from api.util import logger
from tqdm import tqdm

def generate_captions(overwrite=False):
    if overwrite:
        photos = Photo.objects.all()
    else:
        photos = Photo.objects.filter(search_captions=None)
    logger.info('%d photos to be processed for caption generation'%photos.count())
    for photo in photos:
        logger.info('generating captions for %s'%photo.image_path)
        photo._generate_captions()
        photo.save()

def geolocate(overwrite=False):
    if overwrite:
        photos = Photo.objects.all()
    else:   
        photos = Photo.objects.filter(geolocation_json={})
    logger.info('%d photos to be geolocated'%photos.count())
    for photo in photos:
        try:
            logger.info('geolocating %s'%photo.image_path)
            photo._geolocate_mapbox()
        except:
            print('could not geolocate photo:',photo)


def regenerate_event_title():
    events = AlbumAuto.objects.all()
    for event in events:
        event._autotitle()
        event.save()

def add_photos_to_album_things():
    photos = Photo.objects.all()
    for photo in tqdm(photos):
        photo._add_to_album_place()
