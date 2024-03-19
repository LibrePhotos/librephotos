import datetime
import os
import stat
import uuid
from typing import Optional

import pytz
from constance import config as site_config
from django import db
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import Q, QuerySet
from django_q.tasks import AsyncTask

import api.models.album_thing
import api.util as util
from api.batch_jobs import create_batch_job
from api.face_classify import cluster_all_faces
from api.models import File, LongRunningJob, Photo
from api.models.file import (
    calculate_hash,
    extract_embedded_media,
    has_embedded_media,
    is_metadata,
    is_valid_media,
    is_video,
)
from api.places365.places365 import place365_instance


def should_skip(path):
    if not site_config.SKIP_PATTERNS:
        return False

    skip_patterns = site_config.SKIP_PATTERNS
    skip_list = skip_patterns.split(",")
    skip_list = map(str.strip, skip_list)

    res = [ele for ele in skip_list if (ele in path)]
    return bool(res)


if os.name == "Windows":

    def is_hidden(path):
        name = os.path.basename(os.path.abspath(path))
        return name.startswith(".") or has_hidden_attribute(path)

    def has_hidden_attribute(path):
        try:
            return bool(os.stat(path).st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN)
        except Exception:
            return False

else:

    def is_hidden(path):
        return os.path.basename(path).startswith(".")


def create_new_image(user, path) -> Optional[Photo]:
    """
    Creates a new Photo object based on user input and file path.

    Args:
        user: The owner of the photo.
        path: The file path of the image.

    Returns:
        Optional[Photo]: The created Photo object if successful, otherwise returns None.

    Note:
        This function checks for embedded content, associates metadata files with existing Photos,
        creates new Photos based on hash, and handles existing Photos by adding new Files.

    Raises:
        No explicit exceptions are raised by this function.

    Example:
        photo_instance = create_new_image(current_user, "/path/to/image.jpg")
    """
    if not is_valid_media(path):
        return
    hash = calculate_hash(user, path)
    if File.embedded_media.through.objects.filter(Q(to_file_id=hash)).exists():
        util.logger.warning("embedded content file found {}".format(path))
        return

    if is_metadata(path):
        photo_name = os.path.splitext(os.path.basename(path))[0]
        photo_dir = os.path.dirname(path)
        photo = Photo.objects.filter(
            Q(files__path__contains=photo_dir)
            & Q(files__path__contains=photo_name)
            & ~Q(files__path__contains=os.path.basename(path))
        ).first()

        if photo:
            file = File.create(path, user)
            photo.files.add(file)
            photo.save()
        else:
            util.logger.warning("no photo to metadata file found {}".format(path))
        return

    photos: QuerySet[Photo] = Photo.objects.filter(Q(image_hash=hash))
    if not photos.exists():
        photo: Photo = Photo()
        photo.image_hash = hash
        photo.owner = user
        photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
        photo.geolocation_json = {}
        photo.video = is_video(path)
        photo.save()
        file = File.create(path, user)
        if has_embedded_media(file):
            em_path = extract_embedded_media(file)
            if em_path:
                em_file = File.create(em_path, user)
                file.embedded_media.add(em_file)
        photo.files.add(file)
        photo.main_file = file
        photo.save()
        return photo
    else:
        file = File.create(path, user)
        photo = photos.first()
        photo.files.add(file)
        photo.save()
        photo._check_files()
        util.logger.warning("photo {} exists already".format(path))
        return None


def handle_new_image(user, path, job_id, photo=None):
    """
    Handles the creation and all the processing of the photo.

    Args:
        user: The owner of the photo.
        path: The file path of the image.
        job_id: The long-running job id, which gets updated when the task runs
        photo: An optional parameter, where you can input a photo instead of creating a new one. Used for uploading.

    Note:
        This function is used, when uploading a picture, because rescanning does not perform machine learning tasks
    """
    update_scan_counter(job_id)
    try:
        start = datetime.datetime.now()
        if photo is None:
            photo = create_new_image(user, path)
        if photo:
            util.logger.info("job {}: handling image {}".format(job_id, path))
            photo._generate_thumbnail(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: generate thumbnails: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._calculate_aspect_ratio(False)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: calculate aspect ratio: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._generate_captions(False)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: generate caption: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._geolocate(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: geolocate: {}, elapsed: {}".format(job_id, path, elapsed)
            )
            photo._extract_date_time_from_exif(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: extract date time: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._add_location_to_album_dates()
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: add location to album dates: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._extract_exif_data(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: extract exif data: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )

            photo._extract_rating(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: extract rating: {}, elapsed: {}".format(job_id, path, elapsed)
            )
            photo._extract_video_length(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: extract video length: {}, elapsed: {}".format(
                    job_id, path, elapsed
                )
            )
            photo._extract_faces()
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: extract faces: {}, elapsed: {}".format(job_id, path, elapsed)
            )
            photo._get_dominant_color()
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "job {}: image processed: {}, elapsed: {}".format(job_id, path, elapsed)
            )
    except Exception as e:
        try:
            util.logger.exception(
                "job {}: could not load image {}. reason: {}".format(
                    job_id, path, str(e)
                )
            )
        except Exception:
            util.logger.exception(
                "job {}: could not load image {}".format(job_id, path)
            )


def rescan_image(user, path, job_id):
    update_scan_counter(job_id)
    try:
        if is_valid_media(path):
            photo = Photo.objects.filter(Q(files__path=path)).get()
            photo._generate_thumbnail(True)
            photo._calculate_aspect_ratio(False)
            photo._geolocate(True)
            photo._extract_exif_data(True)
            photo._extract_date_time_from_exif(True)
            photo._add_location_to_album_dates()
            photo._extract_rating(True)
            photo._extract_video_length(True)
            photo._get_dominant_color()

    except Exception as e:
        try:
            util.logger.exception(
                "job {}: could not load image {}. reason: {}".format(
                    job_id, path, str(e)
                )
            )
        except Exception:
            util.logger.exception(
                "job {}: could not load image {}".format(job_id, path)
            )


def walk_directory(directory, callback):
    for file in os.scandir(directory):
        fpath = os.path.join(directory, file)
        if not is_hidden(fpath) and not should_skip(fpath):
            if os.path.isdir(fpath):
                walk_directory(fpath, callback)
            else:
                callback.append(fpath)


def walk_files(scan_files, callback):
    for fpath in scan_files:
        if os.path.isfile(fpath):
            callback.append(fpath)


def _file_was_modified_after(filepath, time):
    try:
        modified = os.path.getmtime(filepath)
    except OSError:
        return False
    return datetime.datetime.fromtimestamp(modified).replace(tzinfo=pytz.utc) > time


def update_scan_counter(job_id):
    with db.connection.cursor() as cursor:
        cursor.execute(
            """
                    update api_longrunningjob
                    set result = jsonb_set(result,'{"progress","current"}',
                        ((jsonb_extract_path(result,'progress','current')::int + 1)::text)::jsonb
                    ) where job_id = %(job_id)s""",
            {"job_id": str(job_id)},
        )
        cursor.execute(
            """
                update api_longrunningjob
                set finished = true, finished_at = now()
                where job_id = %(job_id)s and
                        (result->'progress'->>'current')::int = (result->'progress'->>'target')::int
            """,
            {"job_id": str(job_id)},
        )


def photo_scanner(user, last_scan, full_scan, path, job_id):
    if Photo.objects.filter(files__path=path).exists():
        files_to_check = [path]
        files_to_check.extend(util.get_sidecar_files_in_priority_order(path))
        if (
            full_scan
            or not last_scan
            or any(
                [
                    _file_was_modified_after(p, last_scan.finished_at)
                    for p in files_to_check
                ]
            )
        ):
            AsyncTask(rescan_image, user, path, job_id).run()
        else:
            update_scan_counter(job_id)
    else:
        AsyncTask(handle_new_image, user, path, job_id).run()


def scan_photos(user, full_scan, job_id, scan_directory="", scan_files=[]):
    if not os.path.exists(os.path.join(settings.MEDIA_ROOT, "thumbnails_big")):
        os.mkdir(os.path.join(settings.MEDIA_ROOT, "square_thumbnails_small"))
        os.mkdir(os.path.join(settings.MEDIA_ROOT, "square_thumbnails"))
        os.mkdir(os.path.join(settings.MEDIA_ROOT, "thumbnails_big"))
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
        if scan_directory == "":
            scan_directory = user.scan_directory
        photo_list = []
        if scan_files:
            walk_files(scan_files, photo_list)
        else:
            walk_directory(scan_directory, photo_list)
        files_found = len(photo_list)
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=1)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        all = []
        for path in photo_list:
            all.append((user, last_scan, full_scan, path, job_id))

        lrj.result = {"progress": {"current": 0, "target": files_found}}
        lrj.save()
        db.connections.close_all()

        for photo in all:
            photo_scanner(*photo)

        place365_instance.unload()
        util.logger.info("Scanned {} files in : {}".format(files_found, scan_directory))
        api.models.album_thing.update()
        util.logger.info("Finished updating album things")
        exisisting_photos = Photo.objects.filter(owner=user.id).order_by("image_hash")
        paginator = Paginator(exisisting_photos, 5000)
        for page in range(1, paginator.num_pages + 1):
            for existing_photo in paginator.page(page).object_list:
                existing_photo._check_files()
        util.logger.info("Finished checking paths")
        create_batch_job(LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS, user)
    except Exception:
        util.logger.exception("An error occurred: ")
        lrj.failed = True

    added_photo_count = Photo.objects.count() - photo_count_before
    util.logger.info("Added {} photos".format(added_photo_count))

    cluster_job_id = uuid.uuid4()
    AsyncTask(cluster_all_faces, user, cluster_job_id).run()


def face_scanner(photo: Photo, job_id):
    AsyncTask(face_scan_job, photo, job_id).run()


def face_scan_job(photo: Photo, job_id):
    failed = False
    try:
        photo._extract_faces()
    except Exception:
        util.logger.exception("An error occurred: ")
        failed = True
    with db.connection.cursor() as cursor:
        cursor.execute(
            """
                update api_longrunningjob
                set result = jsonb_set(result,'{"progress","current"}',
                      ((jsonb_extract_path(result,'progress','current')::int + 1)::text)::jsonb
                ) where job_id = %(job_id)s""",
            {"job_id": str(job_id)},
        )
        cursor.execute(
            """
                update api_longrunningjob
                set finished = true
                where job_id = %(job_id)s and
                        (result->'progress'->>'current')::int = (result->'progress'->>'target')::int
            """,
            {"job_id": str(job_id)},
        )
        if failed:
            cursor.execute(
                """
                    update api_longrunningjob
                    set failed = %(failed)s
                    where job_id = %(job_id)s
                """,
                {"job_id": str(job_id), "failed": failed},
            )


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

    try:
        existing_photos = Photo.objects.filter(owner=user.id)
        all = [(photo, job_id) for photo in existing_photos]

        lrj.result = {"progress": {"current": 0, "target": existing_photos.count()}}
        lrj.save()
        db.connections.close_all()

        for photo in all:
            face_scanner(*photo)

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print("[ERR]: {}".format(err))
        lrj.failed = True

    cluster_job_id = uuid.uuid4()
    AsyncTask(cluster_all_faces, user, cluster_job_id).run()
