"""
Photo processing jobs (tags, geolocation, faces).

These jobs run after the main scan to enrich photos with additional
metadata like location information, image tags, and face detection.
"""

import os
import traceback
import uuid
from uuid import UUID

from django import db
from django.db.models import Q
from django_q.tasks import AsyncTask

from api import util
from api.document_detection import classify_document
from api.face_classify import cluster_all_faces
from api.models import Face, LongRunningJob, Photo
from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.models.photo_ocr import PhotoOcr
from api.directory_watcher.utils import (
    CANCELLATION_CHECK_INTERVAL,
    is_job_cancelled,
    update_scan_counter,
)


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
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
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
                | Q(
                    **{
                        f"caption_instance__captions_json__{tagging_model}__isnull": True
                    }
                )
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
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
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


# Extensions cv2 can decode directly from the original file. Anything else
# (RAW: .cr2/.arw/.nef/.dng..., HEIC/HEIF) is not readable by cv2.imread, so we
# OCR the pre-rendered big thumbnail instead. A dedicated higher-resolution OCR
# render is a possible follow-up; we do not build render infrastructure here.
CV2_DECODABLE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}

# Minimum per-block confidence handed to the OCR sidecar (its contract default).
OCR_MIN_CONFIDENCE = 0.6


def ocr_image_source(photo: Photo):
    """Return the best local image path to feed the OCR sidecar for ``photo``.

    Prefer the original file when its extension is directly cv2-decodable
    (the sidecar reads with cv2.imread). RAW and HEIC/HEIF originals are not
    cv2-decodable, so those fall back to the already-rendered big thumbnail.
    Returns ``None`` when neither source is available.
    """
    main_file = photo.main_file
    if main_file and main_file.path:
        ext = os.path.splitext(main_file.path)[1].lower()
        if ext in CV2_DECODABLE_EXTENSIONS:
            return main_file.path
    try:
        return photo.thumbnail.thumbnail_big.path
    except Exception:
        return None


def generate_ocr(user, job_id: UUID, full_scan=False):
    """
    Extract text (OCR) from photos via the OCR sidecar.

    Mirrors :func:`generate_tags`: fans work out to per-photo AsyncTasks that
    each bump the shared job counter. Idempotent per active model -- a photo
    whose stored ``PhotoOcr.engine`` already equals the active ``OCR_MODEL`` is
    skipped, so switching tier (engine mismatch) naturally reprocesses.

    Args:
        user: The user whose photos to process
        job_id: Job ID for tracking progress
        full_scan: If True, reprocess every (non-video) photo regardless of
            what OCR data already exists
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_GENERATE_OCR,
        job_id=job_id,
    )

    try:
        from constance import config as site_config

        from api.ml_models import _is_model_not_selected

        ocr_model = site_config.OCR_MODEL

        # OCR disabled: finish cleanly with nothing to do. Use the same
        # semantics as ml_models (treats "", None and any-case "none" as
        # disabled) so a value like "" or "none" cannot fan out and store rows
        # with a bogus engine while ml_models refuses to download the model.
        if _is_model_not_selected(ocr_model):
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return

        # Baseline for the incremental delta: the most recent finished OCR run
        # that actually had work to do. Zero-target runs (a disabled no-op, or a
        # pass over an empty/fully-done library) are excluded so they never
        # establish a watermark -- otherwise enabling OCR later, then running
        # incrementally, would skip every pre-existing photo because they all
        # predate the placeholder job. A stale (older-than-ideal) baseline can
        # only widen the candidate scan; the engine-exclude below still prevents
        # any already-done photo from being reprocessed, so this is safe.
        last_scan = (
            LongRunningJob.objects.filter(finished=True)
            .filter(job_type=LongRunningJob.JOB_GENERATE_OCR)
            .filter(started_by=user)
            .exclude(progress_target=0)
            .order_by("-finished_at")
            .first()
        )

        existing_photos = Photo.objects.filter(owner=user.id).filter(video=False)
        if not full_scan:
            # Skip photos already OCR'd with the active model (idempotency).
            existing_photos = existing_photos.exclude(ocr__engine=ocr_model)
            if last_scan:
                # Incremental run: limit to photos added since the last run, but
                # always keep photos carrying a stale engine so a tier switch
                # reprocesses them even outside the new-photo window.
                existing_photos = existing_photos.filter(
                    Q(added_on__gt=last_scan.started_at) | Q(ocr__isnull=False)
                )

        if existing_photos.count() == 0:
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return
        lrj.update_progress(current=0, target=existing_photos.count())
        db.connections.close_all()

        for idx, photo in enumerate(existing_photos):
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
                util.logger.info("Generate OCR job cancelled")
                return
            AsyncTask(generate_ocr_job, photo, job_id).run()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)


def generate_ocr_job(photo: Photo, job_id: str):
    """
    Worker task to run OCR for a single photo and store the result.

    Args:
        photo: The photo to process
        job_id: Job ID for tracking progress
    """
    failed = False
    error = None
    try:
        photo.refresh_from_db()
        _run_ocr_for_photo(photo)
    except Exception as err:
        util.logger.exception("An error occurred: %s", photo.image_hash)
        print(f"[ERR]: {err}")
        failed = True
        error_msg = f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
        error = error_msg
    update_scan_counter(job_id, failed, error)


def _get_photo_ocr(photo: Photo):
    """Return the photo's :class:`PhotoOcr`, or ``None`` if it has none.

    The reverse one-to-one accessor raises when no row exists, so it is guarded.
    When the caller has ``select_related("ocr")`` this touches no extra query.
    """
    try:
        return photo.ocr
    except PhotoOcr.DoesNotExist:
        return None


def _siglip_labels_for_photo(photo: Photo) -> set[str]:
    """Return the lower-cased SigLIP 2 tag labels attached to ``photo``.

    SigLIP tags are stored as :class:`~api.models.album_thing.AlbumThing` rows
    (``thing_type="siglip2_tag"``) linked to the photo through the ``photos``
    M2M. Only the labels the document detector cares about are relevant, but we
    return them all lower-cased and let the detector intersect -- the set is
    tiny (a handful of tags per photo).
    """
    titles = AlbumThing.objects.filter(
        photos=photo, thing_type="siglip2_tag"
    ).values_list("title", flat=True)
    return {title.lower() for title in titles if title}


def _derive_is_document(
    photo: Photo, ocr_text: str | None, text_area_fraction: float | None
) -> bool:
    """Re-derive and persist ``photo.is_document`` from its current evidence.

    Skips photos the user has manually corrected (``category_source == "user"``)
    and only writes when the derived value actually changed, via a targeted
    ``save(update_fields=["is_document"])``. Returns the value in force after the
    call (unchanged for user-corrected photos).
    """
    if photo.category_source == "user":
        return photo.is_document

    new_value = classify_document(
        ocr_text, text_area_fraction, _siglip_labels_for_photo(photo)
    )
    if new_value != photo.is_document:
        photo.is_document = new_value
        photo.save(update_fields=["is_document"])
    return new_value


def _run_ocr_for_photo(photo: Photo):
    """Call the OCR sidecar for ``photo`` and persist the result.

    Raises on a non-OK service response so the caller records a per-photo
    failure (the job continues with the remaining photos).
    """
    import requests

    from constance import config as site_config

    from api.http_timeouts import OCR
    from api.ml_models import _is_model_not_selected

    ocr_model = site_config.OCR_MODEL
    if _is_model_not_selected(ocr_model):
        return

    image_path = ocr_image_source(photo)
    if not image_path:
        util.logger.warning(f"No OCR image source for photo {photo.image_hash}")
        return

    response = requests.post(
        "http://localhost:8012/ocr",
        json={"image_path": image_path, "min_confidence": OCR_MIN_CONFIDENCE},
        timeout=OCR,
    )
    if not response.ok:
        raise RuntimeError(
            f"OCR service returned status {response.status_code} for {image_path}"
        )

    data = response.json()
    ocr_text = data.get("text", "") or ""
    text_area_fraction = data.get("text_area_fraction")

    # update_or_create runs PhotoOcr.save(), which applies the text/blocks caps.
    PhotoOcr.objects.update_or_create(
        photo=photo,
        defaults={
            "text": ocr_text,
            "blocks": data.get("blocks", []) or [],
            "source_width": data.get("image_width"),
            "source_height": data.get("image_height"),
            "engine": ocr_model,
            "mean_confidence": data.get("mean_confidence"),
            "text_area_fraction": text_area_fraction,
        },
    )

    # Derive the document category from the fresh OCR evidence + SigLIP labels
    # (unless the user has pinned the category). The text cap (20k chars) never
    # affects the decision -- the thresholds are tens of chars -- so the raw
    # service text is safe to classify on.
    _derive_is_document(photo, ocr_text, text_area_fraction)

    # Note: OCR text is not folded into PhotoSearch.recreate_search_captions yet
    # -- indexing OCR text for search is a separate work package.
    util.logger.info(
        f"generated OCR ({ocr_model}) for image {image_path} "
        f"({len(data.get('text', '') or '')} chars)."
    )


def classify_media(user, job_id: UUID):
    """
    Backfill media-category flags (screenshot/document) for a user's photos.

    Unlike the tag/geolocation jobs the per-photo work is DB-only: it runs the
    pure :func:`api.screenshot_detection.classify` heuristic (``is_screenshot``)
    and, for photos that already carry an OCR row, the pure
    :func:`api.document_detection.classify_document` heuristic (``is_document``),
    then writes the results back in batches. No service calls, thumbnails or file
    reads. Photos a user has manually corrected (``category_source == "user"``)
    are left alone. Photos without an OCR row keep their existing ``is_document``
    (screenshot logic is unchanged for them).

    Args:
        user: The user whose photos to classify
        job_id: Job ID for tracking progress
    """
    from api.screenshot_detection import classify

    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_CLASSIFY_MEDIA,
        job_id=job_id,
    )

    # Flush accumulated updates in chunks to keep memory bounded on large
    # libraries while avoiding a write per photo.
    BATCH_SIZE = 200

    try:
        # select_related the OCR row so the per-photo is_document derivation does
        # not issue an extra query just to discover whether OCR exists.
        existing_photos = (
            Photo.objects.filter(owner=user.id)
            .exclude(category_source="user")
            .select_related("ocr")
        )

        target = existing_photos.count()
        if target == 0:
            lrj.update_progress(current=0, target=0)
            lrj.complete()
            return

        lrj.update_progress(current=0, target=target)
        db.connections.close_all()

        # Two accumulators: is_document is only ever written for photos whose
        # value actually changed (which implies they have OCR), so OCR-less
        # photos' is_document column is never touched.
        pending_screenshot = []
        pending_document = []

        def flush():
            if pending_screenshot:
                Photo.objects.bulk_update(pending_screenshot, ["is_screenshot"])
                pending_screenshot.clear()
            if pending_document:
                Photo.objects.bulk_update(pending_document, ["is_document"])
                pending_document.clear()

        for idx, photo in enumerate(existing_photos.iterator()):
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
                util.logger.info("Classify media job cancelled")
                return
            failed = False
            error = None
            try:
                new_screenshot = classify(photo)
                if new_screenshot != photo.is_screenshot:
                    photo.is_screenshot = new_screenshot
                    pending_screenshot.append(photo)

                ocr = _get_photo_ocr(photo)
                if ocr is not None:
                    new_document = classify_document(
                        ocr.text,
                        ocr.text_area_fraction,
                        _siglip_labels_for_photo(photo),
                    )
                    if new_document != photo.is_document:
                        photo.is_document = new_document
                        pending_document.append(photo)

                if len(pending_screenshot) + len(pending_document) >= BATCH_SIZE:
                    flush()
            except Exception as err:
                util.logger.exception("An error occurred: ")
                print(f"[ERR]: {err}")
                failed = True
                error_msg = (
                    f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
                )
                error = error_msg
            update_scan_counter(job_id, failed, error)

        flush()

    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)


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
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
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
            # Check for cancellation periodically
            if idx % CANCELLATION_CHECK_INTERVAL == 0 and is_job_cancelled(job_id):
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
                error_msg = (
                    f"Photo {photo.image_hash}: {str(err)}\n{traceback.format_exc()}"
                )
                error = error_msg
            update_scan_counter(job_id, failed, error)
    except Exception as err:
        util.logger.exception("An error occurred: ")
        print(f"[ERR]: {err}")
        lrj.fail(error=err)

    generate_face_embeddings(user, uuid.uuid4())
    cluster_all_faces(user, uuid.uuid4())
