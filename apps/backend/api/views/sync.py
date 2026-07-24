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
from datetime import datetime, timedelta

from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

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
from api.serializers.sync import (
    AUTO_ALBUM_VALUES,
    PERSON_VALUES,
    PHOTO_VALUES,
    SHARED_USER_VALUES,
    USER_ALBUM_VALUES,
    serialize_auto_album_row,
    serialize_named_album_row,
    serialize_person_row,
    serialize_photo_row,
    serialize_shared_user_row,
    serialize_user_album_row,
)

ENVELOPE_VERSION = 1
DEFAULT_PAGE_SIZE = 500
MAX_PAGE_SIZE = 1000


# --------------------------------------------------------------------------- #
# cursor helpers
# --------------------------------------------------------------------------- #
def encode_cursor(last_modified, pk):
    raw = f"{last_modified.isoformat()}|{pk}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor):
    """Return (datetime, pk_str). Raises ValueError on a malformed cursor."""
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    iso, pk = raw.split("|", 1)
    return datetime.fromisoformat(iso), pk


class BaseSyncView(APIView):
    """Template for a single keyset-paginated delta feed."""

    entity = None  # DeletionLog entity string; None disables tombstones
    values_fields = ()
    pk_field = "id"

    # ---- per-entity hooks --------------------------------------------------
    def scoped_queryset(self, user):
        """Model queryset (unordered, unpaginated) of rows this user may see."""
        raise NotImplementedError

    def annotate(self, qs):
        """Optional extra annotations before ``.values()``."""
        return qs

    def serialize_page(self, rows, user):
        raise NotImplementedError

    # ---- shared machinery --------------------------------------------------
    def _materialize(self, qs, limit):
        return list(self.annotate(qs).values(*self.values_fields)[:limit])

    def _apply_keyset(self, qs, cursor_dt, cursor_pk):
        if cursor_dt is None:
            return qs
        return qs.filter(
            Q(last_modified__gt=cursor_dt)
            | (
                Q(last_modified=cursor_dt)
                & Q(**{f"{self.pk_field}__gt": cursor_pk})
            )
        )

    def get_tombstones(self, user, cursor_dt):
        # On a seed pull the client starts empty, so tombstones are irrelevant.
        if self.entity is None or cursor_dt is None:
            return []
        return [
            str(eid)
            for eid in DeletionLog.objects.filter(
                owner=user, entity=self.entity, deleted_at__gt=cursor_dt
            ).values_list("entity_id", flat=True)
        ]

    def get(self, request):
        user = request.user

        cursor = request.GET.get("cursor") or None
        cursor_dt = None
        cursor_pk = None
        if cursor:
            try:
                cursor_dt, cursor_pk = decode_cursor(cursor)
            except (ValueError, binascii.Error, UnicodeDecodeError):
                return Response({"error": "invalid_cursor"}, status=400)
            horizon = timezone.now() - timedelta(days=DeletionLog.PRUNE_HORIZON_DAYS)
            if cursor_dt < horizon:
                return Response({"error": "cursor_expired"}, status=410)

        try:
            page_size = int(request.GET.get("page_size", DEFAULT_PAGE_SIZE))
        except (TypeError, ValueError):
            page_size = DEFAULT_PAGE_SIZE
        page_size = max(1, min(page_size, MAX_PAGE_SIZE))

        qs = self.scoped_queryset(user)
        qs = self._apply_keyset(qs, cursor_dt, cursor_pk)
        qs = qs.order_by("last_modified", self.pk_field)

        rows = self._materialize(qs, page_size)

        items = self.serialize_page(rows, user)

        # ``next_cursor`` is the last returned item's keyset value, so the
        # client can both resume from it and keep looping until a request
        # returns zero items (``next_cursor == null`` => caught up).
        next_cursor = None
        if rows:
            last = rows[-1]
            next_cursor = encode_cursor(last["last_modified"], last[self.pk_field])

        envelope = {
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
class SyncPhotosView(BaseSyncView):
    entity = DeletionLog.ENTITY_PHOTO
    values_fields = PHOTO_VALUES + ("has_motion",)

    def scoped_queryset(self, user):
        return Photo.objects.filter(
            Q(owner=user) | Q(shared_to=user)
        ).distinct()

    def annotate(self, qs):
        motion = File.objects.filter(
            pk=OuterRef("main_file"), embedded_media__isnull=False
        )
        return qs.annotate(has_motion=Exists(motion))

    def serialize_page(self, rows, user):
        return [serialize_photo_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# Persons (only USER-kind are mirrored: the People album grid)
# --------------------------------------------------------------------------- #
class SyncPersonsView(BaseSyncView):
    entity = DeletionLog.ENTITY_PERSON
    values_fields = PERSON_VALUES

    def scoped_queryset(self, user):
        return Person.objects.filter(kind=Person.KIND_USER, cluster_owner=user)

    def serialize_page(self, rows, user):
        return [serialize_person_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# User albums (membership embedded)
# --------------------------------------------------------------------------- #
class SyncUserAlbumsView(BaseSyncView):
    entity = DeletionLog.ENTITY_ALBUM_USER
    values_fields = USER_ALBUM_VALUES

    def scoped_queryset(self, user):
        return AlbumUser.objects.filter(
            Q(owner=user) | Q(shared_to=user)
        ).distinct()

    def serialize_page(self, rows, user):
        ids = [r["id"] for r in rows]
        membership = defaultdict(list)
        through = AlbumUser.photos.through
        for aid, pid in through.objects.filter(
            albumuser_id__in=ids
        ).values_list("albumuser_id", "photo_id"):
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
class SyncAutoAlbumsView(BaseSyncView):
    entity = DeletionLog.ENTITY_ALBUM_AUTO
    values_fields = AUTO_ALBUM_VALUES

    def scoped_queryset(self, user):
        return AlbumAuto.objects.filter(
            Q(owner=user) | Q(shared_to=user)
        ).distinct()

    def serialize_page(self, rows, user):
        ids = [r["id"] for r in rows]
        membership = defaultdict(list)
        through = AlbumAuto.photos.through
        for aid, pid in through.objects.filter(
            albumauto_id__in=ids
        ).values_list("albumauto_id", "photo_id"):
            membership[aid].append(pid)
        # Cover = first member's image_hash. One query for the whole page.
        first_photo = {aid: pids[0] for aid, pids in membership.items() if pids}
        hash_by_id = dict(
            Photo.objects.filter(id__in=first_photo.values()).values_list(
                "id", "image_hash"
            )
        )
        out = []
        for r in rows:
            pids = membership[r["id"]]
            cover = hash_by_id.get(first_photo.get(r["id"]))
            out.append(
                serialize_auto_album_row(r, [str(p) for p in pids], cover)
            )
        return out


# --------------------------------------------------------------------------- #
# Thing / Place / Tag albums (list mirrors, no membership)
# --------------------------------------------------------------------------- #
class SyncThingAlbumsView(BaseSyncView):
    entity = DeletionLog.ENTITY_ALBUM_THING
    values_fields = ("id", "title", "photo_count", "last_modified")

    def scoped_queryset(self, user):
        return AlbumThing.objects.filter(
            Q(owner=user) | Q(shared_to=user)
        ).distinct()

    def serialize_page(self, rows, user):
        ids = [r["id"] for r in rows]
        covers = defaultdict(list)
        through = AlbumThing.cover_photos.through
        for aid, phash in through.objects.filter(
            albumthing_id__in=ids
        ).values_list("albumthing_id", "photo__image_hash"):
            if phash:
                covers[aid].append(phash)
        return [serialize_named_album_row(r, covers[r["id"]]) for r in rows]


class SyncPlaceAlbumsView(BaseSyncView):
    entity = DeletionLog.ENTITY_ALBUM_PLACE
    values_fields = ("id", "title", "geolocation_level", "last_modified")

    def scoped_queryset(self, user):
        return AlbumPlace.objects.filter(
            Q(owner=user) | Q(shared_to=user)
        ).distinct()

    def serialize_page(self, rows, user):
        # AlbumPlace has no stored photo_count column; count membership for the
        # page in one grouped query.
        ids = [r["id"] for r in rows]
        counts = dict(
            AlbumPlace.photos.through.objects.filter(albumplace_id__in=ids)
            .values("albumplace_id")
            .annotate(n=Count("photo_id"))
            .values_list("albumplace_id", "n")
        )
        out = []
        for r in rows:
            r = {**r, "photo_count": counts.get(r["id"], 0)}
            out.append(
                serialize_named_album_row(
                    r, [], extra={"geolocation_level": r["geolocation_level"]}
                )
            )
        return out


class SyncTagAlbumsView(BaseSyncView):
    entity = DeletionLog.ENTITY_TAG
    values_fields = ("id", "title", "photo_count", "last_modified")

    def scoped_queryset(self, user):
        # Tag.name is the title; alias via annotate-free values mapping below.
        return Tag.objects.filter(owner=user)

    def _materialize(self, qs, limit):
        rows = list(
            qs.values("id", "name", "photo_count", "last_modified")[:limit]
        )
        for r in rows:
            r["title"] = r.pop("name")
        return rows

    def serialize_page(self, rows, user):
        return [serialize_named_album_row(r, []) for r in rows]


# --------------------------------------------------------------------------- #
# Sharing surface (shared_user profiles)
# --------------------------------------------------------------------------- #
class SyncSharingView(BaseSyncView):
    entity = None  # user profiles are not tombstoned via DeletionLog
    values_fields = SHARED_USER_VALUES

    def _relevant_user_ids(self, user):
        ids = set()
        # People I share my photos/albums with.
        ids.update(
            Photo.shared_to.through.objects.filter(
                photo__owner=user
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
                model.objects.filter(shared_to=user).values_list(
                    "owner_id", flat=True
                )
            )
        ids.discard(user.id)
        return ids

    def scoped_queryset(self, user):
        return User.objects.filter(id__in=self._relevant_user_ids(user))

    def serialize_page(self, rows, user):
        return [serialize_shared_user_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# Counts (client integrity check, doc 04 §5)
# --------------------------------------------------------------------------- #
class SyncCountsView(APIView):
    def get(self, request):
        user = request.user
        owned_or_shared = Q(owner=user) | Q(shared_to=user)
        return Response(
            {
                "photos": Photo.objects.filter(owned_or_shared).distinct().count(),
                "persons": Person.objects.filter(
                    kind=Person.KIND_USER, cluster_owner=user
                ).count(),
                "user_albums": AlbumUser.objects.filter(owned_or_shared)
                .distinct()
                .count(),
                "auto_albums": AlbumAuto.objects.filter(owned_or_shared)
                .distinct()
                .count(),
                "thing_albums": AlbumThing.objects.filter(owned_or_shared)
                .distinct()
                .count(),
                "place_albums": AlbumPlace.objects.filter(owned_or_shared)
                .distinct()
                .count(),
                "tags": Tag.objects.filter(owner=user).count(),
                "server_time": timezone.now().isoformat(),
            }
        )
