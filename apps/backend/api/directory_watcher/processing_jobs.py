"""
Photo processing jobs (tags, geolocation, faces).

These jobs run after the main scan to enrich photos with additional
metadata like location information, image tags, and face detection.
"""

import traceback
import uuid
from uuid import UUID

from django import db
from django.db.models import Q
from django_q.tasks import AsyncTask

from api import util
from api.face_classify import cluster_all_faces
from api.models import Face, LongRunningJob, Photo
from api.models.photo_caption import PhotoCaption
from api.directory_watcher.utils import is_job_cancelled, update_scan_counter


def generate_face_embeddings(user, job_id: UUID):
    """
    Generate face embeddings for faces that don't have them yet.
    
    Args:
        user: The user whose faces to process
        job_id: Job ID for tracking progress
    """
    if Face.objects.filter(encoding="").count() == 0:
        return
    
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS,
        job_id=job_id,
    )

    try:
        faces = Face.objects.filter(encoding="")
        lrj.update_progress(current=0, target=faces.count())
        db.connections.close_all()

        for idx, face in enumerate(faces):
            # Check for cancellation periodically (every 100 items)
            if idx % 100 == 0 and is_job_cancelled(job_id):
                util.logger.info("Generate face embeddings job cancelled")
                return
            failed = False
            error = None
            try:
                face.generate_encoding()
            except Exception as err:
                util.logger.exception("An error occurred: ")
                print(f"[ERR]: {err}")
                failed = True
                error_msg = f"Face {face.id}: {str(err)}\n{traceback.format_exc()}"
                error = error_msg
            update_scan_counter(job_id, failed, error)

        lrj.complete()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)


def generate_tags(user, job_id: UUID, full_scan=False):
    """
    Generate image tags (Places365 captions) for photos.
    
    Args:
        user: The user whose photos to process
        job_id: Job ID for tracking progress
        full_scan: If True, process all photos; otherwise only new ones
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_GENERATE_TAGS,
        job_id=job_id,
    )

    try:
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_GENERATE_TAGS)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        from constance import config as site_config

        tagging_model = site_config.TAGGING_MODEL

        existing_photos = Photo.objects.filter(
            Q(owner=user.id)
            & (
                Q(caption_instance__isnull=True)
                | Q(caption_instance__captions_json__isnull=True)
                | Q(**{f"caption_instance__captions_json__{tagging_model}__isnull": True})
            )
        )
        if not full_scan and last_scan:
            existing_photos = existing_photos.filter(added_on__gt=last_scan.started_at)

        if existing_photos.count() == 0:
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return
        lrj.update_progress(current=0, target=existing_photos.count())
        db.connections.close_all()

        for idx, photo in enumerate(existing_photos):
            # Check for cancellation periodically (every 100 items)
            if idx % 100 == 0 and is_job_cancelled(job_id):
                util.logger.info("Generate tags job cancelled")
                return
            AsyncTask(generate_tag_job, photo, job_id).run()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)


def generate_tag_job(photo: Photo, job_id: str):
    """
    Worker task to generate tags for a single photo.
    
    Args:
        photo: The photo to process
        job_id: Job ID for tracking progress
    """
    failed = False
    error = None
    try:
        photo.refresh_from_db()
        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.generate_tag_captions(commit=True)
    except Exception as err:
        util.logger.exception("An error occurred: %s", photo.image_hash)
        print(f"[ERR]: {err}")
        failed = True
        error_msg = f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
        error = error_msg
    update_scan_counter(job_id, failed, error)


def add_geolocation(user, job_id: UUID, full_scan=False):
    """
    Add geolocation data to photos based on GPS coordinates.
    
    Args:
        user: The user whose photos to process
        job_id: Job ID for tracking progress
        full_scan: If True, process all photos; otherwise only new ones
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
        job_id=job_id,
    )

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
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return
        lrj.update_progress(current=0, target=existing_photos.count())
        db.connections.close_all()

        for idx, photo in enumerate(existing_photos):
            # Check for cancellation periodically (every 100 items)
            if idx % 100 == 0 and is_job_cancelled(job_id):
                util.logger.info("Add geolocation job cancelled")
                return
            AsyncTask(geolocation_job, photo, job_id).run()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)


def geolocation_job(photo: Photo, job_id: UUID):
    """
    Worker task to add geolocation for a single photo.
    
    Args:
        photo: The photo to process
        job_id: Job ID for tracking progress
    """
    failed = False
    error = None
    try:
        photo.refresh_from_db()
        photo._geolocate()
        photo._add_location_to_album_dates()
    except Exception as err:
        util.logger.exception("An error occurred: ")
        failed = True
        error_msg = f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
        error = error_msg
    update_scan_counter(job_id, failed, error)


def scan_faces(user, job_id: UUID, full_scan=False):
    """
    Detect and extract faces from photos.
    
    Args:
        user: The user whose photos to process
        job_id: Job ID for tracking progress
        full_scan: If True, process all photos; otherwise only new ones
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_FACES,
        job_id=job_id,
    )

    try:
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_SCAN_FACES)
            .filter(started_by=user)
            .order_by("-finished_at")
            .first()
        )
        existing_photos = Photo.objects.filter(
            Q(owner=user.id) & Q(thumbnail__thumbnail_big__isnull=False)
        )
        if not full_scan and last_scan:
            existing_photos = existing_photos.filter(added_on__gt=last_scan.started_at)

        if existing_photos.count() == 0:
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return

        lrj.update_progress(current=0, target=existing_photos.count())
        db.connections.close_all()

        for idx, photo in enumerate(existing_photos):
            # Check for cancellation periodically (every 100 items)
            if idx % 100 == 0 and is_job_cancelled(job_id):
                util.logger.info("Scan faces job cancelled")
                return
            failed = False
            error = None
            try:
                photo._extract_faces()
            except Exception as err:
                util.logger.exception("An error occurred: ")
                print(f"[ERR]: {err}")
                failed = True
                error_msg = f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
                error = error_msg
            update_scan_counter(job_id, failed, error)
    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)

    generate_face_embeddings(user, uuid.uuid4())
    cluster_all_faces(user, uuid.uuid4())
