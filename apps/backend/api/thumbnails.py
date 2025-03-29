import os
import subprocess

import pyvips
import requests
from django.conf import settings

from api import util
from api.models.file import is_raw


def create_thumbnail(input_path, output_height, output_path, hash, file_type):
    try:
        if is_raw(input_path):
            if "thumbnails_big" in output_path:
                complete_path = os.path.join(
                    settings.MEDIA_ROOT, output_path, hash + file_type
                ).strip()
                json = {
                    "source": input_path,
                    "destination": complete_path,
                    "height": output_height,
                }
                response = requests.post("http://localhost:8003/", json=json).json()
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
                complete_path = os.path.join(
                    settings.MEDIA_ROOT, output_path, hash + file_type
                ).strip()
                x.write_to_file(complete_path, Q=95)
            return complete_path
        else:
            x = pyvips.Image.thumbnail(
                input_path, 10000, height=output_height, size=pyvips.enums.Size.DOWN
            )
            complete_path = os.path.join(
                settings.MEDIA_ROOT, output_path, hash + file_type
            ).strip()
            x.write_to_file(complete_path, Q=95)
            return complete_path
    except Exception as e:
        util.logger.error(f"Could not create thumbnail for file {input_path}")
        raise e


def create_animated_thumbnail(input_path, output_height, output_path, hash, file_type):
    try:
        output = os.path.join(
            settings.MEDIA_ROOT, output_path, hash + file_type
        ).strip()
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
        ).strip()
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
        os.path.join(settings.MEDIA_ROOT, output_path, hash + ".webp").strip()
    )


def does_video_thumbnail_exist(output_path, hash):
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, output_path, hash + ".mp4").strip()
    )
