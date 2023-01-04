import hashlib
import os

import magic
import pyvips
from django.db import models

import api.util as util


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
    path = models.TextField(blank=True, null=True)
    type = models.PositiveIntegerField(blank=True,
        choices=FILE_TYPES,
    )
    missing = models.BooleanField(default=False)

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
    mime = magic.Magic(mime=True)
    filename = mime.from_file(path)
    return filename.find("video") != -1

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
        pyvips.Image.thumbnail(
            path, 10000, height=200, size=pyvips.enums.Size.DOWN
        )
        return True
    except Exception as e:
        util.logger.info("Could not handle {}, because {}".format(path, str(e)))
        return False

def calculate_hash(user, path):
    hash_md5 = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)


def calculate_hash_b64(user, content):
    hash_md5 = hashlib.md5()
    with content as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)
