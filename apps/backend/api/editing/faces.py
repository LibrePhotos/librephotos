"""Keeping face boxes on their faces while an edit crops or turns the picture.

A face's box is stored in pixels of the big thumbnail, which shows the edit.
Moving a box from one framing to the next and clamping it to the picture
loses what left the picture, so while an edit changes the geometry the edit
row keeps each face's box on the unedited picture (``PhotoEdit.face_boxes``,
0 to 1 across the upright source) and the shown box is always derived from
it through the current geometry. A box that is not what was last written
(a face found or drawn while the photo is edited, a box the user moved) is
taken back through the frame it is shown in, unclamped, when first seen.
Without a geometry edit the map is empty and the boxes are only rescaled.

Face regions read from the file are in the unedited frame too:
``region_frame`` maps them onto the shown picture the same way, and
``to_original_box`` maps a box back for writing it into the file.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import partial
from typing import Final

import PIL.Image

from api.editing.geometry import Box, Frame, box_to_output, box_to_source, make_frame
from api.editing.recipe import changes_geometry, recipe_from_json
from api.models import Face, Photo, PhotoEdit
from api.thumbnails import face_boxes

logger = logging.getLogger(__name__)

type Size = tuple[int, int]
# (left, top, right, bottom) in pixels of a big thumbnail.
type PixelBox = tuple[int, int, int, int]
type Entry = dict[str, list[float] | list[int]]

UNEDITED: Final = "unedited"
SHOWN: Final = "shown"
ORIGINAL: Final = "original"
SIZE: Final = "size"


def pixels(size: Size, box: Box) -> PixelBox:
    """A normalised box in pixels of a picture of ``size``, at least one pixel wide and high.

    Clamped to the picture; a box outside it is one pixel at the edge it left by.
    """
    width, height = size
    left, top, right, bottom = (
        round(min(1.0, max(0.0, box[0])) * width),
        round(min(1.0, max(0.0, box[1])) * height),
        round(min(1.0, max(0.0, box[2])) * width),
        round(min(1.0, max(0.0, box[3])) * height),
    )
    if right <= left:
        left = min(left, width - 1)
        right = left + 1
    if bottom <= top:
        top = min(top, height - 1)
        bottom = top + 1
    return left, top, right, bottom


def geometry_frame(edit: PhotoEdit | None) -> Frame | None:
    """The frame of ``edit``'s picture on its source; None when it shows the unedited framing."""
    if (
        edit is None
        or not edit.shown
        or not edit.source_width
        or not edit.source_height
    ):
        return None
    recipe = recipe_from_json(edit.settings)
    if not changes_geometry(recipe):
        return None
    return make_frame(recipe.geometry, edit.source_width, edit.source_height)


@dataclass(frozen=True)
class Placement:
    """How the big thumbnail shows the picture: its framing and its size."""

    # None: the unedited picture.
    frame: Frame | None
    size: Size


def _face_box(face: Face) -> PixelBox:
    return (
        face.location_left,
        face.location_top,
        face.location_right,
        face.location_bottom,
    )


def _numbers(value: object, kind: type[float] | type[int]) -> list[float] | None:
    if not isinstance(value, list) or len(value) not in (2, 4):
        return None
    if not all(isinstance(n, int | float) and not isinstance(n, bool) for n in value):
        return None
    if kind is int and not all(isinstance(n, int) for n in value):
        return None
    return [float(n) for n in value]


def _tracked(entry: object, shown: PixelBox) -> Entry | None:
    """The stored entry of a face whose box is still the one last written; else None."""
    if not isinstance(entry, dict):
        return None
    unedited = _numbers(entry.get(UNEDITED), float)
    last = _numbers(entry.get(SHOWN), int)
    if unedited is None or last is None or len(unedited) != 4:
        return None
    if tuple(int(n) for n in last) != shown:
        # Moved or resized by the user since: taken again from where it is.
        return None
    return {key: value for key, value in entry.items() if isinstance(value, list)}


def _first_seen(shown: PixelBox, before: Placement) -> Entry:
    """The entry of a face not tracked yet, from its box on ``before``'s picture."""
    width, height = before.size
    box = (shown[0] / width, shown[1] / height, shown[2] / width, shown[3] / height)
    if before.frame is None:
        return {
            UNEDITED: list(box),
            ORIGINAL: list(shown),
            SIZE: [width, height],
        }
    return {UNEDITED: list(box_to_source(before.frame, box))}


def _shown_box(entry: Entry, after: Placement) -> PixelBox:
    left, top, right, bottom = (float(n) for n in entry[UNEDITED])
    unedited = (left, top, right, bottom)
    if after.frame is not None:
        return pixels(after.size, box_to_output(after.frame, unedited))
    original, size = entry.get(ORIGINAL), entry.get(SIZE)
    if (
        original is not None
        and size is not None
        and (int(size[0]), int(size[1])) == after.size
    ):
        # Never moved: the box the face had before the edit, exactly.
        a, b, c, d = (int(n) for n in original)
        return a, b, c, d
    return pixels(after.size, unedited)


def place_face_boxes(
    photo: Photo, edit: PhotoEdit | None, before: Placement, after: Placement
) -> None:
    """Move ``photo``'s face boxes from the big thumbnail of ``before`` to the one of ``after``.

    Without a geometry edit on either side the boxes are only rescaled
    (``api.thumbnails.face_boxes``). Otherwise each box is derived from its
    box on the unedited picture, which ``edit.face_boxes`` keeps while
    ``after`` has a geometry edit; the map is emptied when it has none.
    Entries of faces that are gone are dropped.
    """
    stored: Mapping[str, object] = edit.face_boxes if edit is not None else {}
    if before.frame is None and after.frame is None:
        face_boxes.rescale_face_boxes(photo, before.size, after.size)
        if stored and edit is not None:
            _store(edit, {})
        return
    kept: dict[str, Entry] = {}
    changed: list[Face] = []
    for face in Face.objects.filter(photo=photo):
        shown = _face_box(face)
        entry = _tracked(stored.get(str(face.pk)), shown) or _first_seen(shown, before)
        new = _shown_box(entry, after)
        if after.frame is not None:
            kept[str(face.pk)] = {**entry, SHOWN: list(new)}
        if new != shown:
            face.location_left, face.location_top = new[0], new[1]
            face.location_right, face.location_bottom = new[2], new[3]
            # A new box in a new thumbnail: the face model may find a face in it.
            face.unmatched_by = ""
            changed.append(face)
    Face.objects.bulk_update(changed, [*face_boxes.FACE_BOX_FIELDS, "unmatched_by"])
    if edit is not None and (kept or stored):
        _store(edit, kept)


def _store(edit: PhotoEdit, entries: dict[str, Entry]) -> None:
    edit.face_boxes = entries
    PhotoEdit.objects.filter(pk=edit.pk).update(face_boxes=entries)


def place_after_regeneration(
    photo: Photo, size_before: Size | None, size_after: Size | None
) -> None:
    """Keep the face boxes on their faces when the thumbnails were made again.

    The size may change (BIG_THUMBNAIL_HEIGHT, the rendition replacing a
    smaller first render); the framing stays the edit's.
    """
    if size_before is None or size_after is None:
        return
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    frame = geometry_frame(edit)
    place_face_boxes(
        photo, edit, Placement(frame, size_before), Placement(frame, size_after)
    )


# --- Face regions of the file -----------------------------------------------------


@dataclass(frozen=True)
class RegionFrame:
    """The unedited picture, where a file's face regions are, and the shown one.

    Boxes are (top, right, bottom, left) in pixels, as face locations are:
    ``unedited_size`` is the upright source's size, ``shown_size`` the big
    thumbnail's.
    """

    frame: Frame
    unedited_size: Size
    shown_size: Size

    def to_shown(self, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        """A box on the unedited picture onto the big thumbnail, clamped to it."""
        top, right, bottom, left = box
        width, height = self.unedited_size
        unedited = (left / width, top / height, right / width, bottom / height)
        new_left, new_top, new_right, new_bottom = pixels(
            self.shown_size, box_to_output(self.frame, unedited)
        )
        return new_top, new_right, new_bottom, new_left

    def to_unedited(self, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        """A box on the big thumbnail onto the unedited picture, not clamped."""
        top, right, bottom, left = box
        width, height = self.shown_size
        shown = (left / width, top / height, right / width, bottom / height)
        u_left, u_top, u_right, u_bottom = box_to_source(self.frame, shown)
        full_width, full_height = self.unedited_size
        return (
            round(u_top * full_height),
            round(u_right * full_width),
            round(u_bottom * full_height),
            round(u_left * full_width),
        )


def region_frame(photo: Photo, big_thumbnail_path: str) -> RegionFrame | None:
    """How ``photo``'s file regions sit on its big thumbnail; None without a geometry edit.

    The thumbnail is only opened (for its size) when the edit crops or turns.
    """
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    frame = geometry_frame(edit)
    if frame is None:
        return None
    with PIL.Image.open(big_thumbnail_path) as thumbnail:
        shown_size = thumbnail.size
    return RegionFrame(frame, (frame.source_width, frame.source_height), shown_size)


# --- Writing face regions back into the file ----------------------------------------


def _unmoved(face: Face, box: Box) -> Box:
    return box


def _to_original(
    frame: Frame, stored: Mapping[str, object], face: Face, box: Box
) -> Box:
    entry = _tracked(stored.get(str(face.pk)), _face_box(face))
    if entry is not None:
        left, top, right, bottom = (
            min(1.0, max(0.0, float(n))) for n in entry[UNEDITED]
        )
        return left, top, right, bottom
    left, top, right, bottom = box_to_source(frame, box)
    return (
        min(1.0, max(0.0, left)),
        min(1.0, max(0.0, top)),
        min(1.0, max(0.0, right)),
        min(1.0, max(0.0, bottom)),
    )


def to_original_box(photo: Photo) -> Callable[[Face, Box], Box]:
    """What moves a face's box (0 to 1 on ``photo``'s thumbnails) onto its original.

    For what goes back into the file, such as face regions: an edit that
    crops or turns the picture frames its thumbnails differently from the
    file. The original is the upright picture, ``local_orientation`` applied.
    A face whose box on the unedited picture is kept gets that box, so a
    face partly cropped away keeps its whole region.
    """
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    frame = geometry_frame(edit)
    if frame is None or edit is None:
        return _unmoved
    return partial(_to_original, frame, dict(edit.face_boxes))
