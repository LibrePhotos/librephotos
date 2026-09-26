import os
import subprocess

import numpy as np
import pyvips
from django.conf import settings

from api import binaries, image_decoding, sidecars, util, video_color
from api.models.file import is_raw


_ORIENTATION_TRANSFORMS = {
    2: lambda image: image.flip(pyvips.enums.Direction.HORIZONTAL),
    3: lambda image: image.rot180(),
    4: lambda image: image.flip(pyvips.enums.Direction.VERTICAL),
    5: lambda image: image.rot90().flip(pyvips.enums.Direction.HORIZONTAL),
    6: lambda image: image.rot270(),
    7: lambda image: image.rot270().flip(pyvips.enums.Direction.HORIZONTAL),
    8: lambda image: image.rot90(),
}


def _apply_local_orientation(
    image: pyvips.Image, local_orientation: int
) -> pyvips.Image:
    """Apply a user-specified orientation transform to an already-upright pyvips image.

    ``local_orientation`` follows the EXIF Orientation convention (1-8).
    Orientation 1 is the identity (no change).  The image passed in is assumed
    to be already auto-rotated by pyvips (i.e. it is visually upright), so
    this function applies *additional* rotation/flip on top.

    EXIF orientation semantics (applied to a visually-upright image):
        1 – no change
        2 – flip horizontal
        3 – rotate 180°
        4 – flip vertical
        5 – rotate 90° CCW then flip horizontal
        6 – rotate 90° CW
        7 – rotate 90° CW then flip horizontal
        8 – rotate 90° CCW (= 270° CW)
    """
    transform = _ORIENTATION_TRANSFORMS.get(local_orientation)
    if transform is None:
        return image
    return transform(image)


# WebP encoding is half of what a thumbnail costs. At Q95, effort 2 encodes in
# half the time of libwebp's default 4 and gives files of the same size, about
# 0.4 dB lower in PSNR at ~43 dB, which cannot be seen.
WEBP = {"Q": 95, "effort": 2}


# Formats whose thumbnail follows an EXIF Orientation that exiftool writes into
# the file afterwards, measured through ``image_decoding.thumbnail`` with the
# pip-installed libvips and Pillow plugins (#2068). HEIC and AVIF keep the
# picture unrotated (libheif applies its own irot/imir and the EXIF tag is
# ignored), exiftool cannot write EXIF into a bare JPEG XL codestream, BMP or
# GIF, and RAW files go through LibRaw in the thumbnail service, which is
# unverified. Everything not listed here keeps the rotation in
# ``local_orientation``.
_EXIF_ORIENTED_EXTENSIONS = frozenset(
    {".jpg", ".jpeg", ".jpe", ".jfif", ".tif", ".tiff", ".png", ".webp"}
)


def renders_exif_orientation(path) -> bool:
    """Whether rotating ``path`` through its EXIF Orientation rotates its thumbnail."""
    if is_raw(path):
        return False
    return os.path.splitext(path)[1].lower() in _EXIF_ORIENTED_EXTENSIONS


def _autorotated(image: pyvips.Image, exif_orientation: int) -> pyvips.Image:
    tagged = image.copy()
    tagged.set_type(pyvips.GValue.gint_type, "orientation", exif_orientation)
    return tagged.autorot()


def exif_orientation_showing(exif_orientation: int, local_orientation: int) -> int:
    """The EXIF Orientation that shows a file the way it renders today.

    A file tagged ``exif_orientation`` and rendered with ``local_orientation``
    on top looks exactly like the same file tagged with the returned value and
    rendered with no local orientation. Worked out by running both through
    libvips' own autorotation and ``_apply_local_orientation`` on a small
    asymmetric image, because the two do not share a convention:
    ``_apply_local_orientation`` renders 6 as a quarter turn counter-clockwise
    where EXIF 6 is clockwise (the frontend negates the angle it sends to
    match), so composing the numbers directly writes the opposite turn.
    """
    probe = pyvips.Image.new_from_array(np.arange(6, dtype=np.uint8).reshape(2, 3))
    target = _apply_local_orientation(
        _autorotated(probe, exif_orientation), local_orientation
    ).numpy()
    for candidate in range(1, 9):
        shown = _autorotated(probe, candidate).numpy()
        if shown.shape == target.shape and (shown == target).all():
            return candidate
    raise ValueError(
        f"no EXIF orientation shows {exif_orientation} under {local_orientation}"
    )


def _media_path(output_path, hash, file_type):
    return os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)


def _reorient_file_in_place(complete_path, local_orientation):
    if not local_orientation or local_orientation == 1:
        return
    x = pyvips.Image.new_from_file(complete_path)
    x = x.copy_memory()
    x = _apply_local_orientation(x, local_orientation)
    x.write_to_file(complete_path, **WEBP)


def _request_raw_thumbnail(input_path, output_height, complete_path, local_orientation):
    json = {
        "source": input_path,
        "destination": complete_path,
        "height": output_height,
    }
    from api.http_timeouts import THUMBNAIL

    # An error status raises here, before its body is read as a thumbnail.
    response = sidecars.post("thumbnail", "/", json=json, timeout=THUMBNAIL).json()
    # The RAW service applies auto-orientation internally.  Apply
    # any user-specified rotation on top.
    _reorient_file_in_place(complete_path, local_orientation)
    return response["thumbnail"]


def _resize_big_thumbnail(output_height, complete_path, hash, file_type):
    # only encode raw image in worse case, smaller thumbnails can get created from the big thumbnail instead
    big_thumbnail_path = os.path.join(
        settings.MEDIA_ROOT, "thumbnails_big", hash + file_type
    )
    x = pyvips.Image.thumbnail(
        big_thumbnail_path,
        10000,
        height=output_height,
        size=pyvips.enums.Size.DOWN,
    )
    # The big thumbnail already has EXIF auto-rotation and any
    # local_orientation applied, so we only resize here.
    x.write_to_file(complete_path, **WEBP)
    return complete_path


def _oriented(image, local_orientation):
    if local_orientation and local_orientation != 1:
        return _apply_local_orientation(image, local_orientation)
    return image


def _decode_thumbnail(input_path, output_height, local_orientation):
    return _oriented(
        image_decoding.thumbnail(input_path, output_height), local_orientation
    )


def _render_thumbnail(input_path, output_height, complete_path, local_orientation):
    x = _decode_thumbnail(input_path, output_height, local_orientation)
    x.write_to_file(complete_path, **WEBP)
    return complete_path


def _render_raw_thumbnail(input_path, output_height, complete_path, local_orientation):
    """A RAW's thumbnail from its embedded preview, or else the RAW service."""
    preview = image_decoding.raw_preview(input_path, output_height)
    if preview is None:
        return _request_raw_thumbnail(
            input_path, output_height, complete_path, local_orientation
        )
    _oriented(preview, local_orientation).write_to_file(complete_path, **WEBP)
    return complete_path


def _render_big_thumbnail(input_path, complete_path, local_orientation):
    """Write the big thumbnail; return it in memory when it was rendered here."""
    height = STATIC_THUMBNAIL_HEIGHTS["thumbnails_big"]
    if is_raw(input_path):
        image = image_decoding.raw_preview(input_path, height)
        if image is None:
            _request_raw_thumbnail(input_path, height, complete_path, local_orientation)
            return None
        image = _oriented(image, local_orientation)
    else:
        image = _decode_thumbnail(input_path, height, local_orientation)
    image.write_to_file(complete_path, **WEBP)
    return image


def _load_big_thumbnail(complete_path):
    # From bytes: on Windows a file libvips has opened stays open, and a
    # thumbnail that is regenerated later could not be deleted.
    with open(complete_path, "rb") as handle:
        return pyvips.Image.new_from_buffer(handle.read(), "")


def render_big_thumbnail_to(input_path, output_path, local_orientation=1, legacy=False):
    """Render the big thumbnail of ``input_path`` to an arbitrary file.

    Same image ``create_thumbnail`` would put in ``thumbnails_big``, RAW files
    through the same service, but written where the caller asks instead of
    under MEDIA_ROOT, for comparing a file against what is already indexed.

    ``legacy`` renders it as releases before the embedded RAW previews and
    WebP effort 2 did: every RAW through the service, libwebp's default effort.
    A photo indexed by one of them carries a perceptual hash of that render.
    """
    if legacy:
        if is_raw(input_path):
            return _request_raw_thumbnail(
                input_path, 1080, output_path, local_orientation
            )
        image = _decode_thumbnail(input_path, 1080, local_orientation)
        image.write_to_file(output_path, Q=95)
        return output_path
    if is_raw(input_path):
        return _render_raw_thumbnail(input_path, 1080, output_path, local_orientation)
    return _render_thumbnail(input_path, 1080, output_path, local_orientation)


def create_thumbnail(
    input_path, output_height, output_path, hash, file_type, local_orientation=1
):
    try:
        raw = is_raw(input_path)
        complete_path = _media_path(output_path, hash, file_type)
        if not raw:
            return _render_thumbnail(
                input_path, output_height, complete_path, local_orientation
            )
        if "thumbnails_big" in output_path:
            return _render_raw_thumbnail(
                input_path, output_height, complete_path, local_orientation
            )
        return _resize_big_thumbnail(output_height, complete_path, hash, file_type)
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for file {input_path}")
        raise e


# Output directory -> height of the static (WebP) thumbnails, largest first.
STATIC_THUMBNAIL_HEIGHTS = {
    "thumbnails_big": 1080,
    "square_thumbnails": 500,
    "square_thumbnails_small": 250,
}


def create_static_thumbnails(input_path, hash, output_paths, local_orientation=1):
    """Write the static thumbnails in ``output_paths`` from a single decode.

    Decoding the original is most of a thumbnail's cost, and it used to be
    done once per size. The big thumbnail is rendered as ``create_thumbnail``
    renders it; the smaller ones are resized from it (in memory, or from the
    file when only they are missing), which is what RAW files always did.
    """
    big_path = _media_path("thumbnails_big", hash, ".webp")
    try:
        big = None
        if "thumbnails_big" in output_paths:
            big = _render_big_thumbnail(input_path, big_path, local_orientation)
        smaller = [path for path in output_paths if path != "thumbnails_big"]
        if not smaller:
            return
        # The big thumbnail carries the EXIF and local orientation already.
        if big is None:
            big = _load_big_thumbnail(big_path)
        big = big.copy_memory()
        for output_path in smaller:
            small = big.thumbnail_image(
                10000,
                height=STATIC_THUMBNAIL_HEIGHTS[output_path],
                size=pyvips.enums.Size.DOWN,
            )
            small.write_to_file(_media_path(output_path, hash, ".webp"), **WEBP)
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for file {input_path}")
        raise e


def create_animated_thumbnail(input_path, output_height, output_path, hash, file_type):
    try:
        output = os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)
        command = [
            binaries.ffmpeg(),
            "-i",
            input_path,
            "-to",
            "00:00:05",
            "-vcodec",
            "libx264",
            "-crf",
            "20",
            "-an",
            # Tonemapped when the source is HDR, or the gallery shows the same
            # washed-out picture the player does. See :mod:`api.video_color`.
            "-filter:v",
            video_color.video_filter(input_path, f"scale=-2:{output_height}"),
            output,
        ]

        with subprocess.Popen(command) as proc:
            proc.wait()
    except Exception as e:
        util.logger.error(f"Could not create animated thumbnail for file {input_path}")
        raise e


def create_thumbnail_for_video(input_path, output_path, hash, file_type):
    try:
        output = os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)
        command = [
            binaries.ffmpeg(),
            "-i",
            input_path,
            "-ss",
            "00:00:00.000",
            "-vframes",
            "1",
        ]
        # No resizing here, so there is a filter only when the source is HDR and
        # the grabbed frame would otherwise be washed out.
        tonemap = video_color.video_filter(input_path)
        if tonemap:
            command += ["-filter:v", tonemap]
        command.append(output)

        with subprocess.Popen(command) as proc:
            proc.wait()
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for video file {input_path}")
        raise e


def does_static_thumbnail_exist(output_path, hash):
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, output_path, hash + ".webp")
    )


def does_video_thumbnail_exist(output_path, hash):
    return os.path.exists(os.path.join(settings.MEDIA_ROOT, output_path, hash + ".mp4"))
