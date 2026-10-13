"""Relabelling faces: moving them to a person, or back to unknown.

The face dashboard's labelling (``POST /api/labelfaces``), removing photos
from a person (``POST /api/persons/<id>/remove-photos/``) and merging two
people all end the same way: the faces get their new person, the people who
lost or gained faces get a fresh count and cover, the photos' search captions
are rebuilt (a person's name is something a photo is found by) and, when the
user opted in, the face regions are written back to disk. ``relabel_faces``
is that one path.
"""

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from django.db.models import Prefetch
from django.utils import timezone

from api.metadata.photo_writer import write_photo_metadata, write_target
from api.metadata.writer import MetadataWriteError, one_exiftool_process
from api.models.face import Face, FaceQuerySet
from api.models.person import Person
from api.models.photo import Photo
from api.models.photo_search import PhotoSearch
from api.models.user import User

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RelabelResult:
    """What ``relabel_faces`` changed."""

    faces: list[Face]
    photos: list[Photo]
    # The labels are saved either way; this says which face tags did not
    # reach their files (#2294), or None.
    write_error: str | None


def relabel_faces(
    user: User, faces: FaceQuerySet, person: Person | None
) -> RelabelResult:
    """Give ``faces`` the person ``person``, or send them back to unknown.

    Only the requester's own faces are touched, whatever ``faces`` selects.
    ``person=None`` is "not this person": the cluster and classifier
    suggestions go too, so the face lands in the unknown faces.
    """
    # Everything below is pulled in up front: rebuilding the search captions
    # needs the caption, metadata and file rows of every photo. Fetching them
    # lazily costs several queries per face, which is what made tagging a
    # large selection of faces run into the gateway timeout (#897).
    loaded = list(
        faces.owned_by(user)
        .select_related(
            "photo__owner",
            "photo__main_file",
            "photo__metadata",
            "photo__caption_instance",
        )
        .prefetch_related(
            "photo__files",
            Prefetch("photo__faces", queryset=Face.objects.select_related("person")),
        )
    )

    affected_person_ids = {face.person_id for face in loaded if face.person_id}
    for face in loaded:
        face.person = person
        if person is None:
            face.cluster_person = None
            face.classification_person = None
    Face.objects.bulk_update(
        loaded, ["person", "cluster_person", "classification_person"]
    )
    if person is not None:
        affected_person_ids.add(person.id)
    _refresh_people(affected_person_ids, {face.pk for face in loaded}, person)

    photos = _photos_of(loaded)
    recreate_search_captions(photos)
    return RelabelResult(loaded, photos, write_face_tags_of(user, photos))


def _refresh_people(
    person_ids: Iterable[int], relabeled_ids: set[int], person: Person | None
) -> None:
    """Recount the people who lost or gained faces, and fix their covers.

    ``_set_default_cover_photo`` keeps an existing cover, so a person whose
    cover face was relabelled away would keep a cover they are no longer on:
    that cover is cleared first and a new default picked.
    """
    for affected in Person.objects.filter(id__in=person_ids):
        lost_cover = affected.cover_face_id in relabeled_ids
        if lost_cover and (person is None or affected.pk != person.pk):
            affected.cover_face = None
            affected.cover_photo = None
        affected._calculate_face_count()
        affected._set_default_cover_photo()


def _photos_of(faces: list[Face]) -> list[Photo]:
    """The photos of ``faces``, once each, with their cached faces up to date.

    The faces behind ``photo.faces`` were prefetched before the relabel, so
    those cached rows still carry the old person. They are different
    instances from the relabelled ones, so the new person is copied across
    before the captions are rebuilt from them.
    """
    photos: dict[uuid.UUID, Photo] = {}
    relabeled_by_pk = {face.pk: face for face in faces}
    for face in faces:
        # Selected through photo__owner, so every face has its photo.
        assert face.photo is not None
        photos[face.photo.pk] = face.photo
    for photo in photos.values():
        for cached_face in photo.faces.all():
            relabeled = relabeled_by_pk.get(cached_face.pk)
            if relabeled is not None:
                cached_face.person = relabeled.person
    return list(photos.values())


def recreate_search_captions(photos: list[Photo]) -> None:
    """Rebuild the search captions of the given photos in one batch.

    Doing a ``get_or_create()`` and a ``save()`` per photo would put the
    query count of the request back into the thousands.
    """
    search_instances = PhotoSearch.objects.in_bulk([photo.pk for photo in photos])

    to_create: list[PhotoSearch] = []
    to_update: list[PhotoSearch] = []
    for photo in photos:
        search_instance = search_instances.get(photo.pk)
        if search_instance:
            # Reuse the photo we already have instead of selecting it again.
            search_instance.photo = photo
            search_instance.updated_at = timezone.now()
            to_update.append(search_instance)
        else:
            search_instance = PhotoSearch(photo=photo)
            to_create.append(search_instance)
        search_instance.recreate_search_captions()

    # Two clients labelling faces on the same photo can race to create its
    # search row, so fall back to updating the row the other one won with.
    PhotoSearch.objects.bulk_create(
        to_create,
        update_conflicts=True,
        update_fields=["search_captions", "search_folded", "updated_at"],
        unique_fields=["photo"],
    )
    PhotoSearch.objects.bulk_update(
        to_update, ["search_captions", "search_folded", "updated_at"]
    )


def write_face_tags_of(user: User, photos: list[Photo]) -> str | None:
    """Write the face regions of ``photos`` to disk if the user opted in.

    Both switches have to be on: face tags, and syncing metadata to disk
    (``write_target`` is None when that is off, #2293). Returns why some
    writes failed, or None.
    """
    use_sidecar = write_target(user)
    if not photos or not user.save_face_tags_to_disk or use_sidecar is None:
        return None
    errors: list[str] = []
    with one_exiftool_process():
        for photo in photos:
            error = write_face_tags(photo, use_sidecar)
            if error is not None:
                errors.append(error)
    return summarize_write_errors(errors, len(photos))


def write_face_tags(photo: Photo, use_sidecar: bool) -> str | None:
    """Write the photo's face regions to disk; why that failed, or None.

    The faces are saved either way: a file LibrePhotos cannot write (a
    read-only library) does not undo the user's labelling.
    """
    try:
        write_photo_metadata(
            photo, use_sidecar=use_sidecar, metadata_types=["face_tags"]
        )
    except MetadataWriteError as error:
        logger.warning(
            "The face tags of photo %s were not written: %s", photo.image_hash, error
        )
        return str(error)
    except Exception:
        logger.exception("Failed to write face tags for photo %s", photo.image_hash)
        return "the face tags could not be written to the file"
    return None


def summarize_write_errors(errors: list[str], photos: int) -> str | None:
    """One message for the face-tag writes that failed, or None."""
    if not errors:
        return None
    if len(errors) == 1 and photos == 1:
        return errors[0]
    return f"{len(errors)} of {photos} photos were not written: {errors[0]}"
