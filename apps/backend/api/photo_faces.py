"""Finding the faces in a photo and saving them as ``Face`` rows.

``api.face_extractor`` locates faces (face service or XMP regions); this
module crops and persists them for a photo, reconciling XMP names with faces
already found. Moved out of ``Photo``; every function taking a photo takes it
as its first argument.
"""

import logging
from io import BytesIO

import numpy as np
import PIL
from django.conf import settings
from django.core.files.base import ContentFile
from django.db.utils import IntegrityError

import api.models
from api import face_extractor
from api.util import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou

logger = logging.getLogger(__name__)


def overlaps_existing_face(existing_face_locations, top, right, bottom, left):
    """Return True if a new face region overlaps significantly with any
    existing face (IoU >= FACE_OVERLAP_IOU_THRESHOLD).

    *existing_face_locations* is an iterable of (top, right, bottom, left) tuples.
    """
    for ex_top, ex_right, ex_bottom, ex_left in existing_face_locations:
        iou = calculate_iou(
            top, right, bottom, left, ex_top, ex_right, ex_bottom, ex_left
        )
        if iou >= FACE_OVERLAP_IOU_THRESHOLD:
            return True
    return False


def extract_faces(photo, second_try=False):
    """Detect the photo's faces and save the new ones.

    An ``IntegrityError`` (two workers saving at once) is retried exactly once
    and then swallowed; every other exception is re-raised.
    """
    if not settings.FEATURE_FACE_DETECTION:
        logger.info("Face detection is disabled")
        return

    unknown_cluster: api.models.cluster.Cluster = (
        api.models.cluster.get_unknown_cluster(user=photo.owner)
    )
    try:
        _detect_and_save_faces(photo, unknown_cluster)
    except IntegrityError:
        _retry_face_extraction(photo, second_try)
    except Exception as e:
        logger.error(f"image {photo}: scan face failed")
        raise e


def _detect_and_save_faces(photo, unknown_cluster):
    big_thumbnail_image = np.array(PIL.Image.open(photo.thumbnail.thumbnail_big.path))

    face_locations = face_extractor.extract(
        photo.main_file.path, photo.thumbnail.thumbnail_big.path, photo.owner
    )

    if len(face_locations) == 0:
        return

    # Fetch existing face locations once to avoid repeated DB queries.
    existing_face_locations = list(
        api.models.face.Face.objects.filter(photo=photo).values_list(
            "location_top", "location_right", "location_bottom", "location_left"
        )
    )

    for idx_face, face_location in enumerate(face_locations):
        # Faces from the face service carry their encoding; XMP regions
        # get one later from generate_face_embeddings.
        top, right, bottom, left, person_name, *encoding = face_location
        person = _get_or_create_named_person(photo, person_name)

        face_image = big_thumbnail_image[top:bottom, left:right]
        face_image = PIL.Image.fromarray(face_image)

        image_path = photo.image_hash + "_" + str(idx_face) + ".jpg"

        if overlaps_existing_face(existing_face_locations, top, right, bottom, left):
            if person is not None:
                _reconcile_xmp_face_name(
                    photo, person, person_name, (top, right, bottom, left)
                )
            continue

        save_detected_face(
            photo,
            face_image,
            image_path,
            person,
            unknown_cluster,
            (top, right, bottom, left),
            encoding[0] if encoding else None,
        )
        if person_name:
            person._calculate_face_count()
            person._set_default_cover_photo()
        existing_face_locations.append((top, right, bottom, left))
    logger.info(f"image {photo.image_hash}: {len(face_locations)} face(s) saved")


def _get_or_create_named_person(photo, person_name):
    if not person_name:
        return None
    person = api.models.person.get_or_create_person(
        name=person_name,
        owner=photo.owner,
        kind=api.models.person.Person.KIND_USER,
    )
    person.save()
    return person


def _reconcile_xmp_face_name(photo, person, person_name, location):
    top, right, bottom, left = location
    for existing_face in api.models.face.Face.objects.filter(photo=photo):
        existing_location = (
            existing_face.location_top,
            existing_face.location_right,
            existing_face.location_bottom,
            existing_face.location_left,
        )
        if not overlaps_existing_face([existing_location], top, right, bottom, left):
            continue
        if existing_face.person_id is None:
            existing_face.person = person
            existing_face.save(update_fields=["person"])
            person._calculate_face_count()
            person._set_default_cover_photo()
            logger.warning(
                f"XMP face reconciliation: assigned {person_name} "
                f"to existing face {existing_face.id}"
            )
        break


def save_detected_face(
    photo, face_image, image_path, person, cluster, location, encoding=None
):
    """Save ``face_image`` (a PIL crop) as a new ``Face`` of ``photo``."""
    top, right, bottom, left = location
    face = api.models.face.Face(
        photo=photo,
        location_top=top,
        location_right=right,
        location_bottom=bottom,
        location_left=left,
        # As Face.generate_encoding stores it.
        encoding="" if encoding is None else encoding.tobytes().hex(),
        person=person,
        cluster=cluster,
    )
    face_io = BytesIO()
    if face_image.mode in ("RGBA", "P"):
        face_image = face_image.convert("RGB")
    face_image.save(face_io, format="JPEG")
    face.image.save(image_path, ContentFile(face_io.getvalue()))
    face_io.close()
    face.save()
    return face


def _retry_face_extraction(photo, second_try):
    # When using multiple processes, then we can save at the same time, which leads to this error
    if photo.files.exists():
        # print out the location of the image only if we have a path
        logger.info(f"image {photo.main_file.path}: rescan face failed")
    if not second_try:
        extract_faces(photo, True)
    elif photo.files.exists():
        logger.error(f"image {photo.main_file.path}: rescan face failed")
    else:
        logger.error(f"image {photo}: rescan face failed")
