from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.contrib.auth.models import AnonymousUser
from django.db import models
from django.db.models import F, Q, QuerySet, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from api.models.duplicate import Duplicate
from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.models.scopes import SharedOwnedQuerySet
from api.models.user import User, get_deleted_user

if TYPE_CHECKING:
    from typing import Self


class PhotoQuerySet(SharedOwnedQuerySet["Photo"]):
    """The per-user scopes every view and serializer goes through.

    ``owned_by`` (from ``OwnedQuerySet``) is the write scope and ``visible_to``
    the read scope. Never spell ``owner=request.user`` at a call site.
    """

    def visible_to(self, user: User | AnonymousUser | None) -> Self:
        """Photos ``user`` may read: their own, shared directly to them, public.

        Album shares are resolved by the media views, not here.
        """
        q = Q(public=True)
        if isinstance(user, User) and user.is_authenticated:
            q |= self.owner_q(user) | Q(shared_to=user)
        return self.filter(q)


def highest_resolution_first(photos: QuerySet[Photo]) -> QuerySet[Photo]:
    """``photos`` with the largest ``width * height`` first, unknown sizes last.

    The NULLS LAST is explicit because Postgres puts NULL first in a
    descending sort and SQLite last, so a photo without dimensions won on
    Postgres only (#2251). Equal resolutions go to the larger file, then to
    the lowest id, so the pick is stable.
    """
    return photos.order_by(
        (F("metadata__width") * F("metadata__height")).desc(nulls_last=True),
        F("size").desc(),
        "pk",
    )


def trash_photos(photos: QuerySet[Photo]) -> int:
    """Move ``photos`` to the trash and stamp when (``trashed_at``).

    Every writer of ``in_trashcan`` goes through this or ``restore_photos``,
    so the trash retention (``api.photos.retention.empty_expired_trash``)
    always knows how long a photo has been there. A photo already in the
    trash keeps its date: trashing it again does not restart its retention.
    ``last_modified`` is bumped by hand (a queryset update skips
    ``auto_now``) so the delta-sync feed carries the change. Returns the
    number of rows updated.
    """
    now = timezone.now()
    return photos.update(
        in_trashcan=True,
        trashed_at=Coalesce(F("trashed_at"), Value(now, models.DateTimeField())),
        last_modified=now,
    )


def restore_photos(photos: QuerySet[Photo]) -> int:
    """Take ``photos`` out of the trash and clear ``trashed_at``.

    The counterpart of ``trash_photos``; returns the number of rows updated.
    """
    return photos.update(
        in_trashcan=False, trashed_at=None, last_modified=timezone.now()
    )


# Large per-photo columns that list endpoints never render: defer them when a
# query loads whole photos only to show a cover or a hash.
HEAVY_PHOTO_COLUMNS = ("clip_embeddings", "exif_json", "geolocation_json")


def visible_photo_q(prefix: str = "") -> Q:
    """The photos ``Photo.visible`` keeps, as a ``Q``.

    ``prefix`` reaches them through a relation, e.g. ``"photos__"`` for an
    album's photo count, so a count agrees with the photos the album shows.
    """
    return (
        Q(**{f"{prefix}hidden": False})
        & Q(**{f"{prefix}thumbnail__aspect_ratio__isnull": False})
        & Q(**{f"{prefix}in_trashcan": False})
        & Q(**{f"{prefix}removed": False})
    )


class LocationSource(models.TextChoices):
    """Where a photo's position (``Photo.location_source``) came from."""

    FILE = "file", "File"
    USER = "user", "User"


_PhotoManagerBase = models.Manager.from_queryset(PhotoQuerySet)


class VisiblePhotoManager(_PhotoManagerBase["Photo"]):
    def get_queryset(self) -> QuerySet[Photo]:
        return super().get_queryset().filter(visible_photo_q())


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
    # When a scan or upload last read the file's metadata (EXIF and date) in
    # full. None while a read failed, so the next incremental scan reads the
    # file again instead of skipping it as known and unchanged (#2271).
    metadata_read_at = models.DateTimeField(null=True, blank=True)
    # When face detection last ran on the picture, or failed in a way asking
    # again would not change (#2199). None until then, and again after the
    # file is replaced: an incremental Scan Faces covers exactly those photos.
    faces_scanned_at = models.DateTimeField(null=True, blank=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    # Who set exif_gps_lat/lon (#2264). A scan replaces a position read from
    # the file ("file") when the file changes and clears it when the file's
    # GPS is gone; it never touches one the user set ("user"). NULL: not
    # known (rows from before the column): a scan may replace it, never clear it.
    location_source = models.CharField(
        max_length=8, blank=True, null=True, choices=LocationSource.choices
    )
    # The position geolocation_json was looked up for. The geolocation job
    # picks up every photo whose position differs from it, so a position a
    # scan changed gets its place whenever the photo was added.
    geocoded_lat = models.FloatField(blank=True, null=True)
    geocoded_lon = models.FloatField(blank=True, null=True)
    # The capture time: the wall clock where the photo was taken, tagged UTC.
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)
    # The UTC offset of that wall clock in minutes east of UTC (-420 for
    # UTC-07:00) and the id of the date rule that read it (#2768). NULL where
    # no rule knew the offset, for a date set by hand, and on rows not scanned
    # or re-dated since the columns came.
    exif_timestamp_offset = models.SmallIntegerField(blank=True, null=True)
    exif_timestamp_source = models.IntegerField(blank=True, null=True)

    exif_json = models.JSONField(blank=True, null=True)

    geolocation_json = models.JSONField(blank=True, null=True, db_index=True)

    timestamp = models.DateTimeField(blank=True, null=True, db_index=True)
    rating = models.IntegerField(default=0, db_index=True)
    in_trashcan = models.BooleanField(default=False, db_index=True)
    # When the photo went to the trash; None outside it. Set and cleared only
    # by trash_photos/restore_photos. The trash retention purges by it.
    trashed_at = models.DateTimeField(blank=True, null=True, db_index=True)
    removed = models.BooleanField(default=False, db_index=True)
    hidden = models.BooleanField(default=False, db_index=True)
    # Archived (#545): off the timeline and Memories only. Unlike ``hidden``
    # it is not part of ``visible_photo_q``: an archived photo stays in its
    # albums, people, places, folders and search.
    archived = models.BooleanField(default=False, db_index=True)
    video = models.BooleanField(default=False)
    # Media category flags. ``category_source`` records who set them so a
    # rescan/backfill never clobbers a manual correction: "auto" (detector) or
    # "user" (manually corrected in the UI).
    is_screenshot = models.BooleanField(default=False, db_index=True)
    is_document = models.BooleanField(default=False, db_index=True)
    category_source = models.CharField(max_length=8, default="auto")
    video_length = models.TextField(blank=True, null=True)
    # What ffprobe said about a video's first stream and container, asked once
    # at scan time (see api.video.color.probe). NULL: never probed. "": probed,
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
    # The model behind clip_embeddings (api.search.semantic.OPENCLIP), or an
    # earlier model whose embedding still waits to be re-embedded; NULL for
    # embeddings stored before the column, which are all CLIP ViT-B/32.
    clip_embeddings_model = models.CharField(max_length=32, blank=True, null=True)
    last_modified = models.DateTimeField(auto_now=True)

    # Perceptual hash for duplicate detection (pHash algorithm)
    perceptual_hash = models.CharField(
        max_length=64, blank=True, null=True, db_index=True
    )

    # Organizational photo stacks (RAW+JPEG pairs, bursts, brackets, live photos, manual)
    # A photo can belong to multiple stacks of different types simultaneously
    stacks = models.ManyToManyField(
        PhotoStack,
        blank=True,
        related_name="photos",
    )

    # Duplicate groups (exact copies, visual duplicates)
    # Separate from stacks because duplicates are about cleanup, not organization
    duplicates = models.ManyToManyField(
        Duplicate,
        blank=True,
        related_name="photos",
    )

    # Sub-second timestamp precision for burst detection
    # Stores the fractional seconds from EXIF:SubSecTimeOriginal
    exif_timestamp_subsec = models.CharField(max_length=10, blank=True, null=True)

    # Camera image sequence number (for burst/sequence detection)
    # From EXIF:ImageNumber or MakerNotes
    image_sequence_number = models.IntegerField(blank=True, null=True)

    # User-controlled orientation override, numbered 1–8 like EXIF Orientation
    # (but 6 and 8 render swapped, a turn counter-clockwise for 6, see
    # ``api.thumbnails.render._apply_local_orientation``).
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
            # The date list and the album counts read every photo of the
            # owner with these flags: an index-only scan instead of the wide
            # api_photo heap (from the Rust experiment's date list work).
            models.Index(
                fields=["owner", "id"],
                include=["hidden", "in_trashcan"],
                name="photo_owner_visible_idx",
            ),
        ]

    def get_clip_embeddings(self) -> list[float] | None:
        """Get clip embeddings as a list, regardless of storage format"""
        if not self.clip_embeddings:
            return None

        # Handle case where embeddings might be stored as JSON string
        if isinstance(self.clip_embeddings, str):
            try:
                import json

                return json.loads(self.clip_embeddings)
            except json.JSONDecodeError, TypeError:
                return None

        return self.clip_embeddings

    def __str__(self) -> str:
        main_file_path = (
            self.main_file.path if self.main_file is not None else "No main file"
        )
        return f"{self.image_hash} - {self.owner} - {main_file_path}"
