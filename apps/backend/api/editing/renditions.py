"""Saving, rotating and removing a photo's edit, and rendering it.

A save stores the recipe (``PhotoEdit.version`` up by one) and, when the
recipe changes something, renders it twice:

1. in the request, at the size the big thumbnail needs (never above
   ``PREVIEW_LONG_EDGE_CAP``), into the preview file
   (``api.editing.files``); the thumbnails are made again from it before the
   save answers;
2. in a background task, at full size, into the rendition, which the
   full-size view and the metadata-free copies serve once it is ``ready``.

A task of a version that is no longer the row's writes nothing. A recipe
that changes nothing has no rendition: the files go and the thumbnails come
from the original again. When the geometry changes, the face boxes, stored
in big-thumbnail pixels, move from the old picture to the new one.
"""

from __future__ import annotations

import dataclasses
import logging
import math
import os
import time
import uuid
from functools import partial
from typing import TYPE_CHECKING, Final

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from api.editing import files
from api.editing.geometry import (
    Frame,
    default_crop_scale,
    make_frame,
    mirror_geometry,
    move_box,
    output_size,
    turn_geometry,
)
from api.editing.pipeline import render
from api.editing.recipe import (
    Geometry,
    Json,
    Recipe,
    is_identity,
    recipe_from_json,
    recipe_to_json,
)
from api.editing.source import SRGB8_FILE_EDGE, Source, encode_source_file, load_source
from api.jobs.queue import enqueue_task
from api.models import Face, Photo, PhotoEdit
from api.sharing.copies import delete_copies
from api.thumbnails import face_boxes
from api.thumbnails import render as thumbnails

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt

logger = logging.getLogger(__name__)

# The long edge of the save's render at most. It is made at the big
# thumbnail's size (1620 px for a 3:2 picture at the default height); a
# panorama or a large BIG_THUMBNAIL_HEIGHT stops here, and the thumbnails are
# made again from the rendition when it is ready.
PREVIEW_LONG_EDGE_CAP: Final = 2048
# How many pixels short of the height it wants the big thumbnail may be (the
# rounding of two resizes) before the rendition replaces it.
THUMBNAIL_SHORT_BY: Final = 2
MAX_HISTORY_STEPS: Final = 200

type HistoryStep = dict[str, Json]
type Size = tuple[int, int]


class NotEditableError(Exception):
    """A video: only pictures are edited."""


class FileMissingError(Exception):
    """The photo has no main file on disk to edit."""


class RenderError(Exception):
    """The photo's file could not be read or rendered."""


# What rendering an edit outside a request can fail with: the file gone or
# unreadable, the render, the disk.
_RENDER_ERRORS = (RenderError, FileMissingError, NotEditableError, OSError)


def _loaded(path: str, local_orientation: int, long_edge: int | None) -> Source:
    """``load_source``, its decoders' many errors as ``RenderError``."""
    try:
        return load_source(path, local_orientation, long_edge=long_edge)
    except Exception as error:
        # The message of a decoder error carries the file's path: not logged.
        raise RenderError(type(error).__name__) from error


def _rendered(
    source: Source, recipe: Recipe, long_edge: int | None
) -> npt.NDArray[np.uint8]:
    """``render``, an error of numpy or OpenCV (memory) as ``RenderError``."""
    try:
        return render(source, recipe, long_edge=long_edge)
    except Exception as error:
        raise RenderError(type(error).__name__) from error


def editable_file(photo: Photo) -> str:
    """The file ``photo``'s edit is rendered from; raises when there is none."""
    if photo.video:
        raise NotEditableError(photo.image_hash)
    main_file = photo.main_file
    if main_file is None or not os.path.isfile(main_file.path):
        raise FileMissingError(photo.image_hash)
    return main_file.path


def edit_source_file(photo: Photo) -> bytes:
    """The edit source file ("LPES") the web editor's preview works on."""
    path = editable_file(photo)
    return encode_source_file(
        _loaded(path, photo.local_orientation or 1, SRGB8_FILE_EDGE)
    )


# --- The save's render -----------------------------------------------------------


def _smallest_crop_side(geometry: Geometry) -> float:
    """A lower bound of the crop's width and height, as parts of the picture."""
    if geometry.crop is not None:
        return min(geometry.crop.w, geometry.crop.h)
    if geometry.straighten:
        # Exact for a square picture; a long one is caught by the second load.
        return default_crop_scale(1, 1, geometry.straighten)
    return 1.0


def _preview_long_edge(
    geometry: Geometry, source_width: int, source_height: int
) -> int:
    """The long edge that makes the edited picture as high as the big thumbnail."""
    width, height = output_size(geometry, source_width, source_height)
    wanted = math.ceil(settings.BIG_THUMBNAIL_HEIGHT * max(width, height) / height)
    return min(wanted, PREVIEW_LONG_EDGE_CAP)


def _preview_source(path: str, local_orientation: int, geometry: Geometry) -> Source:
    """The source reduced as far as the save's render allows.

    Loaded at the cap's size over the crop; loaded again, larger, when the
    crop turns out to need more (a straightened panorama).
    """
    long_edge = math.ceil(PREVIEW_LONG_EDGE_CAP / _smallest_crop_side(geometry))
    source = _loaded(path, local_orientation, long_edge)
    wanted = _preview_long_edge(geometry, source.full_width, source.full_height)
    reached = max(output_size(geometry, source.width, source.height))
    if reached < wanted and source.width < source.full_width:
        larger = math.ceil(long_edge * wanted / reached) + 1
        source = _loaded(path, local_orientation, larger)
    return source


@dataclasses.dataclass(frozen=True)
class _Preview:
    part: str
    width: int
    height: int
    source_width: int
    source_height: int


def _render_preview(photo: Photo, path: str, recipe: Recipe) -> _Preview:
    """Render ``recipe`` at the big thumbnail's size into a part file."""
    started = time.monotonic()
    source = _preview_source(path, photo.local_orientation or 1, recipe.geometry)
    long_edge = _preview_long_edge(
        recipe.geometry, source.full_width, source.full_height
    )
    pixels = _rendered(source, recipe, long_edge)
    part = files.write_part(
        pixels, files.preview_path(photo.image_hash), files.PREVIEW_JPEG
    )
    width, height = output_size(recipe.geometry, source.full_width, source.full_height)
    logger.info(
        "photo %s: edit rendered at %s px in %.2f s",
        photo.image_hash,
        max(pixels.shape[:2]),
        time.monotonic() - started,
    )
    return _Preview(part, width, height, source.full_width, source.full_height)


def restore_preview(photo: Photo, edit: PhotoEdit) -> bool:
    """Render the save's render of ``edit`` again, its file being gone; whether it worked."""
    try:
        preview = _render_preview(
            photo, editable_file(photo), recipe_from_json(edit.settings)
        )
    except _RENDER_ERRORS as error:
        logger.error(
            "photo %s: cannot render its edit again: %s",
            photo.image_hash,
            type(error).__name__,
        )
        return False
    files.move_into_place(preview.part, files.preview_path(photo.image_hash))
    return True


# --- Showing an edit ------------------------------------------------------------


def _shown_frame(edit: PhotoEdit | None, fallback: Size) -> Frame:
    """The frame of the picture the thumbnails show for ``edit``.

    The original (an identity frame) when the edit is not shown. ``fallback``
    is the source size when the row has none yet.
    """
    width = edit.source_width if edit is not None and edit.source_width else fallback[0]
    height = (
        edit.source_height if edit is not None and edit.source_height else fallback[1]
    )
    if edit is None or not edit.shown:
        return make_frame(Geometry(), width, height)
    return make_frame(recipe_from_json(edit.settings).geometry, width, height)


def _pixels(
    size: Size, box: tuple[float, float, float, float]
) -> tuple[int, int, int, int]:
    """A normalised box in pixels of a picture of ``size``, at least one pixel wide and high."""
    width, height = size
    left, top, right, bottom = (
        round(box[0] * width),
        round(box[1] * height),
        round(box[2] * width),
        round(box[3] * height),
    )
    # A box moved out of the picture is empty: one pixel at the edge it left by.
    if right <= left:
        left = min(left, width - 1)
        right = left + 1
    if bottom <= top:
        top = min(top, height - 1)
        bottom = top + 1
    return left, top, right, bottom


def _move_face_boxes(
    photo: Photo, before: Frame, after: Frame, size_before: Size, size_after: Size
) -> None:
    """Move ``photo``'s face boxes from the thumbnail of ``before`` to the one of ``after``."""
    faces = list(Face.objects.filter(photo=photo))
    for face in faces:
        box = (
            face.location_left / size_before[0],
            face.location_top / size_before[1],
            face.location_right / size_before[0],
            face.location_bottom / size_before[1],
        )
        left, top, right, bottom = _pixels(size_after, move_box(before, after, box))
        face.location_left, face.location_top = left, top
        face.location_right, face.location_bottom = right, bottom
        # A new box in a new thumbnail: the face model may find a face in it.
        face.unmatched_by = ""
    Face.objects.bulk_update(faces, [*face_boxes.FACE_BOX_FIELDS, "unmatched_by"])


def _show(photo: Photo, before: Frame, after: Frame) -> None:
    """Make ``photo``'s thumbnails again and keep its face boxes on its faces.

    A photo the scan has not made thumbnails for yet gets them from the scan,
    which asks ``thumbnail_source`` too.
    """
    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail is None:
        return
    size_before = thumbnails.big_thumbnail_size(photo.image_hash)
    thumbnails.regenerate_thumbnails(thumbnail, rescale_faces=False)
    # The placeholder colour is kept once set; an edit changes the colours.
    thumbnails.refresh_dominant_color(thumbnail)
    size_after = thumbnails.big_thumbnail_size(photo.image_hash)
    if size_before is None or size_after is None:
        return
    if before == after:
        face_boxes.rescale_face_boxes(photo, size_before, size_after)
        return
    _move_face_boxes(photo, before, after, size_before, size_after)


def _touch(photo: Photo) -> None:
    """Bump the photo: the delta feed sends it again."""
    Photo.objects.filter(pk=photo.pk).update(last_modified=timezone.now())


def _queue_rendition(photo_id: uuid.UUID, version: int) -> None:
    try:
        enqueue_task(render_rendition, photo_id, version)
    except Exception:
        logger.exception("could not queue the rendition of photo %s", photo_id)
        PhotoEdit.objects.filter(pk=photo_id, version=version).update(
            rendition=PhotoEdit.Rendition.FAILED
        )


def save_edit(
    photo: Photo, recipe: Recipe, history: list[HistoryStep], history_cursor: int
) -> PhotoEdit:
    """Store ``photo``'s edit and show it; the full-size rendition is queued.

    Raises ``NotEditableError`` for a video and ``FileMissingError`` without a
    file on disk, before anything is stored.
    """
    path = editable_file(photo)
    preview = None if is_identity(recipe) else _render_preview(photo, path, recipe)
    try:
        with transaction.atomic():
            edit = PhotoEdit.objects.select_for_update().filter(pk=photo.pk).first()
            if edit is None:
                edit = PhotoEdit(photo=photo)
            fallback = (
                (preview.source_width, preview.source_height)
                if preview is not None
                else (edit.source_width or 1, edit.source_height or 1)
            )
            before = _shown_frame(edit, fallback)
            was_shown = edit.shown
            edit.settings = recipe_to_json(recipe)
            edit.history = list(history)
            edit.history_cursor = history_cursor
            edit.version += 1
            # A rendition of an earlier version is never served again.
            image_hash = photo.image_hash
            transaction.on_commit(
                partial(files.remove, files.rendition_path(image_hash))
            )
            if preview is None:
                edit.rendition = PhotoEdit.Rendition.NONE
                edit.width = edit.height = None
                transaction.on_commit(
                    partial(files.remove, files.preview_path(image_hash))
                )
            else:
                files.move_into_place(preview.part, files.preview_path(image_hash))
                preview = dataclasses.replace(preview, part="")
                edit.rendition = PhotoEdit.Rendition.PENDING
                edit.width, edit.height = preview.width, preview.height
                edit.source_width, edit.source_height = fallback
            edit.save()
            if was_shown or edit.shown:
                # Regenerating the thumbnails deletes the copies made for shares.
                _show(photo, before, _shown_frame(edit, fallback))
            _touch(photo)
            if edit.shown:
                transaction.on_commit(partial(_queue_rendition, photo.pk, edit.version))
    finally:
        if preview is not None and preview.part:
            files.remove(preview.part)
    return edit


def delete_edit(photo: Photo) -> None:
    """Remove ``photo``'s edit, its history and its files; show the original again.

    The files go once the delete commits (``api.editing.cleanup``).
    """
    with transaction.atomic():
        edit = PhotoEdit.objects.select_for_update().filter(pk=photo.pk).first()
        if edit is None:
            return
        fallback = (edit.source_width or 1, edit.source_height or 1)
        before = _shown_frame(edit, fallback)
        was_shown = edit.shown
        edit.delete()
        if was_shown:
            _show(photo, before, _shown_frame(None, fallback))
        _touch(photo)


# --- Rotating an edited photo ---------------------------------------------------


def _rotation_step(recipe: Recipe, quarter_turns: int) -> HistoryStep:
    geometry = recipe.geometry
    control, value = (
        ("geometry.orientation", geometry.orientation)
        if quarter_turns
        else ("geometry.flip_h", geometry.flip_h)
    )
    return {
        "action": "set",
        "control": control,
        "value": value,
        "at": timezone.now().isoformat().replace("+00:00", "Z"),
        "settings": recipe_to_json(recipe),
    }


def rotate_edit(photo: Photo, angle: int, flip_horizontal: bool) -> bool:
    """Turn an edited photo inside its recipe; False when it shows no edit.

    ``angle`` is counter-clockwise, a multiple of 90, as ``rotate_photo``
    takes it, and the flip comes after the turn. The recipe's crop is in the
    frame ``local_orientation`` gives, so a photo with an edit is turned in
    its geometry instead (a history step, a new version, a new render).
    """
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    if edit is None or not edit.shown:
        return False
    recipe = recipe_from_json(edit.settings)
    geometry = recipe.geometry
    quarter_turns = (-angle // 90) % 4
    for _ in range(quarter_turns):
        geometry = turn_geometry(geometry)
    if flip_horizontal:
        geometry = mirror_geometry(geometry)
    turned = dataclasses.replace(recipe, geometry=geometry)
    kept = list(edit.history[: edit.history_cursor + 1])
    history = [*kept, _rotation_step(turned, quarter_turns)]
    history = history[-MAX_HISTORY_STEPS:]
    save_edit(photo, turned, history, len(history) - 1)
    return True


# --- The full-size rendition -----------------------------------------------------


def _thumbnail_short(photo: Photo, edited_height: int) -> bool:
    """Whether the big thumbnail is smaller than the rendition can make it."""
    size = thumbnails.big_thumbnail_size(photo.image_hash)
    wanted = min(settings.BIG_THUMBNAIL_HEIGHT, edited_height)
    return size is None or size[1] < wanted - THUMBNAIL_SHORT_BY


def _render_full(photo: Photo, settings_json: Json) -> npt.NDArray[np.uint8]:
    source = _loaded(editable_file(photo), photo.local_orientation or 1, None)
    return _rendered(source, recipe_from_json(settings_json), None)


def render_rendition(photo_id: uuid.UUID, version: int) -> None:
    """The background task of a save: write the full-size rendition of ``version``.

    Writes nothing when the edit has moved on to another version (or is
    gone) before or while it renders. A failure marks it ``failed``; the
    thumbnails keep the save's render.
    """
    edit = (
        PhotoEdit.objects.select_related("photo", "photo__main_file")
        .filter(pk=photo_id, version=version, rendition=PhotoEdit.Rendition.PENDING)
        .first()
    )
    if edit is None:
        return
    photo = edit.photo
    image_hash = photo.image_hash
    started = time.monotonic()
    try:
        pixels = _render_full(photo, edit.settings)
        part = files.write_part(
            pixels, files.rendition_path(image_hash), files.RENDITION_JPEG
        )
    except _RENDER_ERRORS as error:
        # The message of a decoder error carries the file's path.
        logger.error(
            "photo %s: rendering edit version %s failed: %s",
            image_hash,
            version,
            type(error).__name__,
        )
        PhotoEdit.objects.filter(pk=photo_id, version=version).update(
            rendition=PhotoEdit.Rendition.FAILED
        )
        return
    height, width = int(pixels.shape[0]), int(pixels.shape[1])
    with transaction.atomic():
        current = (
            PhotoEdit.objects.select_for_update()
            .filter(pk=photo_id, version=version)
            .first()
        )
        if current is None:
            files.remove(part)
            return
        try:
            files.move_into_place(part, files.rendition_path(image_hash))
        except OSError:
            # Windows: the rendition of an earlier version is being served.
            logger.error("photo %s: cannot put its rendition in place", image_hash)
            files.remove(part)
            current.rendition = PhotoEdit.Rendition.FAILED
            current.save(update_fields=["rendition", "updated_at"])
            return
        files.remove(files.preview_path(image_hash))
        current.rendition = PhotoEdit.Rendition.READY
        current.width, current.height = width, height
        current.save(update_fields=["rendition", "width", "height", "updated_at"])
        _touch(photo)
    logger.info(
        "photo %s: edit version %s rendered at full size in %.2f s",
        image_hash,
        version,
        time.monotonic() - started,
    )
    # Copies made from the original while it rendered show the old picture.
    delete_copies(image_hash)
    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail is not None and _thumbnail_short(photo, height):
        thumbnails.regenerate_thumbnails(thumbnail)


def shown_file(photo: Photo) -> str | None:
    """The rendition the full-size view serves for ``photo``, or None for the original."""
    if photo.video:
        return None
    edit = PhotoEdit.objects.filter(
        pk=photo.pk, rendition=PhotoEdit.Rendition.READY
    ).first()
    if edit is None:
        return None
    path = files.rendition_path(photo.image_hash)
    return path if os.path.exists(path) else None
