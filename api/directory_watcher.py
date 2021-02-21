import datetime
import hashlib
import os
import stat

import magic
import pytz
from django.db.models import Q
from django_rq import job
from PIL import Image

import api.util as util
from api.image_similarity import build_image_similarity_index
from api.models import LongRunningJob, Photo


def is_valid_media(filebuffer):
    try:
        filetype = magic.from_buffer(filebuffer, mime=True)
        return (
            "jpeg" in filetype
            or "png" in filetype
            or "bmp" in filetype
            or "gif" in filetype
            or "heic" in filetype
            or "heif" in filetype
        )
    except:
        util.logger.exception("An image throwed an exception")
        return False


def calculate_hash(user, image_path):
    hash_md5 = hashlib.md5()
    with open(image_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)

def should_skip(filepath):
    if not os.getenv('SKIP_PATTERNS'):
        return False

    skip_patterns = os.getenv('SKIP_PATTERNS')
    skip_list = skip_patterns.split(',')
    skip_list = map(str.strip, skip_list)

    res = [ele for ele in skip_list if(ele in filepath)]
    return bool(res)

if os.name == "Windows":
    def is_hidden(filepath):
        name = os.path.basename(os.path.abspath(filepath))
        return name.startswith(".") or has_hidden_attribute(filepath)

    def has_hidden_attribute(filepath):
        try:
            return bool(
                os.stat(filepath).st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN
            )
        except:
            return False
else:
    def is_hidden(filepath):
        return os.path.basename(filepath).startswith(".")


def handle_new_image(user, image_path, job_id):
    try:
        if is_valid_media(open(image_path, "rb").read(2048)):
            elapsed_times = {
                "md5": None,
                "thumbnails": None,
                "captions": None,
                "image_save": None,
                "exif": None,
                "geolocation": None,
                "faces": None,
                "album_place": None,
                "album_date": None,
                "album_thing": None,
                "im2vec": None,
            }

            img_abs_path = image_path
            util.logger.info("job {}: handling image {}".format(job_id, img_abs_path))

            start = datetime.datetime.now()
            image_hash = calculate_hash(user, image_path)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            elapsed_times["md5"] = elapsed

            photo_exists = Photo.objects.filter(
                Q(image_hash=image_hash)
            ).exists()

            if not photo_exists:
                photo = Photo.objects.create(
                    image_path=img_abs_path,
                    owner=user,
                    image_hash=image_hash,
                    added_on=datetime.datetime.now().replace(tzinfo=pytz.utc),
                    geolocation_json={},
                )

                start = datetime.datetime.now()

                photo._generate_thumbnail()
                photo._generate_captions()
                photo._extract_date_time_from_exif()
                photo._extract_gps_from_exif()
                photo._geolocate_mapbox()
                photo._add_to_album_place()
                photo._extract_faces()
                photo._add_to_album_date()
                photo._add_to_album_thing()
                photo._im2vec()

                elapsed = (datetime.datetime.now() - start).total_seconds()
                util.logger.info(
                    "job {}: image processed: {}, elapsed: {}".format(
                        job_id, img_abs_path, elapsed
                    )
                )

                if photo.image_hash == "":
                    util.logger.warning(
                        "job {}: image hash is an empty string. File path: {}".format(
                            job_id, photo.image_path
                        )
                    )
            else:
                util.logger.warning(
                    "job {}: file {} exists already".format(job_id, image_path)
                )

    except Exception as e:
        try:
            util.logger.exception(
                "job {}: could not load image {}. reason: {}".format(
                    job_id, image_path, str(e)
                )
            )
        except:
            util.logger.exception(
                "job {}: could not load image {}".format(job_id, image_path)
            )


def rescan_image(user, image_path, job_id):
    try:
        if is_valid_media(open(image_path, "rb").read(2048)):
            photo = Photo.objects.filter(Q(image_path=image_path)).get()
            photo._generate_thumbnail()
            photo._extract_date_time_from_exif()

    except Exception as e:
        try:
            util.logger.exception(
                "job {}: could not load image {}. reason: {}".format(
                    job_id, image_path, str(e)
                )
            )
        except:
            util.logger.exception(
                "job {}: could not load image {}".format(job_id, image_path)
            )


def walk_directory(directory, callback):
    for file in os.scandir(directory):
        fpath = os.path.join(directory, file)
        if not is_hidden(fpath) and not should_skip(fpath):
            if os.path.isdir(fpath):
                walk_directory(fpath, callback)
            else:
                callback.read_file(fpath)


class file_counter:
    counter = 0

    def read_file(self, path):
        self.counter += 1


class photo_scanner:
    def __init__(self, user, lrj, job_id, file_count):
        self.to_add_count = file_count
        self.job_id = job_id
        self.counter = 0
        self.user = user
        self.lrj = lrj

    def read_file(self, path):
        # update progress
        self.counter += 1
        self.lrj.result = {
            "progress": {"current": self.counter, "target": self.to_add_count}
        }
        self.lrj.save()
        # scan new or update existing image
        if Photo.objects.filter(image_path=path).exists():
            rescan_image(self.user, path, self.job_id)
        else:
            handle_new_image(self.user, path, self.job_id)


# job is currently not used, because the model.eval() doesn't execute when it is running as a job
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
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        )
        lrj.save()

    photo_count_before = Photo.objects.count()

    try:
        fc = file_counter()  # first walk and count sum of files
        walk_directory(user.scan_directory, fc)
        files_found = fc.counter

        ps = photo_scanner(user, lrj, job_id, files_found)
        walk_directory(user.scan_directory, ps)  # now walk with photo-scannning

        util.logger.info(
            "Scanned {} files in : {}".format(files_found, user.scan_directory)
        )

        build_image_similarity_index(user)
    except Exception:
        util.logger.exception("An error occured:")
        lrj.failed = True

    added_photo_count = Photo.objects.count() - photo_count_before
    util.logger.info("Added {} photos".format(added_photo_count))

    lrj.finished = True
    lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    lrj.result["new_photo_count"] = added_photo_count
    lrj.save()

    return {"new_photo_count": added_photo_count, "status": lrj.failed == False}
