from api.models import Photo
from api.models import Person
from api.models import LongRunningJob
import os
import datetime
from tqdm import tqdm
import hashlib 
import pytz
from config import image_dirs
import time

import api.util as util

from api.flags import \
    is_auto_albums_being_processed, \
    is_photos_being_added, \
    set_photo_scan_flag_on, \
    set_photo_scan_flag_off, \
    set_num_photos_added

import ipdb
from django_rq import job
import time
import numpy as np
import rq
# def is_photos_being_added():
#     global FLAG_IS_PHOTOS_BEING_ADDED
#     return {'status':FLAG_IS_PHOTOS_BEING_ADDED}

#     # Over complicating things as usual

#     # photo_count = Photo.objects.count()
#     # if photo_count == 0:
#     #     status = False
#     # else:
#     #     # check if there has been a new photo added to the library within the
#     #     # past 10 seconds. if so, return status false, as autoalbum generation
#     #     # may behave wierdly if performed while photos are being added.
#     #     last_photo_addedon = Photo.objects.order_by('-added_on')[0].added_on
#     #     now = datetime.datetime.utcnow().replace(tzinfo=last_photo_addedon.tzinfo)
#     #     td = (now-last_photo_addedon).total_seconds()
#     #     if abs(td) < 10:
#     #         status = True
#     #     else:
#     #         status = False
#     # return {'status':status}


@job
def long_running_job():
    print('hello')
    return 'hello'











@job
def scan_photos():
    lrj = LongRunningJob(
        job_id=rq.get_current_job().id,
        started_at=datetime.datetime.now(),
        job_type=LongRunningJob.JOB_SCAN_PHOTOS)
    lrj.save()

    for _ in tqdm(range(100000)):
        yy = np.random.randn(1000).dot(np.random.randn(1000))

    if is_photos_being_added()['status']:
        return {"new_photo_count": 0, "status": False, 'message':'photos are being added'}

    image_paths = []
    for image_dir in image_dirs:
        image_paths.extend([os.path.join(dp, f) for dp, dn, fn in os.walk(image_dir) for f in fn])

    image_paths = [p for p in image_paths if p.lower().endswith('.jpg') and 'thumb' not in p.lower()]
    image_paths.sort()

    set_photo_scan_flag_on(1)

    existing_hashes = [p.image_hash for p in Photo.objects.all()]

    image_paths_to_add = []
    for image_path in tqdm(image_paths):
        # hash_md5 = hashlib.md5()
        # with open(image_path, "rb") as f:
        #     for chunk in iter(lambda: f.read(4096), b""):
        #         hash_md5.update(chunk)
        # image_hash = hash_md5.hexdigest()
        # if image_hash not in existing_hashes:
        #     image_paths_to_add.append(image_path)


        if not Photo.objects.filter(image_path=image_path).exists():
            # ipdb.set_trace()    
            image_paths_to_add.append(image_path)

    set_photo_scan_flag_on(len(image_paths_to_add))


    added_photo_count = 0
    already_existing_photo = 0
    counter = 0
    for image_path in tqdm(image_paths_to_add):
        set_num_photos_added(counter)
        counter += 1
        if image_path.lower().endswith('.jpg'):
            try:
                img_abs_path = image_path

                start = datetime.datetime.now()
                hash_md5 = hashlib.md5()
                with open(img_abs_path, "rb") as f:
                    for chunk in iter(lambda: f.read(4096), b""):
                        hash_md5.update(chunk)
                image_hash = hash_md5.hexdigest()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                util.logger.info('generating md5 took %.2f'%elapsed)

                # qs = Photo.objects.filter(image_hash=image_hash)

                photo_exists = Photo.objects.filter(image_hash=image_hash).exists()

                if not photo_exists:
                    photo = Photo(image_path=img_abs_path)
                    photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
                    photo.geolocation_json = {}
                    photo.save()
                    photo._generate_md5()
                    
                    start = datetime.datetime.now()
                    photo._generate_thumbnail()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('thumbnail get took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._generate_captions()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('caption generation took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._save_image_to_db()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('image save took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._extract_exif()
                    photo.save()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('exif extraction took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._geolocate_mapbox()
                    photo.save()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('geolocation took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._add_to_album_place()
                    photo.save()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('add to AlbumPlace took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._extract_faces()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('face extraction took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._add_to_album_date()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('adding to AlbumDate took %.2f'%elapsed)

                    start = datetime.datetime.now()
                    photo._add_to_album_thing()
                    elapsed = (datetime.datetime.now() - start).total_seconds()
                    util.logger.info('adding to AlbumThing took %.2f'%elapsed)

                    added_photo_count += 1
                    util.logger.info("Image processed: {}".format(img_abs_path))
                else:
                    already_existing_photo += 1
                    util.logger.info("photo already exists in db")
                    print("photo already exists in db %s"%img_abs_path)
            except Exception as e:
                try: 
                    util.logger.error("Could not load image {}. reason: {}".format(image_path,e.__repr__()))
                except:
                    util.logger.error("Could not load image {}".format(image_path))

    util.logger.info("Added {}/{} photos".format(added_photo_count, len(image_paths) - already_existing_photo))
    
    set_photo_scan_flag_off()

    lrj = LongRunningJob.objects.get(job_id=rq.get_current_job().id)
    lrj.finished = True
    lrj.finished_at = datetime.datetime.now()
    lrj.result = {"new_photo_count": added_photo_count}
    lrj.save()
    return {"new_photo_count": added_photo_count, "status": True}

    # photos = Photo.objects.all()
    # for photo in photos:
    #     print(photo.image_hash)
    #     faces = photo.face_set.all()
    #     print(photo.face_set.all())


