from __future__ import annotations

from django.db import IntegrityError, models, transaction

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
        return self.path

    @staticmethod
    def create(path: str, hash_value: str, file_type: int) -> File:
        """Insert the File row for ``path``; the caller hashed and typed it.

        ``api.photos.media_files.get_or_create_file`` returns the row a path already
        has and calls this only for a new one. Handles race conditions: if
        concurrent creates happen for the same path, only one will succeed
        and the others return the existing row.
        """
        file = File(path=path, hash=hash_value, type=file_type)
        try:
            file.save()
            return file
        except IntegrityError:
            # Race condition: another thread created the file between the
            # caller's check and this save. Try to fetch by path first (unique
            # constraint), then by hash (primary key).
            existing = File.objects.filter(path=path).first()
            if existing:
                return existing
            # If path doesn't exist, hash collision occurred - fetch by hash
            existing = File.objects.filter(hash=file.hash).first()
            if existing:
                return existing
            # Re-raise if we can't find the conflicting record
            raise

    def rekey(self, new_hash: str, file_type: int) -> File:
        """Move this row onto ``new_hash``, carrying its relations across.

        ``file_type`` is the type of the content now on disk
        (``api.photos.media_files.detect_file_type``).

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
                type=file_type,
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
                    photo.save(update_fields=["main_file"])

        return new_file
