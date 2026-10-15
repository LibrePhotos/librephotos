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


def hash_for_owner(hash_value: str, owner_id: int | None) -> str:
    """``hash_value``'s content hashed for ``owner_id``: a Photo's image hash.

    A File is shared by every user who scans its path and carries the salt of
    whoever scanned it first, while ``Photo.image_hash`` is unique per user:
    thumbnails and face crops are named after it and the media routes resolve
    it to one row (#1957). A row without an owner gets no salt.
    """
    return content_hash(hash_value) + ("" if owner_id is None else str(owner_id))


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
    # What the scan saw of this media file when it last read it (#2296):
    # the file's ``st_mtime_ns`` and the ``st_mtime_ns`` of each of its XMP
    # sidecars, by normalised file name (``api.photos.indexed_mtimes``).
    # LibrePhotos' own write-back updates them after a write that landed, so
    # an incremental scan does not read the photo again for it. None: not
    # recorded yet (a row from before #2296, a sidecar or a copy's row), the
    # scan compares with the last scan's start instead.
    indexed_mtime_ns = models.BigIntegerField(null=True, blank=True)
    indexed_sidecar_mtimes = models.JSONField(null=True, blank=True)

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
            # An INSERT, never an UPDATE: a row with this hash belongs to an
            # exact copy at another path, and a plain save() would move that
            # row onto this path (#2417). The savepoint keeps a failed INSERT
            # from breaking a transaction the caller has open.
            with transaction.atomic():
                file.save(force_insert=True)
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

    def take_over_copy(self, path: str) -> None:
        """Move this row onto ``path``, an exact copy of its file (#2417).

        For when the row's own path is gone: the photo keeps a file on disk,
        and ``path`` is nobody's copy anymore.
        """
        self.path = path
        self.missing = False
        # What the scan saw describes the old path.
        self.indexed_mtime_ns = None
        self.indexed_sidecar_mtimes = None
        self.save(
            update_fields=[
                "path",
                "missing",
                "indexed_mtime_ns",
                "indexed_sidecar_mtimes",
            ]
        )
        FileCopy.objects.filter(path=path).delete()


class FileCopy(models.Model):
    """A path whose bytes are an exact copy of an indexed File (#2417).

    File rows are keyed by content hash, so a second path with the same bytes
    has no row of its own. Recording it here lets an incremental scan skip it
    like any other known path until it changes on disk, instead of hashing it
    and re-processing its photo on every scan.
    """

    path = models.TextField(unique=True)
    file = models.ForeignKey(File, on_delete=models.CASCADE, related_name="copies")

    def __str__(self) -> str:
        return self.path
