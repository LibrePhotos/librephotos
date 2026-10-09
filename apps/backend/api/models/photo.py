import uuid

from django.db import models
from django.db.models import Q

from api import photo_files
from api.metadata.photo_writer import write_orientation_to_disk, write_photo_metadata
from api.models.file import File
from api.models.user import User, get_deleted_user


class PhotoQuerySet(models.QuerySet):
    """The two per-user scopes every view and serializer goes through.

    ``owned_by`` is the write scope and ``visible_to`` the read scope. Spell
    ``owner=request.user`` here, once, rather than at each call site.
    """

    def owned_by(self, user):
        """Photos ``user`` may mutate: their own, and nothing else."""
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        return self.filter(owner=user)

    def visible_to(self, user):
        """Photos ``user`` may read: their own, shared directly to them, public.

        Album shares are resolved by the media views, not here.
        """
        q = Q(public=True)
        if user is not None and getattr(user, "is_authenticated", False):
            q |= Q(owner=user) | Q(shared_to=user)
        return self.filter(q)


class VisiblePhotoManager(models.Manager.from_queryset(PhotoQuerySet)):
    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(
                Q(hidden=False)
                & Q(thumbnail__aspect_ratio__isnull=False)
                & Q(in_trashcan=False)
                & Q(removed=False)
            )
        )


class Photo(models.Model):
    # UUID primary key (like Immich) - enables flexible asset management
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Content hash for deduplication - unique per user
    # Format: MD5 hash + user_id (e.g., "abc123def456...789" + "1")
    image_hash = models.CharField(max_length=64, db_index=True)

    files = models.ManyToManyField(File)
    main_file = models.ForeignKey(
        File,
        related_name="main_photo",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )

    added_on = models.DateTimeField(null=False, blank=False, db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)

    exif_json = models.JSONField(blank=True, null=True)

    geolocation_json = models.JSONField(blank=True, null=True, db_index=True)

    timestamp = models.DateTimeField(blank=True, null=True, db_index=True)
    rating = models.IntegerField(default=0, db_index=True)
    in_trashcan = models.BooleanField(default=False, db_index=True)
    removed = models.BooleanField(default=False, db_index=True)
    hidden = models.BooleanField(default=False, db_index=True)
    video = models.BooleanField(default=False)
    # Media category flags. ``category_source`` records who set them so a
    # rescan/backfill never clobbers a manual correction: "auto" (detector) or
    # "user" (manually corrected in the UI).
    is_screenshot = models.BooleanField(default=False, db_index=True)
    is_document = models.BooleanField(default=False, db_index=True)
    category_source = models.CharField(max_length=8, default="auto")
    video_length = models.TextField(blank=True, null=True)
    # What ffprobe said about a video's first stream and container, asked once
    # at scan time (see api.video_color.probe). NULL: never probed. "": probed,
    # and the file does not say -- an untagged transfer is SDR.
    video_codec = models.CharField(max_length=32, blank=True, null=True)
    video_pixel_format = models.CharField(max_length=32, blank=True, null=True)
    video_color_transfer = models.CharField(max_length=32, blank=True, null=True)
    video_container = models.CharField(max_length=64, blank=True, null=True)
    size = models.BigIntegerField(default=0)
    # Metadata fields (camera, lens, fstop, etc.) moved to PhotoMetadata model
    # See migration 0103_remove_photo_metadata_fields.py

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="photo_shared_to")

    public = models.BooleanField(default=False, db_index=True)

    # Use JSONField for database compatibility (works with both PostgreSQL and SQLite)
    clip_embeddings = models.JSONField(blank=True, null=True)

    clip_embeddings_magnitude = models.FloatField(blank=True, null=True)
    last_modified = models.DateTimeField(auto_now=True)

    # Perceptual hash for duplicate detection (pHash algorithm)
    perceptual_hash = models.CharField(
        max_length=64, blank=True, null=True, db_index=True
    )

    # Organizational photo stacks (RAW+JPEG pairs, bursts, brackets, live photos, manual)
    # A photo can belong to multiple stacks of different types simultaneously
    stacks = models.ManyToManyField(
        "PhotoStack",
        blank=True,
        related_name="photos",
    )

    # Duplicate groups (exact copies, visual duplicates)
    # Separate from stacks because duplicates are about cleanup, not organization
    duplicates = models.ManyToManyField(
        "Duplicate",
        blank=True,
        related_name="photos",
    )

    # Sub-second timestamp precision for burst detection
    # Stores the fractional seconds from EXIF:SubSecTimeOriginal
    exif_timestamp_subsec = models.CharField(max_length=10, blank=True, null=True)

    # Camera image sequence number (for burst/sequence detection)
    # From EXIF:ImageNumber or MakerNotes
    image_sequence_number = models.IntegerField(blank=True, null=True)

    # User-controlled orientation override (EXIF Orientation code 1–8).
    # Stored as the *additional* rotation applied on top of whatever pyvips
    # auto-orientation produces from the file's own EXIF tag.  Defaults to 1
    # (identity – no extra rotation).  The value is updated by the rotate
    # endpoint and is applied when regenerating thumbnails.
    local_orientation = models.IntegerField(default=1)

    objects = PhotoQuerySet.as_manager()
    visible = VisiblePhotoManager()

    class Meta:
        indexes = [
            # Keyset pagination for the delta-sync photo feed (doc 04 §3):
            # WHERE (last_modified, id) > (:c1, :c2) ORDER BY last_modified, id.
            # The UUID pk is the tie-break, same trap as PR #1935.
            models.Index(fields=["last_modified", "id"], name="photo_sync_keyset_idx"),
        ]

    def get_clip_embeddings(self):
        """Get clip embeddings as a list, regardless of storage format"""
        if not self.clip_embeddings:
            return None

        # Handle case where embeddings might be stored as JSON string
        if isinstance(self.clip_embeddings, str):
            try:
                import json

                return json.loads(self.clip_embeddings)
            except (json.JSONDecodeError, TypeError):
                return None

        return self.clip_embeddings

    def set_clip_embeddings(self, embeddings):
        """Set clip embeddings, automatically handling storage format"""
        self.clip_embeddings = embeddings if embeddings else None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # The row as loaded from the database, which save() diffs against to
        # find the fields to write to disk. Per instance: from_db() fills it,
        # and an instance built in memory has nothing to diff against.
        self._loaded_values = {}

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._loaded_values = dict(zip(field_names, values))
        return instance

    def save(
        self,
        force_insert=False,
        force_update=False,
        using=None,
        update_fields=None,
        save_metadata=True,
    ):
        modified_fields = [
            field_name
            for field_name, value in self._loaded_values.items()
            if value != getattr(self, field_name)
        ]
        if save_metadata:
            mode = self.owner.save_metadata_to_disk
            if mode != User.SaveMetadata.OFF:
                self._save_metadata(
                    modified_fields, mode == User.SaveMetadata.SIDECAR_FILE
                )
        return super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )

    def _save_metadata(
        self, modified_fields=None, use_sidecar=True, metadata_types=None
    ):
        """Write metadata tags to the photo's file or sidecar.

        Kept for its many callers; see
        ``api.metadata.photo_writer.write_photo_metadata``.
        """
        write_photo_metadata(
            self,
            modified_fields=modified_fields,
            use_sidecar=use_sidecar,
            metadata_types=metadata_types,
        )

    def manual_delete(self):
        """Delete the files only this photo uses and mark it removed.

        Kept for its many callers; see ``api.photo_files.remove_photo``.
        """
        return photo_files.remove_photo(self)

    def rotate(self, angle: int = 0, flip_horizontal: bool = False) -> None:
        """Rotate the photo non-destructively.

        Updates ``local_orientation`` and regenerates thumbnails.  The original
        file is never modified by this method; the change is stored in the DB
        and reflected in the regenerated thumbnails.

        Optionally writes the combined orientation to the photo's file (or
        sidecar) if the owner has ``save_metadata_to_disk`` enabled.

        Args:
            angle: Clockwise rotation in degrees.  Must be a multiple of 90.
                Use negative values for counter-clockwise rotation (e.g. -90
                for 90° CCW).
            flip_horizontal: If True, apply a horizontal flip on top of the
                rotation.

        Raises:
            ValueError: If ``angle`` is not a multiple of 90.
        """
        angle = int(angle) % 360  # normalise first so -90 → 270, 360 → 0

        if angle % 90 != 0:
            raise ValueError("angle must be a multiple of 90 degrees")

        if angle == 0 and not flip_horizontal:
            return

        from api.util import compose_orientation

        new_orientation = compose_orientation(
            self.local_orientation,
            delta_angle_cw=angle,
            flip_h=flip_horizontal,
        )
        self.local_orientation = new_orientation
        # Bypass _save_metadata – orientation is stored in the DB only for
        # now; writing to disk is handled separately.
        self.save(save_metadata=False)

        # Regenerate thumbnails so the UI sees the updated orientation.
        self.thumbnail._regenerate_thumbnails()

        write_orientation_to_disk(self, angle, flip_horizontal)

    def __str__(self):
        main_file_path = (
            self.main_file.path if self.main_file is not None else "No main file"
        )
        return f"{self.image_hash} - {self.owner} - {main_file_path}"
