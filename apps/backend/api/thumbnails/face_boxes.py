"""Keep a photo's face boxes on its faces when its big thumbnail changes size.

A Face stores its box in pixels of the big thumbnail it was found on, and the
lightbox draws it over that thumbnail. Since BIG_THUMBNAIL_HEIGHT is a
setting, a photo whose thumbnails are rendered again (a rotation, a file whose
content changed) may come back larger or smaller than the thumbnail its faces
were found on, and the boxes are scaled with it.

A rotation also changes the thumbnail's shape. Turning the boxes with the
picture is a separate matter, so a change of shape leaves them alone, as
before.
"""

from api.models import Face, Photo

Size = tuple[int, int]

# How far apart two aspect ratios may be and still be the same picture: the
# rounding of a resize, not a different crop.
SHAPE_TOLERANCE = 0.02

FACE_BOX_FIELDS = ["location_top", "location_right", "location_bottom", "location_left"]


def _same_shape(before: Size, after: Size) -> bool:
    ratio_before = before[0] / before[1]
    ratio_after = after[0] / after[1]
    return abs(ratio_before - ratio_after) <= SHAPE_TOLERANCE * ratio_after


def rescale_face_boxes(photo: Photo, before: Size | None, after: Size | None) -> int:
    """Scale ``photo``'s face boxes from a big thumbnail of ``before`` to one of ``after``.

    Returns how many faces were changed: none when either size is unknown, the
    size did not change, or the shape did.
    """
    if before is None or after is None or before == after:
        return 0
    if not _same_shape(before, after):
        return 0
    scale = after[1] / before[1]
    faces = list(Face.objects.filter(photo=photo))
    for face in faces:
        for field in FACE_BOX_FIELDS:
            setattr(face, field, round(getattr(face, field) * scale))
    Face.objects.bulk_update(faces, FACE_BOX_FIELDS)
    return len(faces)
