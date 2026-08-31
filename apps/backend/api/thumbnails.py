import os
import subprocess

import pyvips
import requests
from django.conf import settings

from api import util
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


def _media_path(output_path, hash, file_type):
    return os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)


def _reorient_file_in_place(complete_path, local_orientation):
    if not local_orientation or local_orientation == 1:
        return
    x = pyvips.Image.new_from_file(complete_path)
    x = x.copy_memory()
    x = _apply_local_orientation(x, local_orientation)
    x.write_to_file(complete_path, Q=95)


def _request_raw_thumbnail(input_path, output_height, complete_path, local_orientation):
    json = {
        "source": input_path,
        "destination": complete_path,
        "height": output_height,
    }
    from api.http_timeouts import THUMBNAIL

    response = requests.post(
        "http://localhost:8003/", json=json, timeout=THUMBNAIL
    ).json()
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
    x.write_to_file(complete_path, Q=95)
    return complete_path


def _render_thumbnail(input_path, output_height, complete_path, local_orientation):
    x = pyvips.Image.thumbnail(
        input_path, 10000, height=output_height, size=pyvips.enums.Size.DOWN
    )
    if local_orientation and local_orientation != 1:
        x = x.copy_memory()
        x = _apply_local_orientation(x, local_orientation)
    x.write_to_file(complete_path, Q=95)
    return complete_path


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
            return _request_raw_thumbnail(
                input_path, output_height, complete_path, local_orientation
            )
        return _resize_big_thumbnail(output_height, complete_path, hash, file_type)
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for file {input_path}")
        raise e


def create_animated_thumbnail(input_path, output_height, output_path, hash, file_type):
    try:
        output = os.path.join(settings.MEDIA_ROOT, output_path, hash + file_type)
        command = [
            "ffmpeg",
            "-i",
            input_path,
            "-to",
            "00:00:05",
            "-vcodec",
            "libx264",
            "-crf",
            "20",
            "-an",
            "-filter:v",
            f"scale=-2:{output_height}",
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
            "ffmpeg",
            "-i",
            input_path,
            "-ss",
            "00:00:00.000",
            "-vframes",
            "1",
            output,
        ]

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
