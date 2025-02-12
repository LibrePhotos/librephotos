import datetime
import os
import stat
import uuid
from uuid import UUID

import pytz
from constance import config as site_config
from django import db
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import F, Q, QuerySet
from django.utils import timezone
from django_q.tasks import AsyncTask, Chain

from api import util
from api.batch_jobs import batch_calculate_clip_embedding
from api.face_classify import cluster_all_faces
from api.models import Face, File, LongRunningJob, Photo
from api.models.file import (
    calculate_hash,
    extract_embedded_media,
    has_embedded_media,
    is_metadata,
    is_valid_media,
    is_video,
)


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


def create_new_image(user, path) -> Photo | None:
    """Creates a new Photo object based on user input and file path.

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
        util.logger.warning(f"embedded content file found {path}")
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
            util.logger.warning(f"no photo to metadata file found {path}")
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
        if photo.removed:
            photo.removed = False
            photo.in_trashcan = False
        photo.save()
        photo._check_files()
        util.logger.warning(f"photo {path} exists already")
        return photo


def handle_new_image(user, path, job_id, photo=None):
    """Handles the creation and all the processing of the photo needed for it to be displayed.

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
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(f"job {job_id}: save image: {path}, elapsed: {elapsed}")
        if photo:
            util.logger.info(f"job {job_id}: handling image {path}")
            photo._generate_thumbnail(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: generate thumbnails: {path}, elapsed: {elapsed}"
            )
            photo._calculate_aspect_ratio(False)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: calculate aspect ratio: {path}, elapsed: {elapsed}"
            )
            photo._extract_exif_data(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: extract exif data: {path}, elapsed: {elapsed}"
            )

            photo._extract_date_time_from_exif(True)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: extract date time: {path}, elapsed: {elapsed}"
            )
            photo._get_dominant_color()
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: get dominant color: {path}, elapsed: {elapsed}"
            )
            photo._recreate_search_captions()
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: search caption recreated: {path}, elapsed: {elapsed}"
            )

    except Exception as e:
        try:
            util.logger.exception(
                f"job {job_id}: could not load image {path}. reason: {str(e)}"
            )
        except Exception:
            util.logger.exception(f"job {job_id}: could not load image {path}")


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


def update_scan_counter(job_id, failed=False):
    # Increment the current progress
    LongRunningJob.objects.filter(job_id=job_id).update(
        progress_current=F("progress_current") + 1
    )

    # Mark the job as finished if the current progress equals the target
    LongRunningJob.objects.filter(
        job_id=job_id, progress_current=F("progress_target")
    ).update(finished=True, finished_at=timezone.now())

    # Mark the job as failed if the failed flag is set
    if failed:
        LongRunningJob.objects.filter(job_id=job_id).update(failed=True)


def photo_scanner(user, last_scan, full_scan, path, job_id):
    files_to_check = [path]
    files_to_check.extend(util.get_sidecar_files_in_priority_order(path))
    if (
        not Photo.objects.filter(files__path=path).exists()
        or full_scan
        or not last_scan
        or any(
            [_file_was_modified_after(p, last_scan.finished_at) for p in files_to_check]
        )
    ):
        AsyncTask(handle_new_image, user, path, job_id).run()
    else:
        update_scan_counter(job_id)


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

        lrj.progress_current = 0
        lrj.progress_target = files_found
        lrj.save()
        db.connections.close_all()

        for photo in all:
            photo_scanner(*photo)

        util.logger.info(f"Scanned {files_found} files in : {scan_directory}")

        util.logger.info("Finished updating album things")

        # if the scan type is not the default user scan directory, or if it is specified as only scanning
        # specific files, there is no need to rescan fully for missing photos.
        if full_scan or (scan_directory == user.scan_directory and not scan_files):
            AsyncTask(scan_missing_photos, user, uuid.uuid4()).run()
        AsyncTask(generate_tags, user, uuid.uuid4(), full_scan).run()
        AsyncTask(add_geolocation, user, uuid.uuid4(), full_scan).run()

        # The scan faces job will have issues if the embeddings haven't been generated before it runs
        chain = Chain()
        chain.append(batch_calculate_clip_embedding, user)
        chain.append(scan_faces, user, uuid.uuid4(), full_scan)
        chain.run()

    except Exception:
        util.logger.exception("An error occurred: ")
        lrj.failed = True

    added_photo_count = Photo.objects.count() - photo_count_before
    util.logger.info(f"Added {added_photo_count} photos")


def scan_missing_photos(user, job_id: UUID):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_SCAN_MISSING_PHOTOS,
        )
    lrj.save()
    try:
        exisisting_photos = Photo.objects.filter(owner=user.id).order_by("image_hash")

        paginator = Paginator(exisisting_photos, 5000)
        lrj.progress_target = paginator.num_pages
        lrj.save()
        for page in range(1, paginator.num_pages + 1):
            for existing_photo in paginator.page(page).object_list:
                existing_photo._check_files()

            update_scan_counter(job_id)

        util.logger.info("Finished checking paths for missing photos")
    except Exception:
        util.logger.exception("An error occurred: ")
        lrj.failed = True


def generate_face_embeddings(user, job_id: UUID):
    if Face.objects.filter(encoding="").count() == 0:
        return
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS,
        )
    lrj.save()

    try:
        faces = Face.objects.filter(encoding="")
        lrj.progress_target = faces.count()
        lrj.save()
        db.connections.close_all()

        for face in faces:
            failed = False
            try:
                face.generate_encoding()
            except Exception as err:
                util.logger.exception("An error occurred: ")
                print(f"[ERR]: {err}")
                failed = True
            update_scan_counter(job_id, failed)

        lrj.finished = True

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.failed = True


def generate_tags(user, job_id: UUID, full_scan=False):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
        )
    lrj.save()

    try:
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_GENERATE_TAGS)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        existing_photos = Photo.objects.filter(
            Q(owner=user.id)
            & Q(captions_json__isnull=True)
            & Q(captions_json__places365__isnull=True)
        )
        if not full_scan and last_scan:
            existing_photos = existing_photos.filter(added_on__gt=last_scan.started_at)

        if existing_photos.count() == 0:
            lrj.progress_target = 0
            lrj.progress_current = 0
            lrj.finished = True
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return
        lrj.progress_target = existing_photos.count()
        lrj.save()
        db.connections.close_all()

        for photo in existing_photos:
            AsyncTask(generate_tag_job, photo, job_id).run()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.failed = True


def generate_tag_job(photo: Photo, job_id: str):
    failed = False
    try:
        photo.refresh_from_db()
        photo._generate_captions(True)
    except Exception as err:
        util.logger.exception("An error occurred: %s", photo.image_hash)

        print(f"[ERR]: {err}")
        failed = True
    update_scan_counter(job_id, failed)


def add_geolocation(user, job_id: UUID, full_scan=False):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
        )
    lrj.save()

    try:
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_ADD_GEOLOCATION)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        existing_photos = Photo.objects.filter(owner=user.id)
        if not full_scan and last_scan:
            existing_photos = existing_photos.filter(added_on__gt=last_scan.started_at)
        if existing_photos.count() == 0:
            lrj.progress_target = 0
            lrj.finished = True
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.progress_current = 0
            lrj.save()
            return
        lrj.progress_target = existing_photos.count()
        lrj.save()
        db.connections.close_all()

        for photo in existing_photos:
            AsyncTask(geolocation_job, photo, job_id).run()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.failed = True


def geolocation_job(photo: Photo, job_id: UUID):
    failed = False
    try:
        photo.refresh_from_db()
        photo._geolocate()
        photo._add_location_to_album_dates()
    except Exception:
        util.logger.exception("An error occurred: ")
        failed = True
    update_scan_counter(job_id, failed)


def scan_faces(user, job_id: UUID, full_scan=False):
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
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_SCAN_FACES)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        existing_photos = Photo.objects.filter(
            Q(owner=user.id) & Q(thumbnail_big__isnull=False)
        )
        if not full_scan and last_scan:
            existing_photos = existing_photos.filter(added_on__gt=last_scan.started_at)

        if existing_photos.count() == 0:
            lrj.progress_current = 0
            lrj.progress_target = 0
            lrj.finished = True
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return

        lrj.progress_target = existing_photos.count()
        lrj.save()
        db.connections.close_all()

        for photo in existing_photos:
            failed = False
            try:
                photo._extract_faces()
            except Exception as err:
                util.logger.exception("An error occurred: ")
                print(f"[ERR]: {err}")
                failed = True
            update_scan_counter(job_id, failed)
    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.failed = True

    generate_face_embeddings(user, uuid.uuid4())
    cluster_all_faces(user, uuid.uuid4())
