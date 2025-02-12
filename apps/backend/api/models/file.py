import hashlib
import os
from mmap import ACCESS_READ, mmap

import magic
import pyvips
from django.conf import settings
from django.db import models

from api import util

JPEG_EOI_MARKER = b"\xff\xd9"
GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES = [b"ftypmp42", b"ftypisom", b"ftypiso2"]

# in reality Samsung motion photo marker will look something like this
# ........Image_UTC_Data1458170015363SEFHe...........#...#.......SEFT..0.....MotionPhoto_Data
# but we are interested only in the content of the video which is right after MotionPhoto_Data
SAMSUNG_MOTION_PHOTO_MARKER = b"MotionPhoto_Data"

# Most optimal value for performance/memory. Found here:
# https://stackoverflow.com/questions/17731660/hashlib-optimal-size-of-chunks-to-be-used-in-md5-update
BUFFER_SIZE = 65536


# To-Do: add owner to file
class File(models.Model):
    IMAGE = 1
    VIDEO = 2
    METADATA_FILE = 3
    RAW_FILE = 4
    UNKNOWN = 5

    FILE_TYPES = (
        (IMAGE, "Image"),
        (VIDEO, "Video"),
        (METADATA_FILE, "Metadata File e.g. XMP"),
        (RAW_FILE, "Raw File"),
        (UNKNOWN, "Unknown"),
    )

    hash = models.CharField(primary_key=True, max_length=64, null=False)
    path = models.TextField(blank=True)
    type = models.PositiveIntegerField(
        blank=True,
        choices=FILE_TYPES,
    )
    missing = models.BooleanField(default=False)
    embedded_media = models.ManyToManyField("File")

    def __str__(self):
        return self.path + " " + self._find_out_type()

    @staticmethod
    def create(path: str, user):
        file = File()
        file.path = path
        file.hash = calculate_hash(user, path)
        file._find_out_type()
        file.save()
        return file

    def _find_out_type(self):
        self.type = File.IMAGE
        if is_raw(self.path):
            self.type = File.RAW_FILE
        if is_video(self.path):
            self.type = File.VIDEO
        if is_metadata(self.path):
            self.type = File.METADATA_FILE
        self.save()


def is_video(path):
    try:
        mime = magic.Magic(mime=True)
        filename = mime.from_file(path)
        return filename.find("video") != -1
    except Exception:
        util.logger.error(f"Error while checking if file is video: {path}")
        raise False


def is_raw(path):
    fileextension = os.path.splitext(path)[1]
    rawformats = [
        ".RWZ",
        ".CR2",
        ".NRW",
        ".EIP",
        ".RAF",
        ".ERF",
        ".RW2",
        ".NEF",
        ".ARW",
        ".K25",
        ".DNG",
        ".SRF",
        ".DCR",
        ".RAW",
        ".CRW",
        ".BAY",
        ".3FR",
        ".CS1",
        ".MEF",
        ".ORF",
        ".ARI",
        ".SR2",
        ".KDC",
        ".MOS",
        ".MFW",
        ".FFF",
        ".CR3",
        ".SRW",
        ".RWL",
        ".J6I",
        ".KC2",
        ".X3F",
        ".MRW",
        ".IIQ",
        ".PEF",
        ".CXI",
        ".MDC",
    ]
    return fileextension.upper() in rawformats


def is_metadata(path):
    fileextension = os.path.splitext(path)[1]
    rawformats = [
        ".XMP",
    ]
    return fileextension.upper() in rawformats


def is_valid_media(path):
    if is_video(path) or is_raw(path) or is_metadata(path):
        return True
    try:
        pyvips.Image.thumbnail(path, 10000, height=200, size=pyvips.enums.Size.DOWN)
        return True
    except Exception as e:
        util.logger.info(f"Could not handle {path}, because {str(e)}")
        return False


def calculate_hash(user, path):
    try:
        hash_md5 = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest() + str(user.id)
    except Exception as e:
        util.logger.error(f"Could not calculate hash for file {path}")
        raise e


def calculate_hash_b64(user, content):
    hash_md5 = hashlib.md5()
    with content as f:
        for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)


def _locate_embedded_video_google(data):
    signatures = GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES
    for signature in signatures:
        position = data.find(signature)
        if position != -1:
            return position - 4
    return -1


def _locate_embedded_video_samsung(data):
    position = data.find(SAMSUNG_MOTION_PHOTO_MARKER)
    if position != -1:
        return position + len(SAMSUNG_MOTION_PHOTO_MARKER)
    return -1


def has_embedded_media(file: File) -> bool:
    path = str(file.path)
    mime = magic.Magic(mime=True)
    mime_type = mime.from_file(path)
    if mime_type != "image/jpeg":
        return False
    with open(path, "rb") as image:
        with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
            return (
                _locate_embedded_video_samsung(mm) != -1
                or _locate_embedded_video_google(mm) != -1
            )


def extract_embedded_media(file: File) -> str | None:
    with open(str(file.path), "rb") as image:
        with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
            position = _locate_embedded_video_google(
                mm
            ) or _locate_embedded_video_google(mm)
            if position == -1:
                return None
            output_dir = f"{settings.MEDIA_ROOT}/embedded_media"
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)
            output_path = f"{output_dir}/{file.hash}_1.mp4"
            with open(output_path, "wb+") as video:
                mm.seek(position)
                data = mm.read(mm.size())
                video.write(data)
            return output_path
