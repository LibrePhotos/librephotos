import os
import subprocess

import pyvips
import requests
from django.conf import settings

from api import util
from api.models.file import is_raw


def _apply_local_orientation(image: pyvips.Image, local_orientation: int) -> pyvips.Image:
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
    if local_orientation == 1 or local_orientation is None:
        return image
    if local_orientation == 2:
        return image.flip(pyvips.enums.Direction.HORIZONTAL)
    if local_orientation == 3:
        return image.rot180()
    if local_orientation == 4:
        return image.flip(pyvips.enums.Direction.VERTICAL)
    if local_orientation == 5:
        # 90° CCW + flip H
        return image.rot90().flip(pyvips.enums.Direction.HORIZONTAL)
    if local_orientation == 6:
        # pyvips.rot270() rotates 270° counter-clockwise, which is the same
        # as 90° clockwise — matching EXIF orientation 6 (display: 90° CW).
        return image.rot270()
    if local_orientation == 7:
        # 90° CW + flip H
        return image.rot270().flip(pyvips.enums.Direction.HORIZONTAL)
    if local_orientation == 8:
        # pyvips.rot90() rotates 90° counter-clockwise — matching EXIF
        # orientation 8 (display: 270° CW = 90° CCW).
        return image.rot90()
    return image


def create_thumbnail(
    input_path, output_height, output_path, hash, file_type, local_orientation=1
):
    try:
        if is_raw(input_path):
            if "thumbnails_big" in output_path:
                complete_path = os.path.join(
                    settings.MEDIA_ROOT, output_path, hash + file_type
                )
                json = {
                    "source": input_path,
                    "destination": complete_path,
                    "height": output_height,
                }
                response = requests.post("http://localhost:8003/", json=json).json()
                # The RAW service applies auto-orientation internally.  Apply
                # any user-specified rotation on top.
                if local_orientation and local_orientation != 1:
                    x = pyvips.Image.new_from_file(complete_path)
                    x = x.copy_memory()
                    x = _apply_local_orientation(x, local_orientation)
                    x.write_to_file(complete_path, Q=95)
                return response["thumbnail"]
            else:
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
                complete_path = os.path.join(
                    settings.MEDIA_ROOT, output_path, hash + file_type
                )
                x.write_to_file(complete_path, Q=95)
            return complete_path
        else:
            x = pyvips.Image.thumbnail(
                input_path, 10000, height=output_height, size=pyvips.enums.Size.DOWN
            )
            if local_orientation and local_orientation != 1:
                x = x.copy_memory()
                x = _apply_local_orientation(x, local_orientation)
            complete_path = os.path.join(
                settings.MEDIA_ROOT, output_path, hash + file_type
            )
            x.write_to_file(complete_path, Q=95)
            return complete_path
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for file {input_path}")
        raise e


def create_animated_thumbnail(input_path, output_height, output_path, hash, file_type):
    try:
        output = os.path.join(
            settings.MEDIA_ROOT, output_path, hash + file_type
        )
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
        output = os.path.join(
            settings.MEDIA_ROOT, output_path, hash + file_type
        )
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
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, output_path, hash + ".mp4")
    )
