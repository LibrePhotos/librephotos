from api.models import Photo

def generate_captions():
    photos = Photo.objects.filter(search_captions=None)
    print('%d photos to be processed for caption generation'%photos.count())
    for photo in photos:
        photo._generate_captions()
        photo.save()

def geolocate():
    photos = Photo.objects.filter(geolocation_json=None)
    print('%d photos to be geolocated'%photos.count())
    for photo in photos:
    	photo._geolocate_mapzen()
