"""Where a photo's edit lives on disk.

Two files per edited photo, under ``MEDIA_ROOT/edits/`` and named after its
``image_hash`` like the thumbnails:

- ``<image_hash>.jpg``: the rendition, the edited picture at full size (sRGB,
  no metadata). It exists while the edit's ``rendition`` is ``ready``.
- ``<image_hash>.preview.jpg``: the render made during the save, at the size
  the big thumbnail needs. The thumbnails are made from it until the
  rendition is ready, and again whenever they are regenerated before then,
  so nothing renders the recipe again only to make a thumbnail.

Both are written to a part file beside them and moved into place, so a reader
never sees half a file.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import TYPE_CHECKING, Final

import PIL.Image

from api.mime import JPEG_EXTENSION
from api.models.thumbnail import thumbnail_path

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt

logger = logging.getLogger(__name__)

EDITS_DIR: Final = "edits"
RENDITION_SUFFIX: Final = JPEG_EXTENSION
PREVIEW_SUFFIX: Final = ".preview" + JPEG_EXTENSION
# The rendition is what people look at and download: quality 92 with chroma
# subsampling, as a camera writes it. The preview is only a thumbnail's
# source, read once per thumbnail: kept close to lossless.
RENDITION_JPEG: Final[dict[str, int]] = {"quality": 92, "subsampling": 2}
PREVIEW_JPEG: Final[dict[str, int]] = {"quality": 95, "subsampling": 0}


def rendition_path(image_hash: str) -> str:
    """The rendition of the photo with ``image_hash``."""
    return thumbnail_path(EDITS_DIR, image_hash, RENDITION_SUFFIX)


def preview_path(image_hash: str) -> str:
    """The save's render of the photo with ``image_hash``."""
    return thumbnail_path(EDITS_DIR, image_hash, PREVIEW_SUFFIX)


def write_part(pixels: npt.NDArray[np.uint8], final: str, jpeg: dict[str, int]) -> str:
    """Write ``pixels`` as a JPEG to a new part file beside ``final``; its path.

    ``move_into_place`` publishes it, ``remove`` drops it.
    """
    os.makedirs(os.path.dirname(final), exist_ok=True)
    part = f"{final}.{uuid.uuid4().hex}.part"
    PIL.Image.fromarray(pixels).save(part, "JPEG", **jpeg)
    return part


def move_into_place(part: str, final: str) -> None:
    os.replace(part, final)


def remove(path: str) -> None:
    """Delete ``path`` if it is there; a file that cannot go is only logged."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("could not remove an edit file of %s", os.path.basename(path))


def remove_edit_files(image_hash: str) -> None:
    """Delete the rendition and the preview of the photo with ``image_hash``."""
    remove(rendition_path(image_hash))
    remove(preview_path(image_hash))
