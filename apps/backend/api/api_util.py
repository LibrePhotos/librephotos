from api.models import Photo, Face, Person, AlbumAuto, AlbumDate, AlbumUser

def get_count_stats():
    num_photos = Photo.objects.count()
    num_faces = Face.objects.count()
    num_people = Person.objects.count()
    num_albumauto = AlbumAuto.objects.count()
    num_albumdate = AlbumDate.objects.count()
    num_albumuser = AlbumUser.objects.count()

    res = {
        "num_photos":num_photos,
        "num_faces":num_faces,
        "num_people":num_people,
        "num_albumauto":num_albumauto,
        "num_albumdate":num_albumdate,
        "num_albumuser":num_albumuser,
    }
    return res