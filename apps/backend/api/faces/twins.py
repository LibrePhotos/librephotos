"""The same face in the other frames of a burst, a bracket or a duplicate group (#2754).

Burst and bracket frames and duplicates are separate photos, so one face
shows up once per frame on the faces dashboard. A face's *twins* are the
unlabelled faces in the other photos of its burst or bracket stack (not a
manual one: the user grouped those for any reason) or of its duplicate group
(not one the user dismissed as "not duplicates"), at nearly the same place in
the picture and with a near-identical encoding. Labelling a face labels its
twins too.

The rule is strict on purpose, since the twins are labelled without being
shown: the same group, boxes that overlap (``FACE_OVERLAP_IOU_THRESHOLD``)
once each is scaled to its photo's big thumbnail, and unit-length encodings
at most ``TWIN_MAX_DISTANCE`` apart. Each other photo gives at most one twin,
the closest.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.conf import settings

from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, Box, calculate_iou
from api.lazy_import import LazyModule
from api.models.duplicate import Duplicate
from api.models.face import Face
from api.models.person import Person
from api.models.photo import Photo
from api.models.photo_stack import PhotoStack
from api.models.user import User

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
    from numpy import float64
else:
    np = LazyModule("numpy")

# The largest distance between two unit-length encodings of the same face in
# two frames. The same person in two different photos is often 0.8 to 1.1
# apart; the same face a burst frame later is well under 0.5. 0.6 (a cosine
# similarity of 0.82) leaves room for a blink or a turn of the head.
TWIN_MAX_DISTANCE = 0.6

# The stacks whose photos are frames of one moment.
TWIN_STACK_TYPES = (
    PhotoStack.StackType.BURST_SEQUENCE,
    PhotoStack.StackType.EXPOSURE_BRACKET,
)


@dataclass(frozen=True)
class _Seen:
    """A face as the matching compares it: where it is and what it encodes."""

    face: Face
    photo_id: uuid.UUID
    # (top, right, bottom, left) as fractions of the big thumbnail's height.
    box: Box
    encoding: npt.NDArray[float64]


def twin_faces(
    user: User, faces: Iterable[Face], person: Person | None = None
) -> list[Face]:
    """The twins of ``faces``: the same face in the other frames of their groups.

    Only ``user``'s own faces, stacks and duplicate groups are used, so twins
    never cross users. A twin is unlabelled, not deleted, on a photo the
    lists show, has an encoding and is none of ``faces``. With ``person``, a
    face the user said is not that person (#2747) is not a twin.
    """
    sources = [face for face in faces if face.encoding and face.photo_id]
    photo_ids = {face.photo_id for face in sources if face.photo_id is not None}
    others_of = _photos_sharing_a_group(user, photo_ids)
    if not others_of:
        return []
    candidates = _candidate_faces(
        user,
        set().union(*others_of.values()),
        {face.pk for face in sources},
        person,
    )
    return _match(
        [_seen(face) for face in sources],
        [_seen(face) for face in candidates],
        others_of,
    )


def _photos_sharing_a_group(
    user: User, photo_ids: set[uuid.UUID]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Per photo in ``photo_ids``, the other photos of its twin stacks and duplicate groups."""
    members = _stack_members(user, photo_ids) + _duplicate_members(user, photo_ids)
    by_group: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for photo_id, group_id in members:
        by_group[group_id].add(photo_id)
    others_of: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for photos in by_group.values():
        for photo_id in photos & photo_ids:
            others_of[photo_id] |= photos - {photo_id}
    return {photo_id: others for photo_id, others in others_of.items() if others}


def _stack_members(
    user: User, photo_ids: set[uuid.UUID]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """(photo, stack) for every photo of the user's burst and bracket stacks with one of ``photo_ids``."""
    stacks = PhotoStack.objects.owned_by(user).filter(
        stack_type__in=TWIN_STACK_TYPES, photos__in=photo_ids
    )
    return list(
        Photo.stacks.through.objects.filter(photostack__in=stacks).values_list(
            "photo_id", "photostack_id"
        )
    )


def _duplicate_members(
    user: User, photo_ids: set[uuid.UUID]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """(photo, group) for every photo of the user's duplicate groups with one of ``photo_ids``.

    A group the user dismissed ("not duplicates") does not count.
    """
    groups = (
        Duplicate.objects.owned_by(user)
        .filter(photos__in=photo_ids)
        .exclude(review_status=Duplicate.ReviewStatus.DISMISSED)
    )
    return list(
        Photo.duplicates.through.objects.filter(duplicate__in=groups).values_list(
            "photo_id", "duplicate_id"
        )
    )


def _candidate_faces(
    user: User,
    photo_ids: set[uuid.UUID],
    source_ids: set[int],
    person: Person | None,
) -> list[Face]:
    """The faces on ``photo_ids`` that may be twins."""
    candidates = (
        Face.objects.owned_by(user)
        .on_shown_photos()
        .filter(photo_id__in=photo_ids, person=None, deleted=False)
        .exclude(encoding="")
        .exclude(pk__in=source_ids)
    )
    if person is not None:
        candidates = candidates.exclude(rejected_persons=person)
    return list(candidates.select_related("photo__metadata"))


def _seen(face: Face) -> _Seen:
    # Sources and candidates are faces of photos, by the way they are picked.
    assert face.photo_id is not None
    height = _thumbnail_height(face.photo)
    box: Box = (
        face.location_top / height,
        face.location_right / height,
        face.location_bottom / height,
        face.location_left / height,
    )
    return _Seen(face, face.photo_id, box, face.get_encoding_array())


def _thumbnail_height(photo: Photo | None) -> int:
    """The height of the big thumbnail the photo's face boxes are measured on.

    It is ``BIG_THUMBNAIL_HEIGHT``, or the photo's own height when that is
    smaller (thumbnails are never enlarged).
    """
    height: int = settings.BIG_THUMBNAIL_HEIGHT
    metadata = getattr(photo, "metadata", None)
    shown_height = getattr(metadata, "height", None)
    if shown_height:
        return min(height, shown_height)
    return height


def _match(
    sources: list[_Seen],
    candidates: list[_Seen],
    others_of: dict[uuid.UUID, set[uuid.UUID]],
) -> list[Face]:
    """The closest twin of each source on each of its other photos.

    A face that is the twin of two sources goes to the closer one, so it is
    returned once.
    """
    by_photo: dict[uuid.UUID, list[_Seen]] = defaultdict(list)
    for candidate in candidates:
        by_photo[candidate.photo_id].append(candidate)
    best: dict[int, tuple[float, Face]] = {}
    for source in sources:
        for photo_id in others_of.get(source.photo_id, ()):
            twin = _closest_twin(source, by_photo.get(photo_id, []))
            if twin is None:
                continue
            distance, face = twin
            if face.pk not in best or distance < best[face.pk][0]:
                best[face.pk] = (distance, face)
    return [face for _, face in sorted(best.values(), key=lambda item: item[1].pk)]


def _closest_twin(source: _Seen, candidates: list[_Seen]) -> tuple[float, Face] | None:
    """The candidate closest to ``source`` that is its twin, with its distance."""
    twins = [
        (float(np.linalg.norm(source.encoding - candidate.encoding)), candidate.face)
        for candidate in candidates
        if candidate.encoding.shape == source.encoding.shape
        and calculate_iou(source.box, candidate.box) >= FACE_OVERLAP_IOU_THRESHOLD
    ]
    twins = [twin for twin in twins if twin[0] <= TWIN_MAX_DISTANCE]
    return min(twins, key=lambda twin: twin[0], default=None)
