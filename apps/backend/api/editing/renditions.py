"""Saving, rotating and reverting a photo's edit, and rendering it.

A save stores the recipe (``PhotoEdit.version`` up by one) and, when the
recipe changes something, renders it twice:

1. in the request, at the size the big thumbnail needs (never above
   ``PREVIEW_LONG_EDGE_CAP``), into the preview file
   (``api.editing.files``); the thumbnails are made again from it before the
   save answers;
2. in a background task, at full size, into the rendition, which the
   full-size view and the metadata-free copies serve once it is ``ready``.

A task of a version that is no longer the row's writes nothing. A revert
resets the row (version up by one again, never back) instead of deleting it,
so a version names one picture of a photo forever. A recipe that changes
nothing has no rendition: the files go and the thumbnails come from the
original again. The files a save changes follow its transaction
(``files.DiskChange``): replaced inside it, put back if it rolls back. When
the geometry changes, the face boxes move with it (``api.editing.faces``).
"""

from __future__ import annotations

import dataclasses
import logging
import math
import os
import time
import uuid
from collections.abc import Callable
from functools import partial
from typing import TYPE_CHECKING, Final, NamedTuple

from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone

from api.editing import files
from api.editing.faces import Placement, geometry_frame, place_face_boxes
from api.editing.geometry import (
    Frame,
    default_crop_scale,
    mirror_geometry,
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
from api.editing.source import (
    Source,
    encode_source_file,
    load_source,
    source_file_edge,
)
from api.jobs.queue import enqueue_task
from api.models import Photo, PhotoEdit
from api.models.photo_edit import default_recipe_json
from api.models.thumbnail import thumbnail_file_paths
from api.sharing.copies import delete_copies
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
# The long edge the source is loaded at for the save's render at most. A
# small crop needs the source larger than the render (a 0.1 crop of a 2048 px
# render, a 20480 px source); past this the render comes out smaller and the
# thumbnails are made again from the rendition.
PREVIEW_LOAD_CAP: Final = 4096
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


class NoEditedFileError(Exception):
    """The photo shows an edit, and no file of it can be served."""


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
        _loaded(path, photo.local_orientation or 1, source_file_edge(path))
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
    """The source reduced as far as the save's render allows, at most ``PREVIEW_LOAD_CAP``.

    Loaded at the cap's size over the crop; loaded again, larger, when the
    crop turns out to need more (a straightened panorama).
    """
    long_edge = min(
        math.ceil(PREVIEW_LONG_EDGE_CAP / _smallest_crop_side(geometry)),
        PREVIEW_LOAD_CAP,
    )
    source = _loaded(path, local_orientation, long_edge)
    wanted = _preview_long_edge(geometry, source.full_width, source.full_height)
    reached = max(output_size(geometry, source.width, source.height))
    if reached < wanted and source.width < source.full_width:
        larger = min(math.ceil(long_edge * wanted / reached) + 1, PREVIEW_LOAD_CAP)
        if larger > long_edge:
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


def _show(
    photo: Photo,
    edit: PhotoEdit,
    before: Frame | None,
    after: Frame | None,
    disk: files.DiskChange,
) -> None:
    """Make ``photo``'s thumbnails again and keep its face boxes on its faces.

    A photo the scan has not made thumbnails for yet gets them from the scan,
    which asks ``thumbnail_source`` too.
    """
    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail is None:
        return
    size_before = thumbnails.big_thumbnail_size(photo.image_hash)
    for path in thumbnail_file_paths(photo.image_hash):
        disk.keep(path)
    thumbnails.regenerate_thumbnails(thumbnail, rescale_faces=False)
    # The placeholder colour is kept once set; an edit changes the colours.
    thumbnails.refresh_dominant_color(thumbnail)
    size_after = thumbnails.big_thumbnail_size(photo.image_hash)
    if size_before is None or size_after is None:
        return
    place_face_boxes(
        photo, edit, Placement(before, size_before), Placement(after, size_after)
    )


def _touch(photo: Photo) -> None:
    """Bump the photo: the delta feed sends it again."""
    Photo.objects.filter(pk=photo.pk).update(last_modified=timezone.now())


def _queue_rendition(photo_id: uuid.UUID, version: int) -> None:
    try:
        enqueue_task(render_rendition, photo_id, version)
    except Exception:
        logger.exception("could not queue the rendition of photo %s", photo_id)
        PhotoEdit.objects.filter(
            pk=photo_id, version=version, rendition=PhotoEdit.Rendition.PENDING
        ).update(rendition=PhotoEdit.Rendition.FAILED)


def _photo_exists(photo_id: uuid.UUID) -> bool:
    return Photo.objects.filter(pk=photo_id).exists()


def _after_store(image_hash: str, rendition_too: bool, preview_too: bool) -> None:
    """What a stored edit leaves behind once it commits: the files of before, the copies."""
    if rendition_too:
        # A rendition of an earlier version is never served again; the new
        # version's preview is in place by now.
        files.remove(files.rendition_path(image_hash))
    if preview_too:
        files.remove(files.preview_path(image_hash))
    # Copies of the picture before, including one finished during the save.
    delete_copies(image_hash)


def _store(
    photo: Photo,
    preview: _Preview | None,
    change: Callable[[PhotoEdit], None],
    create: bool = True,
) -> PhotoEdit | None:
    """Apply ``change`` to ``photo``'s edit, a new version, and show it.

    ``preview`` is the save's render of the new recipe, None when it changes
    nothing. Without ``create`` a photo with no edit is left alone (None).
    The preview file and the thumbnails are replaced inside the transaction
    and put back if it does not commit; the old rendition goes once it has.
    """
    image_hash = photo.image_hash
    disk = files.DiskChange()
    try:
        with transaction.atomic():
            edit = PhotoEdit.objects.select_for_update().filter(pk=photo.pk).first()
            if edit is None:
                if not create:
                    return None
                edit = PhotoEdit(photo=photo)
            before = geometry_frame(edit)
            was_shown = edit.shown
            change(edit)
            edit.version += 1
            if preview is None:
                edit.rendition = PhotoEdit.Rendition.NONE
                edit.width = edit.height = None
            else:
                disk.install(preview.part, files.preview_path(image_hash))
                edit.rendition = PhotoEdit.Rendition.PENDING
                edit.width, edit.height = preview.width, preview.height
                edit.source_width = preview.source_width
                edit.source_height = preview.source_height
            edit.save()
            if was_shown or edit.shown:
                # Regenerating the thumbnails deletes the copies made for shares.
                _show(photo, edit, before, geometry_frame(edit), disk)
            elif edit.face_boxes:
                edit.face_boxes = {}
                edit.save(update_fields=["face_boxes"])
            _touch(photo)
            transaction.on_commit(
                partial(_after_store, image_hash, was_shown, preview is None)
            )
            if edit.shown:
                transaction.on_commit(partial(_queue_rendition, photo.pk, edit.version))
    except Exception:
        disk.roll_back(photo_gone=not _photo_exists(photo.pk))
        raise
    transaction.on_commit(disk.discard)
    return edit


def save_edit(
    photo: Photo, recipe: Recipe, history: list[HistoryStep], history_cursor: int
) -> PhotoEdit:
    """Store ``photo``'s edit and show it; the full-size rendition is queued.

    Raises ``NotEditableError`` for a video and ``FileMissingError`` without a
    file on disk, before anything is stored.
    """
    path = editable_file(photo)
    preview = None if is_identity(recipe) else _render_preview(photo, path, recipe)

    def change(edit: PhotoEdit) -> None:
        edit.settings = recipe_to_json(recipe)
        edit.history = list(history)
        edit.history_cursor = history_cursor

    try:
        edit = _store(photo, preview, change)
    finally:
        if preview is not None:
            files.remove(preview.part)
    assert edit is not None  # created when missing
    return edit


def _reset(edit: PhotoEdit) -> None:
    edit.settings = default_recipe_json()
    edit.history = []
    edit.history_cursor = -1


def reset_edit(photo: Photo) -> None:
    """Revert ``photo`` to its original: default recipe, no history, a new version.

    The row stays (its version goes on from here, so no cached picture of an
    earlier version is ever shown for a later one); the rendition and the
    preview go once the reset commits, the thumbnails show the original and
    the face boxes are where they were before the edit. A photo never edited
    is left alone.
    """
    _store(photo, None, _reset, create=False)


def render_again(photo: Photo) -> bool:
    """Render ``photo``'s edit again from its file, which changed; whether that made its thumbnails.

    The stored recipe on the new file: a new version, a new preview and
    thumbnails, the rendition queued. False for a photo that shows no edit,
    and for a file the edit cannot be rendered from, which marks the edit
    ``failed`` with its files gone: the caller makes the thumbnails.
    """
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    if edit is None or not edit.shown:
        return False
    recipe = recipe_from_json(edit.settings)
    history: list[HistoryStep] = list(edit.history)
    try:
        save_edit(photo, recipe, history, edit.history_cursor)
    except _RENDER_ERRORS as error:
        logger.error(
            "photo %s: cannot render its edit on the new file: %s",
            photo.image_hash,
            type(error).__name__,
        )
        _mark_unrenderable(photo)
        return False
    return True


def _mark_unrenderable(photo: Photo) -> None:
    with transaction.atomic():
        edit = PhotoEdit.objects.select_for_update().filter(pk=photo.pk).first()
        if edit is None:
            return
        edit.version += 1
        edit.rendition = PhotoEdit.Rendition.FAILED
        edit.save(update_fields=["version", "rendition", "updated_at"])
        transaction.on_commit(partial(files.remove_edit_files, photo.image_hash))
        transaction.on_commit(partial(delete_copies, photo.image_hash))


def forget_edit(photo: Photo, old_hash: str) -> None:
    """Reset the edit of a photo whose file is now another picture.

    In the caller's transaction, before the photo takes the new picture's
    hash: a crop made for the old picture must not be applied to the new one.
    The files under ``old_hash`` go once it commits; the caller makes the
    thumbnails again (from the original, the edit changing nothing now) and
    drops the faces.
    """
    edit = PhotoEdit.objects.select_for_update().filter(pk=photo.pk).first()
    if edit is None:
        return
    _reset(edit)
    edit.version += 1
    edit.rendition = PhotoEdit.Rendition.NONE
    edit.width = edit.height = None
    edit.source_width = edit.source_height = None
    edit.face_boxes = {}
    edit.save()
    transaction.on_commit(partial(files.remove_edit_files, old_hash))


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


def _pending(photo_id: uuid.UUID, version: int) -> QuerySet[PhotoEdit]:
    return PhotoEdit.objects.filter(
        pk=photo_id, version=version, rendition=PhotoEdit.Rendition.PENDING
    )


class _StaleError(Exception):
    """The edit moved on while its rendition rendered."""


def _after_rendition(photo: Photo, version: int, height: int) -> None:
    """Once a rendition is ready: drop the preview, the copies, a short thumbnail."""
    image_hash = photo.image_hash
    if PhotoEdit.objects.filter(
        pk=photo.pk, version=version, rendition=PhotoEdit.Rendition.READY
    ).exists():
        # Not when a newer save has put its own preview there since.
        files.remove(files.preview_path(image_hash))
    # Copies made from the preview while it rendered show the smaller picture.
    delete_copies(image_hash)
    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail is not None and _thumbnail_short(photo, height):
        thumbnails.regenerate_thumbnails(thumbnail)


def render_rendition(photo_id: uuid.UUID, version: int) -> None:
    """The background task of a save: write the full-size rendition of ``version``.

    Writes nothing when the edit has moved on to another version (or is
    gone) before or while it renders: the row is marked ``ready`` by one
    update conditional on the version, before the file is put in place, in
    one transaction. A failure marks it ``failed``; the thumbnails keep the
    save's render.
    """
    edit = (
        _pending(photo_id, version)
        .select_related("photo", "photo__main_file", "photo__thumbnail")
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
        _pending(photo_id, version).update(rendition=PhotoEdit.Rendition.FAILED)
        return
    height, width = int(pixels.shape[0]), int(pixels.shape[1])
    try:
        with transaction.atomic():
            ready = _pending(photo_id, version).update(
                rendition=PhotoEdit.Rendition.READY,
                width=width,
                height=height,
                updated_at=timezone.now(),
            )
            if not ready:
                raise _StaleError(image_hash)
            files.move_into_place(part, files.rendition_path(image_hash))
            _touch(photo)
            transaction.on_commit(partial(_after_rendition, photo, version, height))
    except _StaleError:
        files.remove(part)
        return
    except OSError:
        # Windows: the rendition of an earlier version is being served.
        logger.error("photo %s: cannot put its rendition in place", image_hash)
        files.remove(part)
        _pending(photo_id, version).update(rendition=PhotoEdit.Rendition.FAILED)
        return
    logger.info(
        "photo %s: edit version %s rendered at full size in %.2f s",
        image_hash,
        version,
        time.monotonic() - started,
    )


# --- What the full-size view serves ---------------------------------------------


class EditedPicture(NamedTuple):
    """The file of an edited photo the full-size view serves."""

    path: str
    # Names a copy made from it (``api.sharing.copies``): one per version and
    # file, so a copy of another picture of the photo is never served.
    tag: str


def edited_picture(photo: Photo) -> EditedPicture | None:
    """The edited picture of ``photo`` at the largest size there is; None for the original.

    None when the photo has nothing to hide: a video, no edit, or a recipe
    that changes nothing. Otherwise never the original: the rendition when it
    is ready, else the save's render (the edited picture, smaller), else a
    rendition of an earlier version still on disk; a lost save's render is
    made again. Raises ``NoEditedFileError`` when none of that works.
    """
    if photo.video:
        return None
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    if edit is None or not edit.shown:
        return None
    rendition = files.rendition_path(photo.image_hash)
    preview = files.preview_path(photo.image_hash)
    version = f"edit{edit.version}"
    if edit.rendition == PhotoEdit.Rendition.READY and os.path.exists(rendition):
        return EditedPicture(rendition, version)
    if os.path.exists(preview):
        return EditedPicture(preview, f"{version}-preview")
    if os.path.exists(rendition):
        return EditedPicture(rendition, f"{version}-earlier")
    if restore_preview(photo, edit):
        return EditedPicture(preview, f"{version}-preview")
    raise NoEditedFileError(photo.image_hash)
