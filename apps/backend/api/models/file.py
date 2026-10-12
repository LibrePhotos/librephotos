from __future__ import annotations

import hashlib
import logging
import os

from django.conf import settings
from django.db import models, transaction

from api.mime import (
    IMAGE_EXTENSIONS,
    METADATA_EXTENSIONS,
    RAW_EXTENSIONS,
    VIDEO_EXTENSIONS,
    extension,
    sniffed_mime_type,
)
from api.models.user import User

logger = logging.getLogger(__name__)

# Most optimal value for performance/memory. Found here:
# https://stackoverflow.com/questions/17731660/hashlib-optimal-size-of-chunks-to-be-used-in-md5-update
BUFFER_SIZE = 65536

# A File hash is an MD5 hex digest with the owner's user id appended, so the
# same bytes hash differently for different users.
MD5_HEX_LENGTH = 32


def content_hash(hash_value: str) -> str:
    """The content part of a File hash, without the trailing owner id."""
    return hash_value[:MD5_HEX_LENGTH]


def hash_owner_part(hash_value: str) -> str:
    """The owner id a File hash was calculated for."""
    return hash_value[MD5_HEX_LENGTH:]


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
    path = models.TextField(blank=True, default="", unique=True)
    type = models.PositiveIntegerField(
        blank=True,
        choices=FILE_TYPES,
    )
    missing = models.BooleanField(default=False)
    embedded_media = models.ManyToManyField("self", symmetrical=False)

    def __str__(self) -> str:
        return self.path + " " + self._find_out_type()

    @staticmethod
    def create(path: str, user: User, hash_value: str | None = None) -> File:
        """
        Create or retrieve a File record for the given path.

        Uses get_or_create pattern to handle unique path constraint:
        - If a File with this path already exists, return it
        - If not, create a new File with calculated hash

        Handles race conditions: if concurrent creates happen for the same
        path, only one will succeed and others will return the existing file.

        Note: If file content has changed (different hash), the existing
        File record is returned. Hash updates should be handled separately
        during rescan operations.

        Args:
            path: The file system path to the file
            user: The user who owns this file (used for hash calculation)
            hash_value: ``calculate_hash(user, path)`` when the caller already
                has it; hashing reads the whole file, so it is done only once.

        Returns:
            File: The existing or newly created File instance
        """
        from django.db import IntegrityError

        # Check if a File with this path already exists
        existing = File.objects.filter(path=path).first()
        if existing:
            # The file was flagged missing at some point but is back on disk
            # (e.g. a network share or removable drive that was temporarily
            # unmounted during a scan), so it is not missing anymore.
            if existing.missing and os.path.exists(path):
                existing.missing = False
                existing.save(update_fields=["missing"])
            return existing

        # Create new File
        file = File()
        file.path = path
        file.hash = hash_value or calculate_hash(user, path)
        file.type = detect_file_type(path)

        try:
            file.save()
            return file
        except IntegrityError:
            # Race condition: another thread created the file between our check and save
            # Try to fetch by path first (unique constraint), then by hash (primary key)
            existing = File.objects.filter(path=path).first()
            if existing:
                return existing
            # If path doesn't exist, hash collision occurred - fetch by hash
            existing = File.objects.filter(hash=file.hash).first()
            if existing:
                return existing
            # Re-raise if we can't find the conflicting record
            raise

    def rekey(self, new_hash: str) -> File:
        """Move this row onto ``new_hash``, carrying its relations across.

        The hash is the primary key, so the row has to be recreated rather
        than updated. Everything that pointed at the old row - the photos
        holding it as a variant or as their main file, and its embedded media
        links in both directions - is re-pointed at the new one.

        This is hash bookkeeping only. Whether the picture itself changed, and
        so whether anything derived from it has to be thrown away, is the
        caller's decision.
        """
        from api.models.photo import Photo

        if self.hash == new_hash:
            return self

        variant_of = set(Photo.objects.filter(files=self).values_list("pk", flat=True))
        main_file_of = set(self.main_photo.values_list("pk", flat=True))
        embedded = list(self.embedded_media.all())
        embedded_in = list(File.objects.filter(embedded_media=self))

        with transaction.atomic():
            new_file = File(
                hash=new_hash,
                path=self.path,
                type=detect_file_type(self.path),
                missing=self.missing,
            )
            self.delete()
            new_file.save()

            if embedded:
                new_file.embedded_media.add(*embedded)
            for parent in embedded_in:
                parent.embedded_media.add(new_file)

            for photo in Photo.objects.filter(pk__in=variant_of | main_file_of):
                if photo.pk in variant_of:
                    photo.files.add(new_file)
                if photo.pk in main_file_of:
                    photo.main_file = new_file
                    photo.save(save_metadata=False, update_fields=["main_file"])

        return new_file

    def _find_out_type(self) -> str:
        self.type = detect_file_type(self.path)
        self.save()
        return dict(File.FILE_TYPES)[self.type]


def detect_file_type(path: str) -> int:
    file_type = File.IMAGE
    if is_raw(path):
        file_type = File.RAW_FILE
    if is_video(path):
        file_type = File.VIDEO
    if is_metadata(path):
        file_type = File.METADATA_FILE
    return file_type


def is_video(path: str) -> bool:
    try:
        # Sniffed only: a corrupt file with a video extension must not become a video.
        return (sniffed_mime_type(path) or "").find("video") != -1
    except Exception:
        logger.error("Error while checking if file is video: %s", path)
        return False


def is_raw(path: str) -> bool:
    return extension(path) in RAW_EXTENSIONS


def is_metadata(path: str) -> bool:
    return extension(path) in METADATA_EXTENSIONS


def looks_like_media(path: str) -> bool:
    """Whether ``path`` is meant to be a photo or video, loadable or not.

    True when the extension is a known image, video, RAW or XMP one, or when
    the content sniff says ``image/*`` or ``video/*``. A scan reports a file
    that looks like media but does not load (a corrupt JPEG) as a failure, and
    ignores everything else (``.pp3``, ``.aae``, ``.json``, ``Thumbs.db``).
    """
    if extension(path) in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
        return True
    if is_raw(path) or is_metadata(path):
        return True
    return (sniffed_mime_type(path) or "").startswith(("image/", "video/"))


def is_valid_media(path: str, user: User | None) -> bool:
    if is_video(path=path):
        if not settings.FEATURE_VIDEO:
            logger.info("Video support is disabled, skipping %s", path)
            return False
        return True
    if is_metadata(path=path):
        return True
    if is_raw(path=path):
        return True
    try:
        # Imported here: it loads libvips, Pillow's HEIC/JXL plugins and
        # LibRaw, which the API server never needs.
        from api import image_decoding

        if image_decoding.can_decode(path):
            return True
        logger.info("Could not handle %s: no loader recognises it", path)
        return False
    except Exception as e:
        logger.info("Could not handle %s, because %s", path, str(e))
        return False


def calculate_hash(user: User, path: str) -> str:
    try:
        hash_md5 = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest() + str(user.id)
    except Exception as e:
        logger.error("Could not calculate hash for file %s", path)
        raise e
