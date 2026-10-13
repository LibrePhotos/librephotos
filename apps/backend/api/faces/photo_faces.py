"""Finding the faces in a photo and saving them as ``Face`` rows.

``api.faces.extractor`` locates faces (face service or XMP regions); this
module crops and persists them for a photo, reconciling XMP names with faces
already found. Moved out of ``Photo``; every function taking a photo takes it
as its first argument.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from io import BytesIO
from typing import TYPE_CHECKING

import PIL
from django.core.files.base import ContentFile
from django.db.utils import IntegrityError

import api.models
from api.faces import extractor
from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
from api.faces.recognition import get_face_encodings
from api.lazy_import import LazyModule
from api.runtime.features import feature_enabled

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

    from api.models import Photo

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


def overlaps_existing_face(
    existing_face_locations: Iterable[tuple[int, int, int, int]],
    top: int,
    right: int,
    bottom: int,
    left: int,
) -> bool:
    """Return True if a new face region overlaps significantly with any
    existing face (IoU >= FACE_OVERLAP_IOU_THRESHOLD).

    *existing_face_locations* is an iterable of (top, right, bottom, left) tuples.
    """
    for existing in existing_face_locations:
        if calculate_iou((top, right, bottom, left), existing) >= (
            FACE_OVERLAP_IOU_THRESHOLD
        ):
            return True
    return False


def extract_faces(photo: Photo, second_try: bool = False) -> None:
    """Detect the photo's faces and save the new ones.

    An ``IntegrityError`` (two workers saving at once) is retried exactly once
    and then swallowed; every other exception is re-raised.
    """
    if not feature_enabled("FACE_DETECTION"):
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
        logger.error("image %s: scan face failed", photo)
        raise e


def _detect_and_save_faces(
    photo: Photo, unknown_cluster: api.models.cluster.Cluster
) -> None:
    big_thumbnail_image = np.array(PIL.Image.open(photo.thumbnail.thumbnail_big.path))

    assert photo.main_file is not None
    face_locations = extractor.extract(
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
        encoding_array = encoding[0] if encoding else None
        # The face service sends each encoding as a numpy array (face_recognition.detect_faces).
        assert encoding_array is None or isinstance(encoding_array, np.ndarray)

        face_image = PIL.Image.fromarray(big_thumbnail_image[top:bottom, left:right])

        image_path = photo.image_hash + "_" + str(idx_face) + ".jpg"

        if overlaps_existing_face(existing_face_locations, top, right, bottom, left):
            if person is not None:
                _reconcile_xmp_face_name(
                    photo, person, person_name, (top, right, bottom, left)
                )
            continue

        save_detected_face(
            photo,
            DetectedFace(face_image, (top, right, bottom, left), encoding_array),
            image_path,
            person,
            unknown_cluster,
        )
        if person is not None:
            person._calculate_face_count()
            person._set_default_cover_photo()
        existing_face_locations.append((top, right, bottom, left))
    logger.info("image %s: %s face(s) saved", photo.image_hash, len(face_locations))


def _get_or_create_named_person(
    photo: Photo, person_name: str | None
) -> api.models.person.Person | None:
    if not person_name:
        return None
    person = api.models.person.get_or_create_person(
        name=person_name,
        owner=photo.owner,
        kind=api.models.person.Person.KIND_USER,
    )
    person.save()
    return person


def _reconcile_xmp_face_name(
    photo: Photo,
    person: api.models.person.Person,
    person_name: str | None,
    location: tuple[int, int, int, int],
) -> None:
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
                "XMP face reconciliation: assigned %s to existing face %s",
                person_name,
                existing_face.id,
            )
        break


@dataclass
class DetectedFace:
    """A face found in a photo: its crop, where it is, and its encoding."""

    image: PIL.Image.Image
    # (top, right, bottom, left) in the big thumbnail.
    location: tuple[int, int, int, int]
    # None until the face service encodes it (generate_face_encoding).
    encoding: npt.NDArray[float64] | None = None


def save_detected_face(
    photo: Photo,
    detected: DetectedFace,
    image_path: str,
    person: api.models.person.Person | None,
    cluster: api.models.cluster.Cluster | None,
) -> api.models.face.Face:
    """Save the crop of ``detected`` as a new ``Face`` of ``photo``."""
    top, right, bottom, left = detected.location
    encoding = detected.encoding
    face_image = detected.image
    face = api.models.face.Face(
        photo=photo,
        location_top=top,
        location_right=right,
        location_bottom=bottom,
        location_left=left,
        # As generate_face_encoding stores it.
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


def _retry_face_extraction(photo: Photo, second_try: bool) -> None:
    # When using multiple processes, then we can save at the same time, which leads to this error
    if photo.files.exists():
        # print out the location of the image only if we have a path
        assert photo.main_file is not None
        logger.info("image %s: rescan face failed", photo.main_file.path)
    if not second_try:
        extract_faces(photo, True)
    elif photo.files.exists():
        assert photo.main_file is not None
        logger.error("image %s: rescan face failed", photo.main_file.path)
    else:
        logger.error("image %s: rescan face failed", photo)


def generate_face_encoding(face: api.models.face.Face) -> None:
    """Ask the face service for the encoding of ``face``'s region and save it.

    Moved out of ``Face`` so the model makes no sidecar calls (#2336).
    """
    photo = face.photo
    assert photo is not None
    encodings = get_face_encodings(
        photo.thumbnail.thumbnail_big.path,
        [
            (
                face.location_top,
                face.location_right,
                face.location_bottom,
                face.location_left,
            )
        ],
    )
    if not encodings:
        raise ValueError(f"Face service returned no encoding for face {face.id}")
    if encodings[0] is None:
        # Another face's embedding would file this one under a stranger,
        # so the face keeps no encoding and stays out of clustering.
        raise ValueError(f"The face service detected no face in face {face.id}")
    face.encoding = encodings[0].tobytes().hex()
    face.save()
