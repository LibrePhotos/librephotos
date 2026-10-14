"""Mobile-v2 delta-sync endpoints (doc 04 §3-§5).

Keyset-paginated pull feeds + a merged tombstone log, one endpoint per entity,
uniform envelope::

    {
      "v": 1,
      "items": [ ...flat summary rows... ],
      "tombstones": [ "id", ... ],
      "next_cursor": "<b64>" | null,   # null => caught up (stop looping)
      "total": 123,                    # only on the seed request (no cursor)
      "server_time": "<iso>"
    }
    410 { "error": "cursor_expired" } # cursor older than the tombstone horizon

The client persists its durable cursor as the ``(last_modified, id)`` of the
last item it has applied; ``next_cursor`` is only a loop-continuation token.
"""

import base64
import binascii
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, Generic, TypeVar
from uuid import UUID

from django.db import models
from django.db.models import Count, Exists, OuterRef, Q, QuerySet, Subquery
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Gone
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models import (
    AlbumAuto,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    DeletionLog,
    File,
    Person,
    Photo,
    Tag,
    User,
)
from api.serializers.person import first_face_of_person
from api.serializers.sync import (
    AUTO_ALBUM_VALUES,
    PERSON_VALUES,
    PHOTO_VALUES,
    SHARED_USER_VALUES,
    USER_ALBUM_VALUES,
    SyncQuery,
    serialize_auto_album_row,
    serialize_named_album_row,
    serialize_person_row,
    serialize_photo_row,
    serialize_shared_user_row,
    serialize_user_album_row,
)
from api.serializers.sync_responses import (
    SyncAutoAlbumsResponseSerializer,
    SyncCountsSerializer,
    SyncPersonsResponseSerializer,
    SyncPhotosResponseSerializer,
    SyncPlaceAlbumsResponseSerializer,
    SyncSharingResponseSerializer,
    SyncTagAlbumsResponseSerializer,
    SyncThingAlbumsResponseSerializer,
    SyncUserAlbumsResponseSerializer,
)

ENVELOPE_VERSION = 1

# One ``.values()`` row of a feed.
Row = dict[str, Any]

ModelT = TypeVar("ModelT", bound=models.Model)
ViewT = TypeVar("ViewT", bound=APIView)


# --------------------------------------------------------------------------- #
# cursor helpers
# --------------------------------------------------------------------------- #
def encode_cursor(last_modified: datetime, pk: object) -> str:
    raw = f"{last_modified.isoformat()}|{pk}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def sync_feed(
    page: type[serializers.Serializer[None]], description: str
) -> Callable[[type[ViewT]], type[ViewT]]:
    """Declare a feed's GET: the cursor parameters and its page envelope."""
    return extend_schema_view(
        get=extend_schema(
            parameters=[SyncQuery], responses=page, description=description
        )
    )


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    """Return (datetime, pk_str). Raises ValueError on a malformed cursor."""
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    iso, pk = raw.split("|", 1)
    return datetime.fromisoformat(iso), pk


class BaseSyncView(APIView, Generic[ModelT]):
    """Template for a single keyset-paginated delta feed."""

    permission_classes = (IsAuthenticated,)

    entity: str | None = None  # DeletionLog entity string; None disables tombstones
    values_fields: tuple[str, ...] = ()
    pk_field: str = "id"

    # ---- per-entity hooks --------------------------------------------------
    def scoped_queryset(self, user: User) -> QuerySet[ModelT]:
        """Model queryset (unordered, unpaginated) of rows this user may see."""
        raise NotImplementedError

    def annotate(self, qs: QuerySet[ModelT], user: User) -> QuerySet[ModelT]:
        """Optional extra annotations before ``.values()``."""
        return qs

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        raise NotImplementedError

    # ---- shared machinery --------------------------------------------------
    def _materialize(self, qs: QuerySet[ModelT], limit: int, user: User) -> list[Row]:
        return list(self.annotate(qs, user).values(*self.values_fields)[:limit])

    def _apply_keyset(
        self,
        qs: QuerySet[ModelT],
        cursor_dt: datetime | None,
        cursor_pk: str | None,
    ) -> QuerySet[ModelT]:
        if cursor_dt is None:
            return qs
        return qs.filter(
            Q(last_modified__gt=cursor_dt)
            | (Q(last_modified=cursor_dt) & Q(**{f"{self.pk_field}__gt": cursor_pk}))
        )

    def get_tombstones(self, user: User, cursor_dt: datetime | None) -> list[str]:
        # On a seed pull the client starts empty, so tombstones are irrelevant.
        if self.entity is None or cursor_dt is None:
            return []
        return [
            str(eid)
            for eid in DeletionLog.objects.owned_by(user)
            .filter(entity=self.entity, deleted_at__gt=cursor_dt)
            .values_list("entity_id", flat=True)
        ]

    def get(self, request: Request) -> Response:
        user = request_user(request)

        params = parse_query(request, SyncQuery)
        cursor = params.get("cursor") or None
        cursor_dt = None
        cursor_pk = None
        if cursor:
            try:
                cursor_dt, cursor_pk = decode_cursor(cursor)
            except (ValueError, binascii.Error, UnicodeDecodeError) as error:
                raise ValidationError(
                    {"cursor": "The sync cursor is not valid."}, code="invalid_cursor"
                ) from error
            horizon = timezone.now() - timedelta(days=DeletionLog.PRUNE_HORIZON_DAYS)
            if cursor_dt < horizon:
                # The mobile app re-seeds on this 410.
                raise Gone(
                    "The sync cursor is older than the deletion log; pull again "
                    "without a cursor.",
                    code="cursor_expired",
                )

        page_size = params["page_size"]

        qs = self.scoped_queryset(user)
        qs = self._apply_keyset(qs, cursor_dt, cursor_pk)
        qs = qs.order_by("last_modified", self.pk_field)

        rows = self._materialize(qs, page_size, user)

        items = self.serialize_page(rows, user)

        # ``next_cursor`` is the last returned item's keyset value, so the
        # client can both resume from it and keep looping until a request
        # returns zero items (``next_cursor == null`` => caught up).
        next_cursor = None
        if rows:
            last = rows[-1]
            next_cursor = encode_cursor(last["last_modified"], last[self.pk_field])

        envelope: dict[str, object] = {
            "v": ENVELOPE_VERSION,
            "items": items,
            "tombstones": self.get_tombstones(user, cursor_dt),
            "next_cursor": next_cursor,
            "server_time": timezone.now().isoformat(),
        }
        if cursor is None:
            envelope["total"] = self.scoped_queryset(user).count()
        return Response(envelope)


# --------------------------------------------------------------------------- #
# Photos
# --------------------------------------------------------------------------- #
@sync_feed(
    SyncPhotosResponseSerializer,
    "The requester's photos and the photos shared to them.",
)
class SyncPhotosView(BaseSyncView[Photo]):
    entity = DeletionLog.ENTITY_PHOTO
    values_fields = PHOTO_VALUES + ("has_motion",)

    def scoped_queryset(self, user: User) -> QuerySet[Photo]:
        return Photo.objects.owned_or_shared_to(user)

    def annotate(self, qs: QuerySet[Photo], user: User) -> QuerySet[Photo]:
        motion = File.objects.filter(
            pk=OuterRef("main_file"), embedded_media__isnull=False
        )
        return qs.annotate(has_motion=Exists(motion))

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        return [serialize_photo_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# Persons (only USER-kind are mirrored: the People album grid)
# --------------------------------------------------------------------------- #
@sync_feed(SyncPersonsResponseSerializer, "The people the requester named.")
class SyncPersonsView(BaseSyncView[Person]):
    entity = DeletionLog.ENTITY_PERSON
    values_fields = PERSON_VALUES + ("first_face_photo_hash",)

    def scoped_queryset(self, user: User) -> QuerySet[Person]:
        return Person.objects.owned_by(user).filter(kind=Person.KIND_USER)

    def annotate(self, qs: QuerySet[Person], user: User) -> QuerySet[Person]:
        # The People list's cover fallback, for ``effective_cover_hash``.
        first_face = first_face_of_person(user)
        return qs.annotate(
            first_face_photo_hash=Subquery(first_face.values("photo__image_hash")[:1])
        )

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        return [serialize_person_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# User albums (membership embedded)
# --------------------------------------------------------------------------- #
@sync_feed(
    SyncUserAlbumsResponseSerializer,
    "The requester's albums and the albums shared to them, with their photos.",
)
class SyncUserAlbumsView(BaseSyncView[AlbumUser]):
    entity = DeletionLog.ENTITY_ALBUM_USER
    values_fields = USER_ALBUM_VALUES

    def scoped_queryset(self, user: User) -> QuerySet[AlbumUser]:
        return AlbumUser.objects.owned_or_shared_to(user)

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        ids = [r["id"] for r in rows]
        membership: defaultdict[int, list[str]] = defaultdict(list)
        through = AlbumUser.photos.through
        for aid, pid in through.objects.filter(albumuser_id__in=ids).values_list(
            "albumuser_id", "photo_id"
        ):
            membership[aid].append(str(pid))
        shared_ids = set(
            AlbumUser.shared_to.through.objects.filter(
                albumuser_id__in=ids
            ).values_list("albumuser_id", flat=True)
        )
        return [
            serialize_user_album_row(r, membership[r["id"]], r["id"] in shared_ids)
            for r in rows
        ]


# --------------------------------------------------------------------------- #
# Auto albums (membership embedded)
# --------------------------------------------------------------------------- #
@sync_feed(SyncAutoAlbumsResponseSerializer, "The event albums, with their photos.")
class SyncAutoAlbumsView(BaseSyncView[AlbumAuto]):
    entity = DeletionLog.ENTITY_ALBUM_AUTO
    values_fields = AUTO_ALBUM_VALUES

    def scoped_queryset(self, user: User) -> QuerySet[AlbumAuto]:
        return AlbumAuto.objects.owned_or_shared_to(user)

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        ids = [r["id"] for r in rows]
        membership: defaultdict[int, list[UUID]] = defaultdict(list)
        through = AlbumAuto.photos.through
        for aid, pid in through.objects.filter(albumauto_id__in=ids).values_list(
            "albumauto_id", "photo_id"
        ):
            membership[aid].append(pid)
        # Cover = first member's image_hash. One query for the whole page.
        first_photo = {aid: pids[0] for aid, pids in membership.items() if pids}
        hash_by_id = dict(
            Photo.objects.filter(id__in=first_photo.values()).values_list(
                "id", "image_hash"
            )
        )
        out: list[Row] = []
        for r in rows:
            pids = membership[r["id"]]
            first_pid = first_photo.get(r["id"])
            cover = hash_by_id.get(first_pid) if first_pid is not None else None
            out.append(serialize_auto_album_row(r, [str(p) for p in pids], cover))
        return out


# --------------------------------------------------------------------------- #
# Thing / Place / Tag albums (list mirrors, no membership)
# --------------------------------------------------------------------------- #
@sync_feed(SyncThingAlbumsResponseSerializer, "The thing albums, without their photos.")
class SyncThingAlbumsView(BaseSyncView[AlbumThing]):
    entity = DeletionLog.ENTITY_ALBUM_THING
    values_fields = ("id", "title", "photo_count", "last_modified")

    def scoped_queryset(self, user: User) -> QuerySet[AlbumThing]:
        return AlbumThing.objects.owned_or_shared_to(user)

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        ids = [r["id"] for r in rows]
        covers: defaultdict[int, list[str]] = defaultdict(list)
        through = AlbumThing.cover_photos.through
        for aid, phash in through.objects.filter(albumthing_id__in=ids).values_list(
            "albumthing_id", "photo__image_hash"
        ):
            if phash:
                covers[aid].append(phash)
        return [serialize_named_album_row(r, covers[r["id"]]) for r in rows]


@sync_feed(SyncPlaceAlbumsResponseSerializer, "The place albums, without their photos.")
class SyncPlaceAlbumsView(BaseSyncView[AlbumPlace]):
    entity = DeletionLog.ENTITY_ALBUM_PLACE
    values_fields = ("id", "title", "geolocation_level", "last_modified")

    def scoped_queryset(self, user: User) -> QuerySet[AlbumPlace]:
        return AlbumPlace.objects.owned_or_shared_to(user)

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        # AlbumPlace has no stored photo_count column; count membership for the
        # page in one grouped query.
        ids = [r["id"] for r in rows]
        grouped = (
            AlbumPlace.photos.through.objects.filter(albumplace_id__in=ids)
            .values("albumplace_id")
            .annotate(n=Count("photo_id"))
        )
        counts = {row["albumplace_id"]: row["n"] for row in grouped}
        out: list[Row] = []
        for r in rows:
            r = {**r, "photo_count": counts.get(r["id"], 0)}
            out.append(
                serialize_named_album_row(
                    r, [], extra={"geolocation_level": r["geolocation_level"]}
                )
            )
        return out


@sync_feed(
    SyncTagAlbumsResponseSerializer, "The requester's tags, without their photos."
)
class SyncTagAlbumsView(BaseSyncView[Tag]):
    entity = DeletionLog.ENTITY_TAG
    values_fields = ("id", "title", "photo_count", "last_modified")

    def scoped_queryset(self, user: User) -> QuerySet[Tag]:
        # Tag.name is the title; alias via annotate-free values mapping below.
        return Tag.objects.owned_by(user)

    def _materialize(self, qs: QuerySet[Tag], limit: int, user: User) -> list[Row]:
        fields = ("id", "name", "photo_count", "last_modified")
        rows: list[Row] = list(qs.values(*fields)[:limit])
        for r in rows:
            r["title"] = r.pop("name")
        return rows

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        return [serialize_named_album_row(r, []) for r in rows]


# --------------------------------------------------------------------------- #
# Sharing surface (shared_user profiles)
# --------------------------------------------------------------------------- #
@sync_feed(
    SyncSharingResponseSerializer,
    "The users the requester shares with, and those who share with the requester.",
)
class SyncSharingView(BaseSyncView[User]):
    entity = None  # user profiles are not tombstoned via DeletionLog
    values_fields = SHARED_USER_VALUES

    def _relevant_user_ids(self, user: User) -> set[int]:
        ids: set[int] = set()
        # People I share my photos/albums with.
        ids.update(
            Photo.shared_to.through.objects.filter(
                Photo.objects.owner_q(user, through="photo__")
            ).values_list("user_id", flat=True)
        )
        for through, owner_lookup in (
            (AlbumUser.shared_to.through, "albumuser__owner"),
            (AlbumAuto.shared_to.through, "albumauto__owner"),
            (AlbumThing.shared_to.through, "albumthing__owner"),
            (AlbumPlace.shared_to.through, "albumplace__owner"),
        ):
            ids.update(
                through.objects.filter(**{owner_lookup: user}).values_list(
                    "user_id", flat=True
                )
            )
        # People who share their photos/albums with me.
        ids.update(
            Photo.objects.filter(shared_to=user).values_list("owner_id", flat=True)
        )
        for model in (AlbumUser, AlbumAuto, AlbumThing, AlbumPlace):
            ids.update(
                model.objects.filter(shared_to=user).values_list("owner_id", flat=True)
            )
        ids.discard(user.id)
        return ids

    def scoped_queryset(self, user: User) -> QuerySet[User]:
        return User.objects.filter(id__in=self._relevant_user_ids(user))

    def serialize_page(self, rows: list[Row], user: User) -> list[Row]:
        return [serialize_shared_user_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# Counts (client integrity check, doc 04 §5)
# --------------------------------------------------------------------------- #
class SyncCountsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=SyncCountsSerializer)
    def get(self, request: Request) -> Response:
        user = request_user(request)
        return Response(
            {
                "photos": Photo.objects.owned_or_shared_to(user).count(),
                "persons": Person.objects.owned_by(user)
                .filter(kind=Person.KIND_USER)
                .count(),
                "user_albums": AlbumUser.objects.owned_or_shared_to(user).count(),
                "auto_albums": AlbumAuto.objects.owned_or_shared_to(user).count(),
                "thing_albums": AlbumThing.objects.owned_or_shared_to(user).count(),
                "place_albums": AlbumPlace.objects.owned_or_shared_to(user).count(),
                "tags": Tag.objects.owned_by(user).count(),
                "server_time": timezone.now().isoformat(),
            }
        )
