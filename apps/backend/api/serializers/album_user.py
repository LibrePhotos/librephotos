import logging
import uuid
from datetime import datetime
from typing import Any

from django.db.models import (
    Count,
    DateTimeField,
    Min,
    OuterRef,
    Prefetch,
    QuerySet,
    Subquery,
)
from django.db.models.functions import Coalesce
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.request import Request

from api.albums.member_grants import NOTHING, album_grants
from api.albums.members import MEMBER_SWITCHES
from api.drf.params import JsonBooleanField
from api.drf.request_user import request_user
from api.models import (
    AlbumCollection,
    AlbumRole,
    AlbumUser,
    AlbumUserMember,
    AlbumUserPhoto,
    Photo,
)
from api.models.photo import HEAVY_PHOTO_COLUMNS, visible_photo_q
from api.models.user import User, get_default_public_sharing_settings
from api.photos.selection import build_photo_queryset
from api.serializers.album_date import PublicViewQuery
from api.serializers.fields import (
    OwnedPhotoField,
    loaded,
    loaded_count,
    loaded_list,
    prefetched,
    shared_serializer,
)
from api.serializers.photos import (
    GroupedPhotosSerializer,
    with_photo_summary_relations,
)
from api.serializers.PhotosGroupedByDate import (
    PhotosGroupedByDate,
    filter_photos_by_media_type,
    get_photos_ordered_by_date,
)
from api.serializers.simple import PhotoSuperSimpleSerializer, SimpleUserSerializer
from api.sharing.grants import SUMMARY_FIELDS, GrantLookup, lookup_for, redact

logger = logging.getLogger(__name__)

# Renders a datetime the way every other date in a response is rendered
_DATE_FIELD = serializers.DateTimeField()


def _album_photos(
    serializer: serializers.BaseSerializer, album: AlbumUser
) -> list[Photo]:
    """The album's photos the library lists, newest first, loaded once.

    Only along vouched links (``AlbumUserPhoto.vouched``): the owner's photos
    and those of current contributors (#464). Hidden and trashed photos stay
    out, as on every other album, also for the users it is shared with. Date,
    location and the grid all read this one list, keyed by album because a
    ``many=True`` serializer serves them all.
    """
    cache = serializer.__dict__.setdefault("_album_photos", {})
    if album.pk not in cache:
        links = AlbumUserPhoto.objects.vouched().filter(albumuser=album)
        cache[album.pk] = list(
            with_photo_summary_relations(
                Photo.objects.filter(pk__in=links.values("photo_id"))
                .filter(visible_photo_q())
                .order_by("-exif_timestamp")
            )
        )
    return cache[album.pk]


def _viewer(serializer: serializers.BaseSerializer) -> User | None:
    viewer = getattr(serializer.context.get("request"), "user", None)
    return viewer if isinstance(viewer, User) else None


def _role_in(
    album: AlbumUser, viewer: User | None, members: list[AlbumUserMember]
) -> str:
    """The viewer's role: ``owner``, ``contributor``, ``viewer`` or ``none``."""
    if viewer is None:
        return "none"
    if viewer.pk == album.owner_id:
        return "owner"
    for member in members:
        if member.user_id == viewer.pk:
            return member.role
    return "none"


def _redact_items(
    groups: list[dict[str, Any]],
    album: AlbumUser,
    viewer: User | None,
    library: GrantLookup,
) -> None:
    """Redact, in place, the grid items of photos ``viewer`` does not own.

    Each by what the album shows of it (``api/albums/member_grants``): the
    owner's ceiling and, for a contributor's photo, their own switches. The
    photos of an owner who shares their library with ``viewer`` are already
    redacted by that share (``PhotoSummarySerializer``), which decides.
    """
    items = [
        item
        for group in groups
        for item in group["items"]
        if (viewer is None or item["owner"]["id"] != viewer.pk)
        and library.for_owner(item["owner"]["id"]) is None
    ]
    if not items:
        return
    grants = album_grants(viewer, [item["id"] for item in items], album=album)
    for item in items:
        grant = grants.get(uuid.UUID(str(item["id"])), NOTHING)
        redact(item, SUMMARY_FIELDS, grant)


def _viewer_owns(serializer: serializers.BaseSerializer, album: AlbumUser) -> bool:
    """Whether the serializer's request comes from the album's owner.

    Collections are their owner's private grouping: on an album someone shared
    (or a card rendered without a request) its collections stay out.
    """
    viewer = getattr(serializer.context.get("request"), "user", None)
    return isinstance(viewer, User) and viewer.pk == album.owner_id


class AlbumMemberSerializer(serializers.Serializer[None]):
    """A member of a shared album, their role and how many photos they added."""

    user = SimpleUserSerializer()
    role = serializers.ChoiceField(choices=AlbumRole.choices)
    photo_count = serializers.IntegerField()


class AlbumMemberSwitchesSerializer(serializers.ModelSerializer):
    """A contributor's own switches: what members see of the photos they add."""

    class Meta:
        model = AlbumUserMember
        fields = MEMBER_SWITCHES


class AlbumUserSerializer(serializers.ModelSerializer):
    owner = SimpleUserSerializer(many=False, read_only=True)
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    members = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    my_switches = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()
    public = serializers.SerializerMethodField()
    public_slug = serializers.SerializerMethodField()
    public_expires_at = serializers.SerializerMethodField()
    public_sharing_options = serializers.SerializerMethodField()
    collection_ids = serializers.SerializerMethodField()

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "title",
            "locked",
            "owner",
            "shared_to",
            "date",
            "location",
            "grouped_photos",
            "public",
            "public_slug",
            "public_expires_at",
            "public_sharing_options",
            "collection_ids",
            "members",
            "my_role",
            "my_switches",
            "members_share_location",
            "members_share_faces",
            "members_share_camera_info",
            "members_share_captions",
            "members_share_originals",
        )

    def _members(self, obj: AlbumUser) -> list[AlbumUserMember]:
        cache = self.__dict__.setdefault("_member_cache", {})
        if obj.pk not in cache:
            cache[obj.pk] = list(
                obj.memberships.select_related("user").order_by("user__username")
            )
        return cache[obj.pk]

    @extend_schema_field(AlbumMemberSerializer(many=True))
    def get_members(self, obj: AlbumUser) -> list[dict[str, Any]]:
        """Everyone the album is shared with, by username (#464)."""
        counts = dict(
            AlbumUserPhoto.objects.contributed()
            .filter(albumuser=obj)
            .order_by()
            .values_list("photo__owner_id")
            .annotate(total=Count("pk"))
        )
        rows = [
            {"user": m.user, "role": m.role, "photo_count": counts.get(m.user_id, 0)}
            for m in self._members(obj)
        ]
        return list(
            serializers.ListSerializer(
                child=AlbumMemberSerializer(), instance=rows
            ).data
        )

    @extend_schema_field(
        serializers.ChoiceField(choices=["owner", "contributor", "viewer", "none"])
    )
    def get_my_role(self, obj: AlbumUser) -> str:
        """What the requester may do here; ``none`` through a public link."""
        return _role_in(obj, _viewer(self), self._members(obj))

    @extend_schema_field(AlbumMemberSwitchesSerializer(allow_null=True))
    def get_my_switches(self, obj: AlbumUser) -> dict[str, Any] | None:
        """The requester's own switches as a member; null for the owner."""
        viewer = _viewer(self)
        for member in self._members(obj):
            if viewer is not None and member.user_id == viewer.pk:
                return dict(AlbumMemberSwitchesSerializer(member).data)
        return None

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: AlbumUser) -> list[dict[str, Any]]:
        photos = filter_photos_by_media_type(
            _album_photos(self, obj), self.context.get("request")
        )
        grouped_photos = get_photos_ordered_by_date(photos)
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        res = serializers.ListSerializer(
            child=GroupedPhotosSerializer(),
            instance=grouped_photos,
            context=self.context,
        ).data
        _redact_items(res, obj, _viewer(self), lookup_for(self))
        return res

    def get_location(self, obj: AlbumUser) -> str:
        """Where the album owner's photos were taken, if members may see it."""
        viewer = _viewer(self)
        is_owner = viewer is not None and viewer.pk == obj.owner_id
        if not (is_owner or obj.members_share_location):
            return ""
        for photo in _album_photos(self, obj):
            if photo.owner_id != obj.owner_id:
                continue
            # The reverse one-to-one raises AttributeError when the row is missing.
            search = getattr(photo, "search_instance", None)
            if search and search.search_location:
                return search.search_location
        return ""

    def get_date(self, obj: AlbumUser) -> datetime | str:
        for photo in _album_photos(self, obj):
            if photo.exif_timestamp:
                return photo.exif_timestamp
        return ""

    def get_public(self, obj: AlbumUser) -> bool:
        return bool(getattr(obj, "share", None) and obj.share.enabled)

    def get_public_slug(self, obj: AlbumUser) -> str:
        return getattr(getattr(obj, "share", None), "slug", "") or ""

    def get_public_expires_at(self, obj: AlbumUser) -> datetime | None:
        return getattr(getattr(obj, "share", None), "expires_at", None)

    def get_public_sharing_options(self, obj: AlbumUser) -> dict | None:
        """Return the per-album sharing option overrides (None values = use default)."""
        share = getattr(obj, "share", None)
        if not share:
            return None
        return {
            "share_location": share.share_location,
            "share_camera_info": share.share_camera_info,
            "share_timestamps": share.share_timestamps,
            "share_captions": share.share_captions,
            "share_faces": share.share_faces,
        }

    def get_collection_ids(self, obj: AlbumUser) -> list[int]:
        """The ids of the owner's collections holding the album (#1009); one
        query, as this serializer renders a single album."""
        if not _viewer_owns(self, obj):
            return []
        return sorted(obj.collections.values_list("pk", flat=True))


class AlbumUserEditSerializer(serializers.ModelSerializer):
    photos = OwnedPhotoField(many=True, read_only=False)
    cover_photo = OwnedPhotoField(required=False, allow_null=True)
    removedPhotos = serializers.ListField(
        child=serializers.CharField(max_length=100, default=""),
        write_only=True,
        required=False,
    )
    # Server-side "Select All" payload, mirroring the other bulk endpoints
    # (SetPhotosDeleted, ZipListPhotosView_V2, ...): instead of an explicit
    # `photos` list, `select_all=True` plus a `query` describing the photoset
    # the user is looking at, with optional `excluded_hashes` for unchecked items.
    select_all = serializers.BooleanField(
        write_only=True, required=False, default=False
    )
    query = serializers.DictField(write_only=True, required=False)
    excluded_hashes = serializers.ListField(
        child=serializers.CharField(max_length=100),
        write_only=True,
        required=False,
    )

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "title",
            "photos",
            "created_on",
            "favorited",
            "locked",
            "removedPhotos",
            "cover_photo",
            "select_all",
            "query",
            "excluded_hashes",
        )

    def _resolve_new_photo_pks(self, validated_data: dict[str, Any]) -> list[Any]:
        """Resolve the photos to add: the explicit list, or the select-all query.

        The values are photo primary keys (UUIDs). django-stubs types the
        many-to-many ``add()`` as taking ``Photo | int``, so the list is ``Any``.
        """
        if validated_data.get("select_all"):
            photos = build_photo_queryset(
                request_user(self.context["request"]),
                validated_data.get("query") or {},
            )
            excluded_hashes = validated_data.get("excluded_hashes") or []
            if excluded_hashes:
                photos = photos.exclude(image_hash__in=excluded_hashes)
            return list(photos.values_list("id", flat=True))
        return [photo.id for photo in validated_data.get("photos", [])]

    def create(self, validated_data: dict[str, Any]) -> AlbumUser:
        title = validated_data["title"]

        # AlbumUserEditViewSet runs behind IsAuthenticated.
        user = request_user(self.context["request"])

        # check if an album exists with the given title and call the update method if it does
        # (update() refuses to change a locked album's photos)
        instance, created = AlbumUser.objects.get_or_create(title=title, owner=user)
        if not created:
            return self.update(instance, validated_data)

        photo_pks = self._resolve_new_photo_pks(validated_data)
        if photo_pks:
            instance.photos.add(*photo_pks)
        if "locked" in validated_data:
            instance.locked = validated_data["locked"]
        instance.save()
        logger.info("Created user album %s with %s photos", instance.id, len(photo_pks))
        return instance

    def update(self, instance: AlbumUser, validated_data: dict[str, Any]) -> AlbumUser:
        # A locked album is read-only for its photo set: adding or removing
        # photos is refused unless the same request unlocks it. Renaming, cover
        # changes and toggling the lock itself stay allowed. See issue #867.
        if instance.locked and validated_data.get("locked", True):
            if (
                validated_data.get("removedPhotos")
                or validated_data.get("photos")
                or validated_data.get("select_all")
            ):
                raise serializers.ValidationError(
                    {
                        "locked": "This album is locked. "
                        "Unlock it to add or remove photos."
                    }
                )

        if "locked" in validated_data.keys():
            instance.locked = validated_data["locked"]

        if "title" in validated_data.keys():
            title = validated_data["title"]
            instance.title = title
            logger.info("Renamed user album to %s", title)

        if "removedPhotos" in validated_data.keys():
            image_hashes = validated_data["removedPhotos"]
            photos_already_in_album = instance.photos.all()
            cnt = 0
            for obj in photos_already_in_album:
                if obj.image_hash in image_hashes:
                    cnt += 1
                    instance.photos.remove(obj)

            logger.info("Removed %s photos from user album %s", cnt, instance.id)

        if "cover_photo" in validated_data.keys():
            cover_photo = validated_data["cover_photo"]
            instance.cover_photo = cover_photo
            logger.info("Changed cover photo to %s", cover_photo)

        if "photos" in validated_data.keys() or validated_data.get("select_all"):
            photo_pks = self._resolve_new_photo_pks(validated_data)
            already_in_album = set(instance.photos.values_list("id", flat=True))
            new_pks = [pk for pk in photo_pks if pk not in already_in_album]
            if new_pks:
                instance.photos.add(*new_pks)

            logger.info("Added %s photos to user album %s", len(new_pks), instance.id)

        instance.save()
        return instance


def with_album_user_list_relations(
    queryset: QuerySet[AlbumUser],
) -> QuerySet[AlbumUser]:
    """Load everything ``AlbumUserListSerializer`` reads in a constant number of queries.

    The list serializer renders the album cover, the owner, the users the album
    is shared to, its public-share settings and its photo count. None of those
    are joined by default, so every album on the page cost four extra round
    trips and the cover grid only appeared once the last of them had come back
    (issue #618). The serializer raises on an album that did not come through
    here, so every endpoint rendering an album card passes its albums through.
    """
    # The photos the album detail shows, also for the users it is shared to.
    # A subquery rather than Count("photos"): callers filter on other
    # relations of the album (shared_to), whose join would multiply it.
    # Counted from the photo side, which the type checker can follow.
    links = AlbumUserPhoto.objects.vouched().filter(
        albumuser=OuterRef("pk"), photo__thumbnail__aspect_ratio__isnull=False
    )
    visible_photo_count = (
        links.order_by().values("albumuser").annotate(total=Count("pk")).values("total")
    )
    # When the album's oldest visible photo was taken, for sorting My Albums by
    # date (#620). Over the same photos as the count, so a trashed or hidden
    # photo does not move the album; null when none has a date.
    first_photo_date = (
        links.order_by()
        .values("albumuser")
        .annotate(first=Min("photo__exif_timestamp"))
        .values("first")
    )
    return (
        queryset.annotate(
            photo_count=Coalesce(Subquery(visible_photo_count), 0),
            first_photo_date=Subquery(first_photo_date, output_field=DateTimeField()),
        )
        .select_related("owner", "cover_photo", "share")
        # The cover renders six photo columns; the embedding and EXIF blobs
        # of every album's cover were read for nothing.
        .defer(*(f"cover_photo__{name}" for name in HEAVY_PHOTO_COLUMNS))
        .prefetch_related(
            "shared_to",
            # The roles, for ``my_role`` (#464).
            "memberships",
            # Fallback cover for albums without an explicit one, by pk as the
            # unordered relation's ``.first()`` was. Only a photo the album
            # detail shows, not a hidden or trashed one, and only one of the
            # album owner's: the card is also shown on the public albums page,
            # which never shows a contributor's photo.
            Prefetch(
                "photo_links",
                queryset=AlbumUserPhoto.objects.of_album_owner()
                .filter(photo__thumbnail__aspect_ratio__isnull=False)
                .select_related("photo")
                .defer(*(f"photo__{name}" for name in HEAVY_PHOTO_COLUMNS))
                .order_by("photo_id")[:1],
                to_attr="first_links",
            ),
        )
        # The owner's collections holding the album (#1009); only ids. A call
        # of its own: one list of Prefetch over two models types as object.
        .prefetch_related(
            Prefetch(
                "collections",
                queryset=AlbumCollection.objects.only("id").order_by("pk"),
                to_attr="loaded_collections",
            )
        )
    )


class AlbumUserListSerializer(serializers.ModelSerializer):
    cover_photo = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    first_photo_date = serializers.SerializerMethodField()
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    owner = SimpleUserSerializer(many=False, read_only=True)
    public = serializers.SerializerMethodField()
    public_slug = serializers.SerializerMethodField()
    public_expires_at = serializers.SerializerMethodField()
    public_sharing_options = serializers.SerializerMethodField()
    collection_ids = serializers.SerializerMethodField()

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "cover_photo",
            "created_on",
            "favorited",
            "locked",
            "title",
            "shared_to",
            "owner",
            "photo_count",
            "first_photo_date",
            "public",
            "public_slug",
            "public_expires_at",
            "public_sharing_options",
            "collection_ids",
            "my_role",
        )

    @extend_schema_field(
        serializers.ChoiceField(choices=["owner", "contributor", "viewer", "none"])
    )
    def get_my_role(self, obj: AlbumUser) -> str:
        """What the requester may do in the album (#464)."""
        members = prefetched(obj, "memberships", AlbumUserMember)
        return _role_in(obj, _viewer(self), members)

    @extend_schema_field(PhotoSuperSimpleSerializer(allow_null=True))
    def get_cover_photo(self, obj: AlbumUser) -> dict[str, Any] | None:
        if obj.cover_photo:
            return shared_serializer(
                self, PhotoSuperSimpleSerializer
            ).to_representation(obj.cover_photo)
        # The prefetched fallback cover (``with_album_user_list_relations``).
        first_links = loaded_list(obj, "first_links", AlbumUserPhoto)
        if not first_links:
            # An empty album (#612) has no cover, rather than one with blank fields.
            return None
        return shared_serializer(self, PhotoSuperSimpleSerializer).to_representation(
            first_links[0].photo
        )

    def get_photo_count(self, obj: AlbumUser) -> int:
        return loaded_count(obj, "photo_count")

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_first_photo_date(self, obj: AlbumUser) -> str | None:
        """When the album's oldest visible photo was taken (#620), null for an
        empty album or one whose photos have no date."""
        value = loaded(obj, "first_photo_date")
        if value is None:
            return None
        if not isinstance(value, datetime):
            raise TypeError(f"AlbumUser.first_photo_date is not a date: {value!r}")
        return _DATE_FIELD.to_representation(value)

    def get_public(self, obj: AlbumUser) -> bool:
        return bool(getattr(obj, "share", None) and obj.share.enabled)

    def get_public_slug(self, obj: AlbumUser) -> str:
        return getattr(getattr(obj, "share", None), "slug", "") or ""

    def get_public_expires_at(self, obj: AlbumUser) -> datetime | None:
        return getattr(getattr(obj, "share", None), "expires_at", None)

    def get_public_sharing_options(self, obj: AlbumUser) -> dict | None:
        """Return the per-album sharing option overrides (None values = use default)."""
        share = getattr(obj, "share", None)
        if not share:
            return None
        return {
            "share_location": share.share_location,
            "share_camera_info": share.share_camera_info,
            "share_timestamps": share.share_timestamps,
            "share_captions": share.share_captions,
            "share_faces": share.share_faces,
        }

    def get_collection_ids(self, obj: AlbumUser) -> list[int]:
        """The ids of the owner's collections holding the album (#1009), for
        the owner only (``_viewer_owns``)."""
        if not _viewer_owns(self, obj):
            return []
        return [
            collection.pk
            for collection in loaded_list(obj, "loaded_collections", AlbumCollection)
        ]


def album_user_card(album: AlbumUser, request: Request) -> dict[str, Any]:
    """The card of one album, for a response about it (shared, made public)."""
    loaded_album = with_album_user_list_relations(
        AlbumUser.objects.filter(pk=album.pk)
    ).get()
    return AlbumUserListSerializer(loaded_album, context={"request": request}).data


class AlbumUserPublicSerializer(serializers.ModelSerializer):
    """Serializer for publicly shared user albums.

    Ensures photos are grouped from a filtered subset (not hidden, not in trashcan).
    """

    owner = SimpleUserSerializer(many=False, read_only=True)
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumUser
        # No link settings: an album has no public_slug or public_expires_at
        # attribute, so the fields that used to be listed here were never sent.
        fields = ("id", "title", "owner", "date", "location", "grouped_photos")

    def _filtered_photos(self, obj: AlbumUser) -> list[Photo]:
        # Public albums should not expose hidden or trash photos, and a
        # public link shows the album owner's own photos only: never a
        # contributor's (#464).
        return [p for p in _album_photos(self, obj) if p.owner_id == obj.owner_id]

    def _sharing_settings(self, obj: AlbumUser) -> dict[str, bool]:
        # What the owner chose to publish. The grid used to ignore it and hand
        # every visitor the GPS position, place and capture time of each photo
        # even though location and timestamps are opt-in (all off by default).
        share = getattr(obj, "share", None)
        if share is None:
            return get_default_public_sharing_settings()
        return share.get_effective_sharing_settings()

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: AlbumUser) -> list[dict[str, Any]]:
        sharing = self._sharing_settings(obj)
        photos = filter_photos_by_media_type(
            self._filtered_photos(obj), self.context.get("request")
        )
        if sharing.get("share_timestamps"):
            grouped_photos = get_photos_ordered_by_date(photos)
        else:
            # Day groups would publish the capture date as the group header,
            # so without timestamps everything goes into one undated group.
            photos = list(photos)
            grouped_photos = [PhotosGroupedByDate("", None, photos)] if photos else []
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        groups = serializers.ListSerializer(
            child=GroupedPhotosSerializer(),
            instance=grouped_photos,
            context=self.context,
        ).data
        for group in groups:
            for item in group["items"]:
                if not sharing.get("share_location"):
                    item["exif_gps_lat"] = None
                    item["exif_gps_lon"] = None
                    item["location"] = ""
                if not sharing.get("share_timestamps"):
                    item["date"] = ""
                    item["birthTime"] = ""
        return groups

    def get_location(self, obj: AlbumUser) -> str:
        if not self._sharing_settings(obj).get("share_location"):
            return ""
        for photo in self._filtered_photos(obj):
            # The reverse one-to-one raises AttributeError when the row is missing.
            search = getattr(photo, "search_instance", None)
            if search and search.search_location:
                return search.search_location
        return ""

    def get_date(self, obj: AlbumUser) -> datetime | str:
        if not self._sharing_settings(obj).get("share_timestamps"):
            return ""
        for photo in self._filtered_photos(obj):
            if photo.exif_timestamp:
                return photo.exif_timestamp
        return ""


class SetUserAlbumSharedRequest(serializers.Serializer[None]):
    shared = JsonBooleanField(help_text="true shares, false unshares")
    target_user_id = serializers.IntegerField()
    album_id = serializers.IntegerField()
    role = serializers.ChoiceField(
        choices=AlbumRole.choices,
        required=False,
        help_text=(
            "With shared: what the user may do (#464). Absent keeps a member's "
            "role and makes a new one a viewer. Leaving the contributors takes "
            "the photos they added out of the album."
        ),
    )


class AlbumPhotosAddRequest(serializers.Serializer[None]):
    """Photos of your own to add to an album you own or contribute to (#464)."""

    photos = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        max_length=10000,
        help_text="Ids of your own photos; any other id is refused",
    )
    # Server-side "Select All", as on the other bulk endpoints.
    select_all = JsonBooleanField(required=False, default=False)
    query = serializers.DictField(required=False, default=dict)
    excluded_hashes = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, default=list
    )


class AlbumPhotosRemoveRequest(serializers.Serializer[None]):
    """Photos to take out of an album (#464). They stay in their owner's library."""

    photos = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=10000
    )


class AlbumPhotosChangedSerializer(serializers.Serializer[None]):
    """How many photos a request added to or took out of an album."""

    count = serializers.IntegerField()


class AlbumMembershipRequest(serializers.Serializer[None]):
    """Your own switches in an album shared with you (#464): what the other
    members see of the photos you add. Absent ones are kept."""

    share_location = JsonBooleanField(required=False)
    share_faces = JsonBooleanField(required=False)
    share_camera_info = JsonBooleanField(required=False)
    share_captions = JsonBooleanField(required=False)
    share_originals = JsonBooleanField(required=False)


class LeaveSharedAlbumRequest(serializers.Serializer[None]):
    album_id = serializers.IntegerField(help_text="An album someone shared with you")


class AlbumUserListQuery(serializers.Serializer[None]):
    """My Albums: all of them, or the ones in one collection (#1009)."""

    collection = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Only the albums in this collection of yours",
    )


class AlbumUserQuery(PublicViewQuery):
    """Opening a user album, also through its public link."""

    username = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="With public: the album must be this user's",
    )


class ShareExpiryField(serializers.DateTimeField):
    """An ISO date-time; null or an empty string clears the expiry."""

    def validate_empty_values(self, data: object) -> tuple[bool, object]:
        if data == "":
            return (True, None)
        return super().validate_empty_values(data)


class AlbumSharingOptionsRequest(serializers.Serializer[None]):
    """Per-album overrides of the owner's public sharing defaults.

    Each is true, false or null (use the default); an absent one is kept and
    unknown keys are ignored.
    """

    share_location = JsonBooleanField(required=False, allow_null=True)
    share_camera_info = JsonBooleanField(required=False, allow_null=True)
    share_timestamps = JsonBooleanField(required=False, allow_null=True)
    share_captions = JsonBooleanField(required=False, allow_null=True)
    share_faces = JsonBooleanField(required=False, allow_null=True)


class SetUserAlbumPublicRequest(serializers.Serializer[None]):
    album_id = serializers.IntegerField()
    val_public = JsonBooleanField(help_text="true publishes the link, false revokes it")
    slug = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        trim_whitespace=False,
        help_text="The link's slug (trimmed); blank mints a random one, null keeps it",
    )
    expires_at = ShareExpiryField(
        required=False,
        allow_null=True,
        help_text="When the link expires; null or blank clears it, absent keeps it",
    )
    sharing_options = AlbumSharingOptionsRequest(required=False, allow_null=True)
