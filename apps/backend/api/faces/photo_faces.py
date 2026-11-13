"""Finding the faces in a photo and saving them as ``Face`` rows.

``api.faces.extractor`` locates faces (XMP regions and the face service);
this module crops and persists them for a photo, reconciling XMP names and
detected encodings with faces already found. Moved out of ``Photo``; every function taking a photo takes it
as its first argument.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass
from http import HTTPStatus
from io import BytesIO
from typing import TYPE_CHECKING

import PIL.Image
import requests
from django.core.files.base import ContentFile
from django.db.models import Q, QuerySet
from django.db.utils import IntegrityError
from django.utils import timezone

import api.models
from api.editing.faces import region_frame
from api.faces import extractor, video_faces
from api.faces.geometry import (
    FACE_OVERLAP_IOU_THRESHOLD,
    box_in_picture,
    calculate_iou,
    min_face_height,
)
from api.faces.labels import recreate_search_captions
from api.faces.recognition import face_model_name, get_face_encodings
from api.lazy_import import LazyModule
from api.metadata.reader import MetadataReadError, sidecar_files_for_photo
from api.runtime.features import feature_enabled

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

    from api.models import Photo, User

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
    if not _big_thumbnail_on_disk(photo):
        logger.warning(
            "image %s: no big thumbnail to find faces in, skipped", photo.image_hash
        )
        return

    unknown_cluster: api.models.cluster.Cluster = (
        api.models.cluster.get_unknown_cluster(user=photo.owner)
    )
    try:
        _detect_and_save_faces(photo, unknown_cluster)
    except IntegrityError:
        _retry_face_extraction(photo, second_try)
        return
    except Exception as e:
        logger.error("image %s: scan face failed", photo)
        if _fails_for_good(e):
            _mark_faces_scanned(photo)
        raise e
    _mark_faces_scanned(photo)


def _big_thumbnail_on_disk(photo: Photo) -> bool:
    """Whether the picture faces are found in is there.

    Not when making it failed (the row names no file) or its file is gone.
    The photo stays unscanned: the scan that makes its thumbnail puts it on
    the next incremental Scan Faces.
    """
    thumbnail: api.models.thumbnail.Thumbnail | None = getattr(photo, "thumbnail", None)
    if thumbnail is None or not thumbnail.thumbnail_big:
        return False
    return os.path.exists(thumbnail.thumbnail_big.path)


def _fails_for_good(error: Exception) -> bool:
    """Whether detecting faces again would fail the same way (#2199).

    The big thumbnail is not a picture, or the face service answered 422:
    it could not read the picture. A connection error, a timeout or any
    other status (a sidecar restarting or out of memory answers 500) may
    pass next time, so the photo stays unscanned and the next incremental
    Scan Faces tries it again.
    """
    if isinstance(
        error, (PIL.UnidentifiedImageError, PIL.Image.DecompressionBombError)
    ):
        return True
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return error.response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    return False


def _mark_faces_scanned(photo: Photo) -> None:
    """Record that face detection ran on the photo's picture as it is now."""
    photo.faces_scanned_at = timezone.now()
    api.models.Photo.objects.filter(pk=photo.pk).update(
        faces_scanned_at=photo.faces_scanned_at
    )


def _detect_and_save_faces(
    photo: Photo, unknown_cluster: api.models.cluster.Cluster
) -> None:
    """Save the photo's face regions from XMP, then the faces the service finds.

    Both, always (#2260): a desktop photo manager stores regions only for
    the faces someone tagged there. Regions go first, since they carry the
    names. They are read with the detections, which can confirm a region
    whose picture was turned since it was written (#2887); when the face
    service fails they are saved as written before the error is re-raised
    (the photo is scanned again), so they are not lost. A detection
    overlapping a saved face is that face: it is not saved again, and gives
    the face its encoding if it has none.
    """
    thumbnail_path = photo.thumbnail.thumbnail_big.path
    scan = _FaceScan(
        photo,
        np.array(PIL.Image.open(thumbnail_path)),
        unknown_cluster,
        # Fetched once to avoid repeated DB queries; grows with every saved face.
        list(
            _first_frame_faces(photo).values_list(
                "location_top", "location_right", "location_bottom", "location_left"
            )
        ),
    )

    try:
        detected = extractor.extract_from_face_service(thumbnail_path)
    except Exception:
        _save_new_faces(scan, _face_regions(photo, thumbnail_path, None) or [])
        raise
    _save_new_faces(scan, _face_regions(photo, thumbnail_path, detected) or [])
    _save_new_faces(scan, big_enough_faces(scan, detected))
    if photo.video and feature_enabled("FACE_DETECTION_IN_VIDEOS"):
        _save_frame_faces(scan)
    logger.info("image %s: %s face(s) saved", photo.image_hash, scan.saved)


def _face_regions(
    photo: Photo,
    thumbnail_path: str,
    detected: list[extractor.FaceLocation] | None,
) -> list[extractor.FaceLocation] | None:
    """The photo's face regions from XMP, checked against ``detected``.

    Optional: when the exif service cannot read the file, the photo gets the
    detected faces alone, and a Rescan Faces reads its regions again.
    """
    try:
        return read_face_regions(photo, thumbnail_path, detected)
    except MetadataReadError:
        # The error names the file's path, which is only logged at DEBUG.
        logger.warning(
            "image %s: face regions not read, detected faces only", photo.image_hash
        )
        logger.debug("image %s: face regions not read", photo.image_hash, exc_info=True)
        return None


def read_face_regions(
    photo: Photo,
    thumbnail_path: str,
    detected: list[extractor.FaceLocation] | None,
) -> list[extractor.FaceLocation] | None:
    """The photo's face regions from XMP on its big thumbnail, checked against ``detected``.

    Through the photo's edit when it crops or turns the picture
    (``api.editing.faces.region_frame``): the regions are of the unedited one.
    """
    assert photo.main_file is not None
    sidecar_files = sidecar_files_for_photo(photo)
    frame = region_frame(photo, thumbnail_path)
    if frame is not None:
        return extractor.extract_through_edit(
            frame,
            photo.main_file.path,
            sidecar_files,
            photo.local_orientation,
            detected,
        )
    return extractor.extract_from_exif(
        photo.main_file.path,
        thumbnail_path,
        sidecar_files,
        local_orientation=photo.local_orientation,
        detected_faces=detected,
    )


def _first_frame_faces(photo: Photo) -> QuerySet[api.models.face.Face]:
    """The faces whose box is in the big thumbnail: all of a photo's.

    A video's faces from its later frames (``Face.video_time``) are in the
    pixels of another frame: overlapping one of them says nothing.
    """
    return api.models.face.Face.objects.filter(photo=photo, video_time__isnull=True)


def _save_frame_faces(scan: _FaceScan) -> None:
    """Save the people of a video's later frames that it has no face of (#2761).

    A person is matched by encoding against every face the video has, the
    deleted ones too: a face the user deleted is not found again.
    """
    photo = scan.photo
    known = [
        face.get_encoding_array()
        for face in api.models.face.Face.objects.filter(photo=photo).exclude(
            encoding=""
        )
    ]
    for face in video_faces.frame_faces(photo, known):
        save_detected_face(
            photo,
            DetectedFace(face.image, face.location, face.encoding, face.video_time),
            photo.image_hash + "_" + str(scan.saved) + ".jpg",
            None,
            scan.unknown_cluster,
        )
        scan.saved += 1


def big_enough_faces(
    scan: _FaceScan, face_locations: list[extractor.FaceLocation]
) -> list[extractor.FaceLocation]:
    """The detected faces at least the owner's ``min_face_size`` tall (#2749).

    The size is a share of the big thumbnail's shorter side, so it means the
    same for portrait and landscape photos; 0 keeps every face. Only the face
    service's detections are filtered: face regions from the file and faces
    drawn by hand are the user's own and always kept.
    """
    min_height = min_face_height(
        scan.big_thumbnail_image.shape, scan.photo.owner.min_face_size
    )
    kept = [
        location
        for location in face_locations
        if location[2] - location[0] >= min_height
    ]
    if len(kept) < len(face_locations):
        logger.debug(
            "image %s: %s face(s) below the minimum face size skipped",
            scan.photo.image_hash,
            len(face_locations) - len(kept),
        )
    return kept


@dataclass
class _FaceScan:
    """One photo's face detection: its big thumbnail and the faces it has."""

    photo: Photo
    big_thumbnail_image: npt.NDArray[np.uint8]
    unknown_cluster: api.models.cluster.Cluster
    # (top, right, bottom, left) of every face of the photo.
    face_locations: list[tuple[int, int, int, int]]
    # Faces saved by this scan; also numbers the crops' file names.
    saved: int = 0
    # Whether this scan gave a face a person, from a face region's name.
    named: bool = False


def _save_new_faces(
    scan: _FaceScan, face_locations: list[extractor.FaceLocation]
) -> None:
    """Save each face that overlaps no face of the photo yet.

    A box going past the edge of the big thumbnail is cut to it (#2922), and
    one wholly outside it is skipped.
    """
    photo = scan.photo
    for face_location in face_locations:
        # Faces from the face service carry their encoding; XMP regions
        # get one from an overlapping detection or generate_face_embeddings.
        top, right, bottom, left, person_name, *encoding = face_location
        height, width = scan.big_thumbnail_image.shape[:2]
        location = box_in_picture((top, right, bottom, left), width, height)
        if location is None:
            logger.warning(
                "image %s: face box %s is outside the big thumbnail, skipped",
                photo.image_hash,
                (top, right, bottom, left),
            )
            continue
        top, right, bottom, left = location
        person = _get_or_create_named_person(photo, person_name)
        encoding_array = encoding[0] if encoding else None
        # The face service sends each encoding as a numpy array (face_recognition.detect_faces).
        assert encoding_array is None or isinstance(encoding_array, np.ndarray)

        if overlaps_existing_face(scan.face_locations, *location):
            if person is not None and _reconcile_xmp_face_name(photo, person, location):
                scan.named = True
            if encoding_array is not None:
                _give_encoding_to_overlapping_face(photo, location, encoding_array)
            continue

        face_image = PIL.Image.fromarray(
            scan.big_thumbnail_image[top:bottom, left:right]
        )
        save_detected_face(
            photo,
            DetectedFace(face_image, location, encoding_array),
            photo.image_hash + "_" + str(scan.saved) + ".jpg",
            person,
            scan.unknown_cluster,
        )
        scan.saved += 1
        if person is not None:
            person._calculate_face_count()
            person._set_default_cover_photo()
            scan.named = True
        scan.face_locations.append(location)
    if scan.named:
        _index_person_names(photo)


def _index_person_names(photo: Photo) -> None:
    """Rebuild the photo's search captions: a person's name finds the photo.

    As ``relabel_faces`` does for a labelling. Nothing is written back to the
    file, where the names came from, and the follow-ups' clustering is not
    held back (``record_face_label``): no user labelled anything.
    """
    recreate_search_captions([api.models.Photo.objects.get(pk=photo.pk)])


def _give_encoding_to_overlapping_face(
    photo: Photo,
    location: tuple[int, int, int, int],
    encoding: npt.NDArray[float64],
) -> None:
    """Store a detection's encoding on the face it overlaps most, if it has none.

    That face came from an XMP region, which has no encoding of its own.
    """
    best_face = None
    best_iou = FACE_OVERLAP_IOU_THRESHOLD
    for face in _first_frame_faces(photo):
        iou = calculate_iou(
            location,
            (
                face.location_top,
                face.location_right,
                face.location_bottom,
                face.location_left,
            ),
        )
        if iou >= best_iou:
            best_face, best_iou = face, iou
    if best_face is None or best_face.encoding:
        return
    # As save_detected_face and generate_face_encoding store it.
    best_face.encoding = encoding.tobytes().hex()
    best_face.unmatched_by = ""
    best_face.save(update_fields=["encoding", "unmatched_by"])


def _get_or_create_named_person(
    photo: Photo, person_name: str | None
) -> api.models.person.Person | None:
    if not person_name:
        return None
    return api.models.person.get_or_create_person(
        name=person_name,
        owner=photo.owner,
        kind=api.models.person.Person.KIND_USER,
    )


def _reconcile_xmp_face_name(
    photo: Photo,
    person: api.models.person.Person,
    location: tuple[int, int, int, int],
) -> bool:
    """Give a face region's name to the face found where it is; whether it did.

    Only to a face that is not deleted and has no person, and never a person
    the user said the face is not (#2747): without face tags written back,
    the file keeps the region after a "Not Anna", and each rescan would label
    the face again. One conditional update, so a label set meanwhile stays.
    """
    top, right, bottom, left = location
    for existing_face in _first_frame_faces(photo).filter(deleted=False):
        existing_location = (
            existing_face.location_top,
            existing_face.location_right,
            existing_face.location_bottom,
            existing_face.location_left,
        )
        if not overlaps_existing_face([existing_location], top, right, bottom, left):
            continue
        named = (
            api.models.face.Face.objects.filter(
                pk=existing_face.pk, person__isnull=True
            )
            .exclude(rejected_persons=person)
            .update(person=person)
        )
        if not named:
            return False
        person._calculate_face_count()
        person._set_default_cover_photo()
        logger.info(
            "image %s: face region name given to face %s",
            photo.image_hash,
            existing_face.id,
        )
        return True
    return False


@dataclass
class DetectedFace:
    """A face found in a photo: its crop, where it is, and its encoding."""

    image: PIL.Image.Image
    # (top, right, bottom, left) in the big thumbnail.
    location: tuple[int, int, int, int]
    # None until the face service encodes it (generate_face_encoding).
    encoding: npt.NDArray[float64] | None = None
    # The second of the video frame it was found in (#2761); None for the
    # big thumbnail, where ``location`` is then.
    video_time: float | None = None


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
        video_time=detected.video_time,
    )
    face.image.save(image_path, _jpeg(face_image))
    face.save()
    return face


def _jpeg(image: PIL.Image.Image) -> ContentFile[bytes]:
    """A face crop as the JPEG file stored for it."""
    if image.mode in ("RGBA", "P"):
        image = image.convert("RGB")
    with BytesIO() as face_io:
        image.save(face_io, format="JPEG")
        return ContentFile(face_io.getvalue())


def restore_missing_crops(user: User) -> int:
    """Cut the crop of every face of ``user`` that has none again (#2642).

    ``Face.image`` is empty for legacy rows and for a crop that failed to
    save. The face's box is in big-thumbnail pixels (as ``_save_new_faces``
    and ``AddFace`` cut it), so its crop comes from the big thumbnail again,
    without the face service. A face that cannot be cut (no thumbnail, an
    unreadable one, a box outside it) keeps no crop and is tried again on the
    next run. Deleted faces are left alone, and so are faces from a video's
    later frames (#2761): their frame is gone, and the scan saved their crop.
    Returns how many crops were saved.
    """
    faces = (
        api.models.face.Face.objects.owned_by(user)
        .filter(
            Q(image="") | Q(image__isnull=True), deleted=False, video_time__isnull=True
        )
        .select_related("photo__thumbnail")
    )
    restored = 0
    for face in faces:
        if cut_crop(face):
            restored += 1
    if restored:
        logger.info("restored the crop of %d face(s) of %s", restored, user)
    return restored


def cut_crop(face: api.models.face.Face) -> bool:
    """Cut and save the crop of one face from its box; whether it worked.

    The file of a crop the face had before stays on disk.
    """
    photo = face.photo
    thumbnail = getattr(photo, "thumbnail", None) if photo else None
    if photo is None or thumbnail is None or not thumbnail.thumbnail_big:
        logger.warning("face %s: no big thumbnail to cut its crop from", face.id)
        return False
    try:
        with PIL.Image.open(thumbnail.thumbnail_big.path) as big_thumbnail:
            box = box_in_picture(
                (
                    face.location_top,
                    face.location_right,
                    face.location_bottom,
                    face.location_left,
                ),
                big_thumbnail.width,
                big_thumbnail.height,
            )
            if box is None:
                logger.warning("face %s: its box is outside the big thumbnail", face.id)
                return False
            top, right, bottom, left = box
            crop = big_thumbnail.crop((left, top, right, bottom))
            content = _jpeg(crop)
    except OSError, PIL.Image.DecompressionBombError:
        logger.warning("face %s: cannot cut its crop", face.id, exc_info=True)
        return False
    face.image.save(f"{photo.image_hash}_{face.id}.jpg", content, save=False)
    face.save(update_fields=["image"])
    return True


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


class NoFaceInRegionError(ValueError):
    """The face model found no face in a face's box; the face was marked so."""


def generate_face_encoding(face: api.models.face.Face) -> None:
    """Ask the face service for the encoding of ``face``'s region and save it.

    Moved out of ``Face`` so the model makes no sidecar calls (#2336). A
    face from a video's later frames is left as it is: its box is not in the
    big thumbnail, and the scan saved its encoding with it (#2761).

    When the face model finds no face in the box, the face keeps no encoding
    and records the model in ``unmatched_by``, so Generate Face Embeddings
    does not ask that model again (#2888), and ``NoFaceInRegionError`` is raised.
    """
    if face.video_time is not None:
        logger.debug("face %s: from a video frame, not encoded again", face.id)
        return
    photo = face.photo
    assert photo is not None
    face_model = face_model_name()
    box = (
        face.location_top,
        face.location_right,
        face.location_bottom,
        face.location_left,
    )
    encodings = get_face_encodings(photo.thumbnail.thumbnail_big.path, [box])
    if not encodings:
        raise ValueError(f"Face service returned no encoding for face {face.id}")
    if encodings[0] is None:
        # Another face's embedding would file this one under a stranger,
        # so the face keeps no encoding and stays out of clustering.
        if _store_encoding_result(face, box, unmatched_by=face_model):
            raise NoFaceInRegionError(
                f"The face service detected no face in face {face.id}"
            )
        return
    _store_encoding_result(
        face, box, encoding=encodings[0].tobytes().hex(), unmatched_by=""
    )


def _store_encoding_result(
    face: api.models.face.Face, box: tuple[int, int, int, int], **fields: str
) -> bool:
    """Write what the face model said about ``box`` onto ``face``; whether it did.

    The face was loaded when Generate Face Embeddings started, so only these
    fields are written, and only while the row still has that box: a full
    save would undo a label or delete made since, and insert again a face
    deleted since (Deduplicate Faces, a turned region, a replaced file).
    """
    top, right, bottom, left = box
    stored = api.models.face.Face.objects.filter(
        pk=face.pk,
        location_top=top,
        location_right=right,
        location_bottom=bottom,
        location_left=left,
    ).update(**fields)
    if not stored:
        logger.info("face %s: deleted or moved while encoding, left alone", face.id)
        return False
    for name, value in fields.items():
        setattr(face, name, value)
    return True
