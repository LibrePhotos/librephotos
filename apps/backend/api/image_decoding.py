"""Decode an image to a pyvips thumbnail; Pillow fills in what the bundled libvips lacks.

pyvips-binary ships libvips without HEVC (HEIC), JPEG XL, BMP or JPEG 2000 loaders.
pillow-heif and pillow-jxl-plugin bring those to Pillow, so anything libvips
rejects is decoded there, EXIF-rotated, and handed to pyvips as an array.
"""

import numpy as np
import pillow_heif
import pillow_jxl  # noqa: F401  registers the JPEG XL plugin on import
import pyvips
import rawpy
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()
# The Pillow path decodes the whole image into memory, so a crafted JPEG XL or BMP
# declaring absurd dimensions must be refused from its header, before any allocation:
# Pillow warns above this many pixels and raises DecompressionBombError above twice
# it. 250 MP keeps every real camera (200 MP phones, medium format) well inside.
Image.MAX_IMAGE_PIXELS = 250_000_000


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


# LibRaw's flip value as the EXIF orientation pyvips' autorot understands.
_FLIP_TO_ORIENTATION = {3: 3, 5: 8, 6: 6}
# Unconstrained side of a thumbnail box (vips wants a number).
_ANY = 100_000


def _same_shape(width, height, other_width, other_height):
    return abs(width / height - other_width / other_height) <= 0.02 * (
        other_width / other_height
    )


def raw_preview(path, height):
    """The camera's own JPEG preview of a RAW file, `height` pixels high, or None.

    Rendering the sensor data (the thumbnail service) takes ~0.6 s a photo, and
    the service renders one RAW at a time for every worker. Almost every camera
    also stores a JPEG it rendered itself at full aspect, which decodes in a
    fraction of that. It is only used when it shows the whole picture (same
    shape as the sensor image, not letterboxed) and is at least as tall as the
    render would be; otherwise the caller renders the RAW as before. LibRaw's
    rotation is applied, as the render does.
    """
    try:
        with rawpy.imread(path) as raw:
            sizes = raw.sizes
            thumb = raw.extract_thumb()
        if thumb.format != rawpy.ThumbFormat.JPEG:
            return None
        header = pyvips.Image.new_from_buffer(thumb.data, "")
    except Exception:
        return None
    if not (header.width and header.height and sizes.width and sizes.height):
        return None
    if not _same_shape(header.width, header.height, sizes.width, sizes.height):
        return None

    orientation = _FLIP_TO_ORIENTATION.get(sizes.flip, 1)
    sideways = orientation in (6, 8)
    preview_height = header.width if sideways else header.height
    render_height = sizes.width if sideways else sizes.height
    if preview_height < min(height, render_height):
        return None

    # Shrink before rotating, so a sideways picture is boxed by its width.
    image = pyvips.Image.thumbnail_buffer(
        thumb.data,
        height if sideways else _ANY,
        height=_ANY if sideways else height,
        size=pyvips.enums.Size.DOWN,
        no_rotate=True,
    ).copy_memory()
    # The preview's own EXIF may disagree with LibRaw, and it must not reach the
    # thumbnail, where a browser would rotate the picture a second time.
    for field in image.get_fields():
        if field == "orientation" or field.startswith(("exif-", "xmp-")):
            image.remove(field)
    if orientation != 1:
        image.set_type(pyvips.GValue.gint_type, "orientation", orientation)
        image = image.autorot()
    return image


def can_decode(path):
    """Whether some loader recognises the file, from its header alone (no pixel decode)."""
    try:
        pyvips.Image.new_from_file(path)
        return True
    except pyvips.Error:
        pass
    try:
        with Image.open(path):
            return True
    except Exception:
        return False
