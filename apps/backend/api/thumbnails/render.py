from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from django.conf import settings
from PIL import Image

from api.lazy_import import LazyModule
from api.mime import EXIF_ORIENTED_EXTENSIONS, extension
from api.models.thumbnail import (
    STATIC_THUMBNAIL_DIRS,
    Thumbnail,
    thumbnail_file_paths,
)
from api.photos.file_cleanup import delete_thumbnail_files
from api.photos.media_files import is_raw
from api.runtime import binaries, sidecars
from api.video import color

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

# Loaded on first render: the API server imports this module but never renders.
if TYPE_CHECKING:
    import pyvips
else:
    pyvips = LazyModule("pyvips")
if TYPE_CHECKING:
    from api.thumbnails import decoding
else:
    decoding = LazyModule("api.thumbnails.decoding")

logger = logging.getLogger(__name__)


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
#
# ``keep`` drops every piece of the original's metadata except its colour
# profile. libvips copies EXIF and XMP into the output by default, so a
# thumbnail carried the photo's GPS position, camera serial number and
# keywords, and a public photo link (which only serves the big thumbnail)
# handed them out whatever the owner's share_location setting said. The ICC
# profile stays, or a wide-gamut photo would render with the wrong colours.
WEBP: dict[str, object] = {
    "Q": 95,
    "effort": 2,
    "keep": "icc",
}  # pyvips.enums.ForeignKeep.ICC


def _square_webp() -> dict[str, object]:
    """WEBP for the 500 and 250 px squares the grids show.

    They are the bulk of what a timeline downloads, and at Q95 they cost a
    third of the big thumbnail's bytes. At SQUARE_THUMBNAIL_QUALITY (80 by
    default, as in the Rust experiment) they shrink by 60-70 % and encode a
    third faster for an SSIM of ~0.95 against the source; the big thumbnail,
    which the lightbox shows and pHash and the ML models read, stays at 95.
    """
    return {**WEBP, "Q": settings.SQUARE_THUMBNAIL_QUALITY}


def _webp_for(output_path: str) -> dict[str, object]:
    return WEBP if "thumbnails_big" in output_path else _square_webp()


def renders_exif_orientation(path: str) -> bool:
    """Whether rotating ``path`` through its EXIF Orientation rotates its thumbnail."""
    if is_raw(path):
        return False
    return extension(path) in EXIF_ORIENTED_EXTENSIONS


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


def _media_path(output_path: str, hash: str, file_type: str) -> str:
    return os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)


def _reorient_file_in_place(complete_path: str, local_orientation: int) -> None:
    if not local_orientation or local_orientation == 1:
        return
    x = pyvips.Image.new_from_file(complete_path)
    x = x.copy_memory()
    x = _apply_local_orientation(x, local_orientation)
    x.write_to_file(complete_path, **WEBP)


def _request_raw_thumbnail(
    input_path: str, output_height: int, complete_path: str, local_orientation: int
) -> str:
    json = {
        "source": input_path,
        "destination": complete_path,
        "height": output_height,
    }
    from api.runtime.http_timeouts import THUMBNAIL

    # An error status raises here, before its body is read as a thumbnail.
    response = sidecars.post("thumbnail", "/", json=json, timeout=THUMBNAIL).json()
    # The RAW service applies auto-orientation internally.  Apply
    # any user-specified rotation on top.
    _reorient_file_in_place(complete_path, local_orientation)
    return response["thumbnail"]


def _resize_big_thumbnail(
    output_height: int, complete_path: str, hash: str, file_type: str
) -> str:
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
    x.write_to_file(complete_path, **_square_webp())
    return complete_path


def _oriented(image: pyvips.Image, local_orientation: int) -> pyvips.Image:
    if local_orientation and local_orientation != 1:
        return _apply_local_orientation(image, local_orientation)
    return image


def _decode_thumbnail(
    input_path: str, output_height: int, local_orientation: int
) -> pyvips.Image:
    return _oriented(decoding.thumbnail(input_path, output_height), local_orientation)


def _render_thumbnail(
    input_path: str,
    output_height: int,
    complete_path: str,
    local_orientation: int,
    webp: dict[str, object] = WEBP,
) -> str:
    x = _decode_thumbnail(input_path, output_height, local_orientation)
    x.write_to_file(complete_path, **webp)
    return complete_path


def _render_raw_thumbnail(
    input_path: str, output_height: int, complete_path: str, local_orientation: int
) -> str:
    """A RAW's thumbnail from its embedded preview, or else the RAW service."""
    preview = decoding.raw_preview(input_path, output_height)
    if preview is None:
        return _request_raw_thumbnail(
            input_path, output_height, complete_path, local_orientation
        )
    _oriented(preview, local_orientation).write_to_file(complete_path, **WEBP)
    return complete_path


def _render_big_thumbnail(
    input_path: str, complete_path: str, local_orientation: int
) -> pyvips.Image | None:
    """Write the big thumbnail; return it in memory when it was rendered here."""
    height = STATIC_THUMBNAIL_HEIGHTS["thumbnails_big"]
    if is_raw(input_path):
        image = decoding.raw_preview(input_path, height)
        if image is None:
            _request_raw_thumbnail(input_path, height, complete_path, local_orientation)
            return None
        image = _oriented(image, local_orientation)
    else:
        image = _decode_thumbnail(input_path, height, local_orientation)
    image.write_to_file(complete_path, **WEBP)
    return image


def _load_big_thumbnail(complete_path: str) -> pyvips.Image:
    # From bytes: on Windows a file libvips has opened stays open, and a
    # thumbnail that is regenerated later could not be deleted.
    with open(complete_path, "rb") as handle:
        return pyvips.Image.new_from_buffer(handle.read(), "")


def render_big_thumbnail_to(
    input_path: str,
    output_path: str,
    local_orientation: int = 1,
    legacy: bool = False,
) -> str:
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
        image.write_to_file(output_path, Q=95, keep=WEBP["keep"])
        return output_path
    if is_raw(input_path):
        return _render_raw_thumbnail(input_path, 1080, output_path, local_orientation)
    return _render_thumbnail(input_path, 1080, output_path, local_orientation)


def create_thumbnail(
    input_path: str,
    output_height: int,
    output_path: str,
    hash: str,
    local_orientation: int = 1,
) -> str:
    """Render one static (WebP) thumbnail of ``input_path`` into ``output_path``."""
    try:
        raw = is_raw(input_path)
        complete_path = _media_path(output_path, hash, ".webp")
        if not raw:
            return _render_thumbnail(
                input_path,
                output_height,
                complete_path,
                local_orientation,
                _webp_for(output_path),
            )
        if "thumbnails_big" in output_path:
            return _render_raw_thumbnail(
                input_path, output_height, complete_path, local_orientation
            )
        return _resize_big_thumbnail(output_height, complete_path, hash, ".webp")
    except Exception as e:
        logger.error("Could not create thumbnail for file %s", input_path)
        raise e


# Output directory -> height of the static (WebP) thumbnails, largest first.
STATIC_THUMBNAIL_HEIGHTS = {
    "thumbnails_big": 1080,
    "square_thumbnails": 500,
    "square_thumbnails_small": 250,
}


def create_static_thumbnails(
    input_path: str, hash: str, output_paths: list[str], local_orientation: int = 1
) -> None:
    """Write the static thumbnails in ``output_paths`` from a single decode.

    Decoding the original is most of a thumbnail's cost, and it used to be
    done once per size. The big thumbnail is rendered as ``create_thumbnail``
    renders it; the smaller ones are resized from it (in memory, or from the
    file when only they are missing), which is what RAW files always did.
    """
    big_path = _media_path("thumbnails_big", hash, ".webp")
    try:
        big: pyvips.Image | None = None
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
            small.write_to_file(
                _media_path(output_path, hash, ".webp"), **_square_webp()
            )
    except Exception as e:
        logger.error("Could not create thumbnail for file %s", input_path)
        raise e


# A five-second clip of a 4K HEVC video takes a slow ARM box well under a
# minute; ffmpeg still running after this is stuck on the file.
FFMPEG_TIMEOUT = 300


# ffmpeg copies the source's global metadata into its output, and with it a
# phone video's recorded location (the mp4 "location" tag). See ``WEBP``.
NO_METADATA = ("-map_metadata", "-1", "-map_chapters", "-1")


class VideoThumbnailError(RuntimeError):
    """ffmpeg failed, or never finished, making a video thumbnail."""


def _run_ffmpeg(args: list[str], output: str) -> None:
    """Run ffmpeg to write *output*; raise VideoThumbnailError if it fails.

    A failed or killed run can leave a truncated file behind, which the next
    thumbnail pass would take for a finished one, so it is removed.
    """
    try:
        binaries.run_tool("ffmpeg", args, timeout=FFMPEG_TIMEOUT)
    except binaries.ToolError as e:
        _remove_partial(output)
        raise VideoThumbnailError(str(e)) from e


def _remove_partial(output: str) -> None:
    try:
        os.remove(output)
    except FileNotFoundError:
        pass


def create_animated_thumbnail(
    input_path: str,
    output_height: int,
    output_path: str,
    hash: str,
    transfer: str | None = None,
) -> None:
    """Write the first five seconds of a video, ``output_height`` high, as an mp4."""
    try:
        output = os.path.join(settings.MEDIA_ROOT, output_path, hash + ".mp4")
        command = [
            "-y",
            "-i",
            input_path,
            "-to",
            "00:00:05",
            "-vcodec",
            "libx264",
            "-crf",
            "20",
            "-an",
            *NO_METADATA,
            # Tonemapped when the source is HDR, or the gallery shows the same
            # washed-out picture the player does. See :mod:`api.video.color`.
            *color.h264_video_args(input_path, f"scale=-2:{output_height}", transfer),
            output,
        ]

        _run_ffmpeg(command, output)
    except Exception as e:
        logger.error(
            "Could not create animated thumbnail for file %s: %s", input_path, e
        )
        raise e


def create_thumbnail_for_video(
    input_path: str,
    output_path: str,
    hash: str,
    file_type: str,
    transfer: str | None = None,
) -> None:
    try:
        output = os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)
        command = [
            "-y",
            "-i",
            input_path,
            "-ss",
            "00:00:00.000",
            "-vframes",
            "1",
            *NO_METADATA,
        ]
        # No resizing here, so there is a filter only when the source is HDR and
        # the grabbed frame would otherwise be washed out.
        tonemap = color.video_filter(input_path, transfer=transfer)
        if tonemap:
            command += ["-filter:v", tonemap]
        command.append(output)

        _run_ffmpeg(command, output)
    except Exception as e:
        logger.error("Could not create thumbnail for video file %s: %s", input_path, e)
        raise e


def does_static_thumbnail_exist(output_path: str, hash: str) -> bool:
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, output_path, hash + ".webp")
    )


def does_video_thumbnail_exist(output_path: str, hash: str) -> bool:
    return os.path.exists(os.path.join(settings.MEDIA_ROOT, output_path, hash + ".mp4"))


# ---------------------------------------------------------------------------
# A photo's thumbnails: rendering them, rebuilding them, and what is read back
# from them (aspect ratio, placeholder colour, perceptual hash). Moved out of
# the ``Thumbnail`` model so the model does no I/O (#2336); every function
# takes the Thumbnail row as its first argument.

# Where a rebuild keeps the thumbnails it replaces until the new ones exist.
SET_ASIDE_SUFFIX = ".previous"


def _put_back(set_aside: list[tuple[str, str]]) -> None:
    """Return set-aside thumbnails to their places, over anything made since."""
    for path, previous in set_aside:
        try:
            os.replace(previous, path)
        except OSError:
            logger.error("could not restore thumbnail %s from %s", path, previous)


def _set_aside_thumbnail_files(photo_hash: str) -> list[tuple[str, str]]:
    """Move ``photo_hash``'s thumbnails out of the way; return (path, moved to).

    Renamed next to themselves, not deleted, so that a rebuild that fails can
    put them back. A file that cannot be moved puts back the ones already moved
    and raises, leaving everything as it was.

    One already set aside was left by a rebuild whose worker was killed before
    it could put it back. It is the last complete thumbnail, where whatever is
    at ``path`` may be what ffmpeg had half written, so it goes back first.
    That holds only while one worker rebuilds a video at a time. Nothing locks
    it: a full rescan leaves the videos a running Probe Videos job has listed
    to that job, which skips the ones probed since it listed them, but two
    Probe Videos jobs at once are not kept apart.
    """
    set_aside: list[tuple[str, str]] = []
    for path in thumbnail_file_paths(photo_hash):
        previous = path + SET_ASIDE_SUFFIX
        if os.path.exists(previous):
            try:
                os.replace(previous, path)
            except OSError:
                _put_back(set_aside)
                raise
        if not os.path.exists(path):
            continue
        try:
            os.replace(path, previous)
        except OSError:
            _put_back(set_aside)
            raise
        set_aside.append((path, previous))
    return set_aside


def generate_thumbnail(thumbnail: Thumbnail) -> None:
    """Render the thumbnails of ``thumbnail.photo`` that are missing.

    A thumbnail that exists is kept. The files are named after the photo's
    ``image_hash``, which the frontend relies on.
    """
    photo = thumbnail.photo
    try:
        photo_hash = photo.image_hash
        local_orientation = getattr(photo, "local_orientation", 1) or 1
        if not photo.video:
            missing = [
                output_path
                for output_path in STATIC_THUMBNAIL_DIRS
                if not does_static_thumbnail_exist(output_path, photo_hash)
            ]
            if missing:
                create_static_thumbnails(
                    input_path=thumbnail.main_file_path(),
                    hash=photo_hash,
                    output_paths=missing,
                    local_orientation=local_orientation,
                )
        elif not does_static_thumbnail_exist("thumbnails_big", photo_hash):
            create_thumbnail_for_video(
                input_path=thumbnail.main_file_path(),
                output_path="thumbnails_big",
                hash=photo_hash,
                file_type=".webp",
                transfer=photo.video_color_transfer,
            )

        if photo.video and not does_video_thumbnail_exist(
            "square_thumbnails", photo_hash
        ):
            create_animated_thumbnail(
                input_path=thumbnail.main_file_path(),
                output_height=500,
                output_path="square_thumbnails",
                hash=photo_hash,
                transfer=photo.video_color_transfer,
            )

        if photo.video and not does_video_thumbnail_exist(
            "square_thumbnails_small", photo_hash
        ):
            create_animated_thumbnail(
                input_path=thumbnail.main_file_path(),
                output_height=250,
                output_path="square_thumbnails_small",
                hash=photo_hash,
                transfer=photo.video_color_transfer,
            )
        filetype = ".webp"
        if photo.video:
            filetype = ".mp4"
        thumbnail.thumbnail_big.name = os.path.join(
            "thumbnails_big", photo_hash + ".webp"
        )
        thumbnail.square_thumbnail.name = os.path.join(
            "square_thumbnails", photo_hash + filetype
        )
        thumbnail.square_thumbnail_small.name = os.path.join(
            "square_thumbnails_small", photo_hash + filetype
        )
        thumbnail.save()
    except Exception as e:
        logger.exception(
            "could not generate thumbnail for image %s", thumbnail.main_file_path()
        )
        raise e


def regenerate_thumbnails(
    thumbnail: Thumbnail, keep_old_on_failure: bool = False
) -> None:
    """Delete all existing thumbnail files and regenerate them.

    Picks up ``photo.local_orientation`` automatically via
    ``generate_thumbnail``. Should be called after updating
    ``Photo.local_orientation``.

    ``keep_old_on_failure`` is for a rebuild whose old thumbnails still show
    the right picture, only worse -- a video's washed-out HDR or unplayable
    10-bit ones. They are set aside rather than deleted, and if ffmpeg then
    fails they are put back: a washed-out thumbnail beats none at all. A
    rotation or a rewritten file leaves the old ones showing a picture that
    is no longer the photo's, so those still start from nothing.
    """
    photo_hash = thumbnail.photo.image_hash
    if not keep_old_on_failure:
        delete_thumbnail_files(photo_hash)
        generate_thumbnail(thumbnail)
    else:
        set_aside = _set_aside_thumbnail_files(photo_hash)
        try:
            generate_thumbnail(thumbnail)
        except Exception:
            _put_back(set_aside)
            raise
        for _, previous in set_aside:
            try:
                os.remove(previous)
            except OSError:
                logger.error("could not remove old thumbnail %s", previous)
        # Only these change the colours of the picture: a rotation keeps
        # them, and a rewritten file has had its colour cleared already.
        refresh_dominant_color(thumbnail)

    calculate_aspect_ratio(thumbnail)
    refresh_perceptual_hash(thumbnail)


def refresh_dominant_color(thumbnail: Thumbnail) -> None:
    """Sample the placeholder colour again from the thumbnails just built.

    ``calculate_dominant_color`` keeps a colour once set, so a washed-out HDR
    video rebuilt tonemapped would keep the desaturated one. A colour that
    cannot be sampled again is cleared: the neutral placeholder, not the
    old rendering's.
    """
    thumbnail.dominant_color = None
    calculate_dominant_color(thumbnail)
    if thumbnail.dominant_color is None:
        thumbnail.save(update_fields=["dominant_color"])


def refresh_perceptual_hash(thumbnail: Thumbnail) -> None:
    """Re-read the photo's perceptual hash from the thumbnail just built.

    The scan compares this against the file on disk to tell a rewritten
    file from a replaced one, so a stale value left behind by a rotation
    would cost the photo its faces on the next scan.
    """
    from api.duplicates.perceptual_hash import calculate_hash_from_thumbnail

    big = thumbnail.thumbnail_big
    if not big or not os.path.exists(big.path):
        return
    phash = calculate_hash_from_thumbnail(big.path)
    if not phash:
        return
    thumbnail.photo.perceptual_hash = phash
    thumbnail.photo.save(update_fields=["perceptual_hash"])


def calculate_aspect_ratio(thumbnail: Thumbnail) -> None:
    """Store the big thumbnail's width / height as ``aspect_ratio``."""
    try:
        # Relies on big thumbnail for correct aspect ratio. The thumbnail is
        # a file we generated ourselves, so read its dimensions directly
        # instead of asking the exif service: a photo without an aspect
        # ratio is filtered out of every grid view, and that must not hinge
        # on a sidecar being reachable.
        if not thumbnail.thumbnail_big:
            logger.warning(
                "no big thumbnail for photo %s; skipping aspect ratio",
                thumbnail.photo_id,
            )
            return
        with Image.open(thumbnail.thumbnail_big.path) as img:
            width, height = img.size
        if not height or not width:
            logger.warning(
                "missing dimensions for image %s; skipping aspect ratio",
                thumbnail.thumbnail_big.path,
            )
            return
        thumbnail.aspect_ratio = round(width / height, 2)

        thumbnail.save()
    except Exception:
        logger.exception(
            "could not calculate aspect ratio for image %s",
            thumbnail.thumbnail_big.path,
        )


def calculate_dominant_color(thumbnail: Thumbnail, palette_size: int = 16) -> None:
    """Store the thumbnail's most common colour as ``dominant_color``.

    Kept once set: a colour already stored is not sampled again.
    """
    if thumbnail.dominant_color:
        return
    # A video's square thumbnails are mp4 clips, which PIL cannot open,
    # so videos never got a colour; their big thumbnail is a still.
    source = (
        thumbnail.thumbnail_big
        if thumbnail.photo.video
        else thumbnail.square_thumbnail_small
    )
    try:
        dominant_color = _most_common_color(source.path, palette_size)
    except (OSError, ValueError):
        # No file name (ValueError from .path), no file, not a picture or a
        # truncated one (OSError, PIL's UnidentifiedImageError included).
        dominant_color = None
    if dominant_color is None:
        logger.info("Cannot calculate dominant color %s object", thumbnail)
        return
    # Stored as the text of the RGB list, e.g. "[12, 34, 56]"; the
    # serializers read it back that way.
    thumbnail.dominant_color = str(dominant_color)
    thumbnail.save()


def _most_common_color(path: str, palette_size: int) -> list[int] | None:
    """The RGB of the colour that covers most of the picture at ``path``."""
    with Image.open(path) as img:
        # Resize image to speed up processing
        img.thumbnail((100, 100))

        # Reduce colors (uses k-means internally)
        paletted = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=palette_size)

    # A "P" image has a palette and, with at most palette_size colours, its
    # colour list, counted by palette index.
    palette = paletted.getpalette()
    colors = paletted.getcolors()
    if palette is None or not colors:
        return None
    _, palette_index = max(colors)
    if not isinstance(palette_index, int):
        return None
    return palette[palette_index * 3 : palette_index * 3 + 3]
