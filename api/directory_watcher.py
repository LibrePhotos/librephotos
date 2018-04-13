from api.models import Photo
from api.models import Person
import os
import datetime
from tqdm import tqdm
import hashlib 
import pytz
from config import image_dirs
import ipdb

import api.util as util

def is_photos_being_added():
    photo_count = Photo.objects.count()
    if photo_count == 0:
        status = False
    else:
        # check if there has been a new photo added to the library within the
        # past 10 seconds. if so, return status false, as autoalbum generation
        # may behave wierdly if performed while photos are being added.
        last_photo_addedon = Photo.objects.order_by('-added_on')[0].added_on
        now = datetime.datetime.utcnow().replace(tzinfo=last_photo_addedon.tzinfo)
        td = (now-last_photo_addedon).total_seconds()
        if abs(td) < 10:
            status = True
        else:
            status = False
    return {'status':status}


def scan_photos():
    image_paths = []
    for image_dir in image_dirs:
        image_paths.extend([os.path.join(dp, f) for dp, dn, fn in os.walk(image_dir) for f in fn])

    added_photo_count = 0
    already_existing_photo = 0
    for image_path in tqdm(image_paths):
        if image_path.lower().endswith('.jpg'):
            try:
                img_abs_path = image_path
                hash_md5 = hashlib.md5()
                with open(img_abs_path, "rb") as f:
                    for chunk in iter(lambda: f.read(4096), b""):
                        hash_md5.update(chunk)
                image_hash = hash_md5.hexdigest()
                qs = Photo.objects.filter(image_hash=image_hash)

                if qs.count() < 1:
                    photo = Photo(image_path=img_abs_path)
                    photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
                    photo.geolocation_json = {}
                    photo.save()
                    photo._generate_md5()
                    
                    start = datetime.datetime.now()
                    photo._generate_thumbnail()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('thumbnail get', elapsed)


                    start = datetime.datetime.now()
                    photo._generate_captions()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('caption generation', elapsed)


                    start = datetime.datetime.now()
                    photo._save_image_to_db()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('image save', elapsed)

                    start = datetime.datetime.now()
                    photo._extract_exif()
                    photo.save()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('exif extraction', elapsed)

                    start = datetime.datetime.now()
                    photo._geolocate_mapbox()
                    photo.save()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('geolocation', elapsed)

                    start = datetime.datetime.now()
                    photo._extract_faces()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('face extraction', elapsed)

                    start = datetime.datetime.now()
                    photo._add_to_album_date()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    added_photo_count += 1
                    util.logger.info("Image processed: {}".format(img_abs_path))
                else:
                    already_existing_photo += 1
                    util.logger.info("photo already exists in db")
            except Exception as e:
                util.logger.error("Could not load image {}".format(image_path))

    util.logger.info("Added {}/{} photos".format(added_photo_count, len(image_paths) - already_existing_photo))
    return {"new_photo_count": added_photo_count, "status": True}
    # photos = Photo.objects.all()
    # for photo in photos:
    #     print(photo.image_hash)
    #     faces = photo.face_set.all()
    #     print(photo.face_set.all())


