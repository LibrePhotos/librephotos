import os
import subprocess

import pyvips
import requests
from django.conf import settings

import api.util as util
from api.models.file import is_raw


def createThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    try:
        if is_raw(inputPath):
            if "thumbnails_big" in outputPath:
                completePath = os.path.join(
                    settings.MEDIA_ROOT, outputPath, hash + fileType
                ).strip()
                json = {
                    "source": inputPath,
                    "destination": completePath,
                    "height": outputHeight,
                }
                response = requests.post("http://localhost:8003/", json=json).json()
                return response["thumbnail"]
            else:
                bigThumbnailPath = os.path.join(
                    settings.MEDIA_ROOT, "thumbnails_big", hash + fileType
                )
                x = pyvips.Image.thumbnail(
                    bigThumbnailPath,
                    10000,
                    height=outputHeight,
                    size=pyvips.enums.Size.DOWN,
                )
                completePath = os.path.join(
                    settings.MEDIA_ROOT, outputPath, hash + fileType
                ).strip()
                x.write_to_file(completePath, Q=95)
            return completePath
        else:
            x = pyvips.Image.thumbnail(
                inputPath, 10000, height=outputHeight, size=pyvips.enums.Size.DOWN
            )
            completePath = os.path.join(
                settings.MEDIA_ROOT, outputPath, hash + fileType
            ).strip()
            x.write_to_file(completePath)
            return completePath
    except Exception as e:
        util.logger.error("Could not create thumbnail for file {}".format(inputPath))
        raise e


def createAnimatedThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    try:
        output = os.path.join(settings.MEDIA_ROOT, outputPath, hash + fileType).strip()
        subprocess.call(
            [
                "ffmpeg",
                "-i",
                inputPath,
                "-to",
                "00:00:05",
                "-vcodec",
                "libx264",
                "-crf",
                "20",
                "-an",
                "-filter:v",
                ("scale=-2:" + str(outputHeight)),
                output,
            ]
        )
    except Exception as e:
        util.logger.error(
            "Could not create animated thumbnail for file {}".format(inputPath)
        )
        raise e


def createThumbnailForVideo(inputPath, outputPath, hash, fileType):
    try:
        subprocess.call(
            [
                "ffmpeg",
                "-i",
                inputPath,
                "-ss",
                "00:00:00.000",
                "-vframes",
                "1",
                os.path.join(settings.MEDIA_ROOT, outputPath, hash + fileType).strip(),
            ]
        )
    except Exception as e:
        util.logger.error(
            "Could not create thumbnail for video file {}".format(inputPath)
        )
        raise e


def doesStaticThumbnailExists(outputPath, hash):
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, outputPath, hash + ".webp").strip()
    )


def doesVideoThumbnailExists(outputPath, hash):
    return os.path.exists(
        os.path.join(settings.MEDIA_ROOT, outputPath, hash + ".mp4").strip()
    )
