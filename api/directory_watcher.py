import datetime
import hashlib
import os
import stat
from multiprocessing import Pool

import magic
import pytz
import pyvips
from django import db
from django.db.models import Q
from django_rq import job

import api.models.album_thing
import api.util as util
import ownphotos.settings
from api.image_similarity import build_image_similarity_index
from api.models import Face, LongRunningJob, Photo
from api.places365.places365 import place365_instance
from api.thumbnails import isRawPicture


def is_video(image_path):
    mime = magic.Magic(mime=True)
    filename = mime.from_file(image_path)
    return filename.find("video") != -1


def is_valid_media(image_path):
    if is_video(image_path):
        return True
    if isRawPicture(image_path):
        return True
    try:
        pyvips.Image.thumbnail(
            image_path, 10000, height=200, size=pyvips.enums.Size.DOWN
        )
        return True
    except Exception as e:
        util.logger.info("Could not handle {}, because {}".format(image_path, str(e)))
        return False


def calculate_hash(user, image_path):
    hash_md5 = hashlib.md5()
    with open(image_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)


def should_skip(filepath):
    if not os.getenv("SKIP_PATTERNS"):
        return False

    skip_patterns = os.getenv("SKIP_PATTERNS")
    skip_list = skip_patterns.split(",")
    skip_list = map(str.strip, skip_list)

    res = [ele for ele in skip_list if (ele in filepath)]
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
        except Exception:
            return False


else:

    def is_hidden(filepath):
        return os.path.basename(filepath).startswith(".")


def handle_new_image(user, image_path, job_id):
    if is_valid_media(image_path):
        try:
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
            }

            img_abs_path = image_path
            util.logger.info("job {}: handling image {}".format(job_id, img_abs_path))

            start = datetime.datetime.now()
            image_hash = calculate_hash(user, image_path)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            elapsed_times["md5"] = elapsed

            if not Photo.objects.filter(Q(image_hash=image_hash)).exists():
                photo = Photo()
                photo.image_paths.append(img_abs_path)
                photo.owner = user
                photo.image_hash = image_hash
                photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
                photo.geolocation_json = {}
                photo.video = is_video(img_abs_path)
                start = datetime.datetime.now()
                photo._generate_thumbnail(True)
                photo._calculate_aspect_ratio(False)
                photo._generate_captions(False)
                photo._generate_clip_embeddings(True)
                photo._extract_date_time_from_exif(True)
                photo._geolocate_mapbox(True)
                photo._extract_rating(True)
                photo._extract_faces()

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
                photo = Photo.objects.filter(Q(image_hash=image_hash)).first()
                photo.image_paths.append(img_abs_path)
                photo.save()
                photo._check_image_paths()
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
            except Exception:
                util.logger.exception(
                    "job {}: could not load image {}".format(job_id, image_path)
                )


def rescan_image(user, image_path, job_id):
    try:
        if is_valid_media(image_path):
            photo = Photo.objects.filter(Q(image_paths__contains=image_path)).get()
            photo._generate_thumbnail(True)
            photo._calculate_aspect_ratio(False)
            photo._generate_clip_embeddings(True)
            photo._extract_date_time_from_exif(True)
            photo._geolocate_mapbox(True)
            photo._extract_rating(True)

    except Exception as e:
        try:
            util.logger.exception(
                "job {}: could not load image {}. reason: {}".format(
                    job_id, image_path, str(e)
                )
            )
        except Exception:
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
                callback.append(fpath)


def _file_was_modified_after(filepath, time):
    modified = os.path.getmtime(filepath)
    return datetime.datetime.fromtimestamp(modified).replace(tzinfo=pytz.utc) > time


def photo_scanner(user, lastScan, full_scan, path, job_id):
    if Photo.objects.filter(image_paths__contains=path).exists():
        sidecar_file = util.get_existing_sidecar_file(path)
        if (
            full_scan
            or not lastScan
            or _file_was_modified_after(path, lastScan.finished_at)
            or (
                sidecar_file
                and _file_was_modified_after(sidecar_file, lastScan.finished_at)
            )
        ):
            rescan_image(user, path, job_id)
    else:
        handle_new_image(user, path, job_id)
    with db.connection.cursor() as cursor:
        cursor.execute(
            """
                update api_longrunningjob
                set result = jsonb_set(result,'{"progress","current"}',
                      ((jsonb_extract_path(result,'progress','current')::int + 1)::text)::jsonb
                ) where job_id = %(job_id)s""",
            {"job_id": str(job_id)},
        )


def initialize_scan_process(*args, **kwargs):
    """
    Each process will have its own exiftool instance
    so we need to start _and_ stop it for each process.
    multiprocessing.util.Finalize is _undocumented_ and
    should perhaps not be relied on but I found no other
    way. (See https://stackoverflow.com/a/24724452)

    """
    from multiprocessing.util import Finalize

    from api.util import exiftool_instance

    et = exiftool_instance.__enter__()
    Finalize(et, et.__exit__, exitpriority=16)


@job
def scan_photos(user, full_scan, job_id):
    if not os.path.exists(
        os.path.join(ownphotos.settings.MEDIA_ROOT, "thumbnails_big")
    ):
        os.mkdir(os.path.join(ownphotos.settings.MEDIA_ROOT, "square_thumbnails_small"))
        os.mkdir(os.path.join(ownphotos.settings.MEDIA_ROOT, "square_thumbnails"))
        os.mkdir(os.path.join(ownphotos.settings.MEDIA_ROOT, "thumbnails_big"))
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
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
        photoList = []
        walk_directory(user.scan_directory, photoList)
        files_found = len(photoList)
        lastScan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=1)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        all = []
        for path in photoList:
            all.append((user, lastScan, full_scan, path, job_id))

        lrj.result = {"progress": {"current": 0, "target": files_found}}
        lrj.save()
        db.connections.close_all()

        with Pool(
            processes=ownphotos.settings.HEAVYWEIGHT_PROCESS,
            initializer=initialize_scan_process,
        ) as pool:
            pool.starmap(photo_scanner, all)

        place365_instance.unload()
        util.logger.info(
            "Scanned {} files in : {}".format(files_found, user.scan_directory)
        )
        api.models.album_thing.update()
        exisisting_photos = Photo.objects.filter(owner=user.id)
        for existing_photo in exisisting_photos:
            existing_photo._check_image_paths()
        build_image_similarity_index(user)
    except Exception:
        util.logger.exception("An error occured: ")
        lrj.failed = True

    added_photo_count = Photo.objects.count() - photo_count_before
    util.logger.info("Added {} photos".format(added_photo_count))

    lrj.finished = True
    lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    lrj.result["new_photo_count"] = added_photo_count
    lrj.save()

    return {"new_photo_count": added_photo_count, "status": lrj.failed is False}


def face_scanner(photo, job_id):
    photo._extract_faces()
    with db.connection.cursor() as cursor:
        cursor.execute(
            """
                update api_longrunningjob
                set result = jsonb_set(result,'{"progress","current"}',
                      ((jsonb_extract_path(result,'progress','current')::int + 1)::text)::jsonb
                ) where job_id = %(job_id)s""",
            {"job_id": str(job_id)},
        )


@job
def scan_faces(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_SCAN_FACES,
        )
    lrj.save()

    face_count_before = Face.objects.count()
    try:
        existing_photos = Photo.objects.filter(owner=user.id)
        all = [(photo, job_id) for photo in existing_photos]

        lrj.result = {"progress": {"current": 0, "target": existing_photos.count()}}
        lrj.save()
        db.connections.close_all()
        with Pool(processes=ownphotos.settings.HEAVYWEIGHT_PROCESS) as pool:
            pool.starmap(face_scanner, all)

    except Exception:
        util.logger.exception("An error occured: ")
        lrj.failed = True

    added_face_count = Face.objects.count() - face_count_before
    util.logger.info("Added {} faces".format(added_face_count))

    lrj.finished = True
    lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    lrj.result["new_face_count"] = added_face_count
    lrj.save()

    return {"new_face_count": added_face_count, "status": lrj.failed is False}
