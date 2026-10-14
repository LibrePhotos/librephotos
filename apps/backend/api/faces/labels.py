"""Relabelling faces: moving them to a person, or back to unknown.

The face dashboard's labelling (``POST /api/labelfaces``), removing photos
from a person (``POST /api/persons/<id>/remove-photos/``) and merging two
people all end the same way: the faces get their new person, the people who
lost or gained faces get a fresh count and cover, the photos' search captions
are rebuilt (a person's name is something a photo is found by) and, when the
user opted in, the face regions are written back to disk. ``relabel_faces``
is that one path.

Deleting faces (``delete_faces``) and undoing (#127) end the same way:
``restore_faces`` brings deleted faces back, and ``restore_labels`` gives
faces the people a labelling took from them (its ``previous``), suggestions
included, so a face confirmed or rejected by mistake goes back to the tab it
came from. The face regions written to disk always follow the live faces, so
a deleted face leaves the file and a restored one comes back (#1531).
"""

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import TypedDict

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from api.jobs.queue import enqueue_task
from api.metadata.photo_writer import write_photo_metadata, write_target
from api.metadata.writer import MetadataWriteError, one_exiftool_process
from api.models.face import Face, FaceQuerySet
from api.models.person import Person
from api.models.photo import Photo
from api.models.photo_search import PhotoSearch
from api.models.user import User

logger = logging.getLogger(__name__)


class FaceLabels(TypedDict):
    """A face's people, by id: labelled with, and the two suggestions."""

    id: int
    person: int | None
    cluster_person: int | None
    classification_person: int | None


@dataclass(frozen=True)
class RelabelResult:
    """What ``relabel_faces`` (or a restore) changed."""

    faces: list[Face]
    photos: list[Photo]
    # The labels are saved either way; this says which face tags did not
    # reach their files (#2294), or None.
    write_error: str | None
    # The face tags go to disk in the background instead (``queue_write``).
    write_queued: bool = False
    # Each face's people before the change, for an undo.
    previous: list[FaceLabels] = field(default_factory=list)


def labels_of(face: Face) -> FaceLabels:
    """The people of ``face`` as ``restore_labels`` takes them back."""
    return {
        "id": face.pk,
        "person": face.person_id,
        "cluster_person": face.cluster_person_id,
        "classification_person": face.classification_person_id,
    }


def _with_photo_rows(faces: FaceQuerySet) -> FaceQuerySet:
    """``faces`` with everything rebuilding their photos' search captions reads.

    Fetching them lazily costs several queries per face, which is what made
    tagging a large selection of faces run into the gateway timeout (#897).
    """
    return faces.select_related(
        "photo__owner",
        "photo__main_file",
        "photo__metadata",
        "photo__caption_instance",
    ).prefetch_related(
        "photo__files",
        Prefetch("photo__faces", queryset=Face.objects.select_related("person")),
    )


def relabel_faces(
    user: User,
    faces: FaceQuerySet,
    person: Person | None,
    *,
    queue_write: bool = False,
) -> RelabelResult:
    """Give ``faces`` the person ``person``, or send them back to unknown.

    Only the requester's own faces are touched, whatever ``faces`` selects.
    ``person=None`` is "not this person": the cluster and classifier
    suggestions go too, so the face lands in the unknown faces.

    ``queue_write`` writes the face tags in the background once the
    transaction commits, for a relabel whose size has no bound (a merge
    moves every face of a person): one ExifTool write per photo is the slow
    part, and a few thousand of them would run into the gateway timeout.
    """
    loaded = list(_with_photo_rows(faces.owned_by(user)))
    previous = [labels_of(face) for face in loaded]

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
    person_id = person.pk if person is not None else None
    _refresh_people(affected_person_ids, {face.pk: person_id for face in loaded})

    return _finish(user, loaded, queue_write=queue_write, previous=previous)


def delete_faces(user: User, face_ids: Iterable[int]) -> RelabelResult:
    """Delete the user's faces with these ids; any other id is skipped.

    A deleted face keeps its person (reads filter on ``deleted``), so
    ``restore_faces`` can give it back. The people lose the face from their
    count and cover, the photos are no longer found by their names and, when
    the user opted in, the regions on disk are written again from the faces
    left (#1531), the last one's removal clearing them. That write is queued:
    a delete has no bound on its size.
    """
    loaded = list(_with_photo_rows(Face.objects.owned_by(user).filter(pk__in=face_ids)))
    for face in loaded:
        face.deleted = True
    Face.objects.bulk_update(loaded, ["deleted"])
    _refresh_people(
        {face.person_id for face in loaded if face.person_id},
        {face.pk: None for face in loaded},
    )
    return _finish(user, loaded, queue_write=True)


def restore_faces(user: User, face_ids: Iterable[int]) -> RelabelResult:
    """Bring the user's deleted faces back, to the person each one had.

    A deleted face keeps its person (``DeleteFaces`` only sets ``deleted``),
    so restoring is the delete's follow-up the other way round: the people
    get their count and a cover back, the photos are found by their names
    again and, when the user opted in, the regions are written to disk.
    """
    loaded = list(
        _with_photo_rows(
            Face.objects.owned_by(user).filter(pk__in=face_ids, deleted=True)
        )
    )
    for face in loaded:
        face.deleted = False
    Face.objects.bulk_update(loaded, ["deleted"])
    _refresh_people({face.person_id for face in loaded if face.person_id}, {})
    return _finish(user, loaded)


def restore_labels(user: User, labels: list[FaceLabels]) -> RelabelResult:
    """Give the user's faces back the people in ``labels`` (an undo).

    ``labels`` is the ``previous`` of a labelling. A person id the user does
    not own (or that is gone) is restored as no one: an undo never puts a
    face on someone else's person.
    """
    wanted = {item["id"]: item for item in labels}
    people = _owned_people(user, wanted.values())
    loaded = list(_with_photo_rows(Face.objects.owned_by(user).filter(pk__in=wanted)))

    affected_person_ids = {face.person_id for face in loaded if face.person_id}
    for face in loaded:
        item = wanted[face.pk]
        face.person = _person(people, item["person"])
        face.cluster_person = _person(people, item["cluster_person"])
        face.classification_person = _person(people, item["classification_person"])
    Face.objects.bulk_update(
        loaded, ["person", "cluster_person", "classification_person"]
    )
    affected_person_ids |= {face.person_id for face in loaded if face.person_id}
    _refresh_people(affected_person_ids, {face.pk: face.person_id for face in loaded})
    return _finish(user, loaded)


def _finish(
    user: User,
    faces: list[Face],
    *,
    queue_write: bool = False,
    previous: list[FaceLabels] | None = None,
) -> RelabelResult:
    """Rebuild the search captions of the faces' photos and write their regions.

    ``queue_write`` writes the regions in the background once the
    transaction commits (``queue_face_tags_write``), in one job.
    """
    photos = _photos_of(faces)
    recreate_search_captions(photos)
    if queue_write:
        return RelabelResult(
            faces,
            photos,
            None,
            write_queued=queue_face_tags_write(user, photos),
            previous=previous or [],
        )
    return RelabelResult(
        faces, photos, write_face_tags_of(user, photos), previous=previous or []
    )


def _owned_people(user: User, labels: Iterable[FaceLabels]) -> dict[int, Person]:
    """The user's people that ``labels`` name, by id."""
    ids = {
        person_id
        for item in labels
        for person_id in (
            item["person"],
            item["cluster_person"],
            item["classification_person"],
        )
        if person_id is not None
    }
    return Person.objects.owned_by(user).in_bulk(ids)


def _person(people: dict[int, Person], person_id: int | None) -> Person | None:
    """The person with this id among ``people``, or None."""
    return people.get(person_id) if person_id is not None else None


def _refresh_people(
    person_ids: Iterable[int], new_person_of: dict[int, int | None]
) -> None:
    """Recount the people who lost or gained faces, and fix their covers.

    ``new_person_of`` maps each relabelled face to its new person's id.
    ``_set_default_cover_photo`` keeps an existing cover, so a person whose
    cover face was relabelled away would keep a cover they are no longer on:
    that cover is cleared first and a new default picked. A legacy person
    without an owner cannot be counted and is left as it is.
    """
    for affected in Person.objects.filter(
        id__in=person_ids, cluster_owner__isnull=False
    ):
        cover_id = affected.cover_face_id
        if cover_id in new_person_of and new_person_of[cover_id] != affected.pk:
            affected.cover_face = None
            affected.cover_photo = None
        affected._calculate_face_count()
        affected._set_default_cover_photo()


def _photos_of(faces: list[Face]) -> list[Photo]:
    """The photos of ``faces``, once each, with their cached faces up to date.

    The faces behind ``photo.faces`` were prefetched before the change, so
    those cached rows still carry the old person and the old ``deleted``.
    They are different instances from the changed ones, so both are copied
    across before the captions are rebuilt from them.
    """
    photos: dict[uuid.UUID, Photo] = {}
    changed_by_pk = {face.pk: face for face in faces}
    for face in faces:
        # Selected through photo__owner, so every face has its photo.
        assert face.photo is not None
        photos[face.photo.pk] = face.photo
    for photo in photos.values():
        for cached_face in photo.faces.all():
            changed = changed_by_pk.get(cached_face.pk)
            if changed is not None:
                cached_face.person = changed.person
                cached_face.deleted = changed.deleted
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

    Returns why some writes failed, or None.
    """
    use_sidecar = _writes_face_tags(user, photos)
    if use_sidecar is None:
        return None
    errors: list[str] = []
    with one_exiftool_process():
        for photo in photos:
            error = write_face_tags(photo, use_sidecar)
            if error is not None:
                errors.append(error)
    return summarize_write_errors(errors, len(photos))


def _writes_face_tags(user: User, photos: list[Photo]) -> bool | None:
    """The ``use_sidecar`` of a face tag write, or None when nothing is written.

    Both switches have to be on: face tags, and syncing metadata to disk
    (``write_target`` is None when that is off, #2293).
    """
    if not photos or not user.save_face_tags_to_disk:
        return None
    return write_target(user)


def queue_face_tags_write(user: User, photos: list[Photo]) -> bool:
    """Write the face regions of ``photos`` in the background if the user opted in.

    Queued when the transaction commits, so the worker reads the new labels.
    Returns whether a write was queued.
    """
    if _writes_face_tags(user, photos) is None:
        return False
    photo_ids = [photo.pk for photo in photos]
    transaction.on_commit(
        lambda: enqueue_task(write_face_tags_later, user.pk, photo_ids)
    )
    return True


def write_face_tags_later(user_id: int, photo_ids: list[uuid.UUID]) -> str | None:
    """The queued half of ``queue_face_tags_write``; why some writes failed, or None.

    Each failure is logged by ``write_face_tags``. The settings are read again:
    the user may have turned the write-back off since.
    """
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return None
    photos = list(
        Photo.objects.owned_by(user)
        .filter(pk__in=photo_ids)
        .select_related("main_file")
    )
    return write_face_tags_of(user, photos)


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
