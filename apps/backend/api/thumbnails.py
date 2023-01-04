import os
import subprocess

import pyvips
from wand.image import Image

import ownphotos.settings
from api.models.file import is_raw


def createThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    if is_raw(inputPath):
        if "thumbnails_big" in outputPath:
            completePath = os.path.join(
                ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType
            ).strip()
            with Image(filename=inputPath) as img:
                with img.clone() as thumbnail:
                    thumbnail.format = "webp"
                    thumbnail.transform(resize="x" + str(outputHeight))
                    thumbnail.compression_quality = 95
                    thumbnail.auto_orient()
                    thumbnail.save(filename=completePath)
            return completePath
        else:
            bigThumbnailPath = os.path.join(
                ownphotos.settings.MEDIA_ROOT, "thumbnails_big", hash + fileType
            )
            x = pyvips.Image.thumbnail(
                bigThumbnailPath,
                10000,
                height=outputHeight,
                size=pyvips.enums.Size.DOWN,
            )
            completePath = os.path.join(
                ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType
            ).strip()
            x.write_to_file(completePath, Q=95)
        return completePath
    else:
        x = pyvips.Image.thumbnail(
            inputPath, 10000, height=outputHeight, size=pyvips.enums.Size.DOWN
        )
        completePath = os.path.join(
            ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType
        ).strip()
        x.write_to_file(completePath)
        return completePath


def createAnimatedThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    output = os.path.join(
        ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType
    ).strip()
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


def createThumbnailForVideo(inputPath, outputPath, hash, fileType):
    subprocess.call(
        [
            "ffmpeg",
            "-i",
            inputPath,
            "-ss",
            "00:00:00.000",
            "-vframes",
            "1",
            os.path.join(
                ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType
            ).strip(),
        ]
    )


def doesStaticThumbnailExists(outputPath, hash):
    return os.path.exists(
        os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + ".webp").strip()
    )


def doesVideoThumbnailExists(outputPath, hash):
    return os.path.exists(
        os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + ".mp4").strip()
    )
