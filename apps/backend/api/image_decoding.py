"""Decode an image to a pyvips thumbnail; Pillow fills in what the bundled libvips lacks.

pyvips-binary ships libvips without HEVC (HEIC), JPEG XL, BMP or JPEG 2000 loaders.
pillow-heif and pillow-jxl-plugin bring those to Pillow, so anything libvips
rejects is decoded there, EXIF-rotated, and handed to pyvips as an array.
"""

import numpy as np
import pillow_heif
import pillow_jxl  # noqa: F401  registers the JPEG XL plugin on import
import pyvips
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()


def _pillow_to_vips(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        return pyvips.Image.new_from_array(np.asarray(image))


def thumbnail(path, height):
    """A pyvips image of at most `height` pixels high, auto-rotated, from any supported file."""
    try:
        image = pyvips.Image.thumbnail(
            path, 10000, height=height, size=pyvips.enums.Size.DOWN
        )
        return image.copy_memory()  # decode now, so an unsupported codec fails here
    except pyvips.Error:
        return _pillow_to_vips(path).thumbnail_image(
            10000, height=height, size=pyvips.enums.Size.DOWN
        )
