import os
import datetime
import hashlib
import pytz
from api.models import (Photo, LongRunningJob)

import api.util as util
from api.image_similarity import build_image_similarity_index

from django_rq import job
from django.db.models import Q
import magic

def isValidMedia(p):
    try:
        filetype = magic.from_file(p, mime=True)
        return filetype.find('image/jpeg') or filetype.find('image/png')
    except:
        util.logger.exception("Following image throwed an exception: " + p)
        return False

def handle_new_image(user, image_path, job_id):
    
    if isValidMedia(image_path):
        try:
            elapsed_times = {
                'md5':None,
                'thumbnails':None,
                'captions':None,
                'image_save':None,
                'exif':None,
                'geolocation':None,
                'faces':None,
                'album_place':None,
                'album_date':None,
                'album_thing':None,
                'im2vec':None
            }

            img_abs_path = image_path
            util.logger.info('job {}: handling image {}'.format(job_id,img_abs_path))

            start = datetime.datetime.now()
            hash_md5 = hashlib.md5()
            with open(img_abs_path, "rb") as f:
                for chunk in iter(lambda: f.read(4096), b""):
                    hash_md5.update(chunk)
            image_hash = hash_md5.hexdigest() + str(user.id)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            elapsed_times['md5'] = elapsed

            photo_exists = Photo.objects.filter(
                Q(image_hash=image_hash)
                & Q(image_path=image_path)).exists()

            if not photo_exists:
                photo = Photo.objects.create(
                    image_path=img_abs_path,
                    owner=user,
                    image_hash=image_hash,
                    added_on=datetime.datetime.now().replace(tzinfo=pytz.utc),
                    geolocation_json={})                
                   
                start = datetime.datetime.now()
                
                photo._generate_thumbnail()
                photo._generate_captions()
                photo._extract_exif()
                photo._geolocate_mapbox()
                photo._add_to_album_place()
                photo._extract_faces()
                photo._add_to_album_date()
                photo._add_to_album_thing()
                photo._im2vec()

                elapsed = (datetime.datetime.now() - start).total_seconds()
                util.logger.info("job {}: image processed: {}, elapsed: {}".format(job_id,img_abs_path,elapsed))

                if photo.image_hash == '':
                    util.logger.warning("job {}: image hash is an empty string. File path: {}".format(job_id,photo.image_path))
            else:
                util.logger.warning("job {}: file {} exists already".format(job_id,image_path))

        except Exception as e:
            try:
                util.logger.exception("job {}: could not load image {}. reason: {}".format(
                    job_id,image_path, str(e)))
            except:
                util.logger.exception("job {}: could not load image {}".format(job_id,image_path))
    

#job is currently not used, because the model.eval() doesn't execute when it is running as a job
@job
def scan_photos(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS)
        lrj.save()

    added_photo_count = 0
    already_existing_photo = 0

    try:
        image_paths = []

        image_paths.extend([
            os.path.join(dp, f) for dp, dn, fn in os.walk(user.scan_directory)
            for f in fn
        ])

        image_paths = [
            p for p in image_paths
            if isValidMedia(p) and 'thumb' not in p.lower()
        ]
        image_paths.sort()

        existing_hashes = [p.image_hash for p in Photo.objects.all()]

        # Create a list with all images whose hash is new or they do not exist in the db
        image_paths_to_add = []
        for image_path in image_paths:
            if not Photo.objects.filter(image_path=image_path).exists():
                image_paths_to_add.append(image_path)

        to_add_count = len(image_paths_to_add)
        for idx, image_path in enumerate(image_paths_to_add):
            handle_new_image(user, image_path, job_id)
            lrj.result = {
                'progress': {
                    "current": idx + 1,
                    "target": to_add_count
                }
            }
            lrj.save()

        util.logger.info("Added {} photos".format(len(image_paths_to_add)))
        build_image_similarity_index(user)

        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        prev_result = lrj.result
        next_result = prev_result
        next_result['new_photo_count'] = added_photo_count
        lrj.result = next_result
        lrj.save()
    except Exception:
        util.logger.exception("An error occured:")
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.finished = True
        lrj.failed = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        prev_result = lrj.result
        next_result = prev_result
        next_result['new_photo_count'] = 0
        lrj.result = next_result
        lrj.save()
    return {"new_photo_count": added_photo_count, "status": True}
