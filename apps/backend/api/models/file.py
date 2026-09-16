import hashlib
import os

from django.conf import settings
from django.db import models, transaction

from api import image_decoding, util
from api.mime import sniffed_mime_type

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

    def __str__(self):
        return self.path + " " + self._find_out_type()

    @staticmethod
    def create(path: str, user):
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
        file.hash = calculate_hash(user, path)
        file._find_out_type()

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

    def rekey(self, new_hash: str) -> "File":
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

    def _find_out_type(self):
        self.type = detect_file_type(self.path)
        self.save()


def detect_file_type(path) -> int:
    file_type = File.IMAGE
    if is_raw(path):
        file_type = File.RAW_FILE
    if is_video(path):
        file_type = File.VIDEO
    if is_metadata(path):
        file_type = File.METADATA_FILE
    return file_type


def is_video(path):
    try:
        # Sniffed only: a corrupt file with a video extension must not become a video.
        return (sniffed_mime_type(path) or "").find("video") != -1
    except Exception:
        util.logger.error(f"Error while checking if file is video: {path}")
        return False


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


def is_valid_media(path, user) -> bool:
    if is_video(path=path):
        if not settings.FEATURE_VIDEO:
            util.logger.info(f"Video support is disabled, skipping {path}")
            return False
        return True
    if is_metadata(path=path):
        return True
    if is_raw(path=path):
        return True
    try:
        if image_decoding.can_decode(path):
            return True
        util.logger.info(f"Could not handle {path}: no loader recognises it")
        return False
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
