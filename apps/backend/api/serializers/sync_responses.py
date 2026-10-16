"""What the delta-sync feeds (``api/views/sync.py``) answer, for the OpenAPI schema.

Each row is built by a ``serialize_*_row`` function in ``api/serializers/sync.py``
and a page by ``BaseSyncView.get``; these serializers only describe them. Times
are integer milliseconds since the epoch (``to_ms``). A cursor older than the
deletion log is a 410 with code ``cursor_expired`` (the error envelope), on
which the mobile app pulls again without a cursor. Issue #485.
"""

from rest_framework import serializers

# A synced photo's kind; "motion" is a photo with an embedded video.
SYNC_MEDIA_TYPES = ("image", "video", "motion")


def _ms(help_text: str = "Milliseconds since the epoch") -> serializers.IntegerField:
    return serializers.IntegerField(help_text=help_text)


def _last_modified() -> serializers.IntegerField:
    return _ms("Milliseconds since the epoch; the feed is ordered by it")


def _photo_ids() -> serializers.ListField:
    return serializers.ListField(
        child=serializers.UUIDField(), help_text="The ids of the album's photos"
    )


def _cover_hashes() -> serializers.ListField:
    return serializers.ListField(
        child=serializers.CharField(),
        help_text="image_hash of the cover photos; [] for places and tags",
    )


class SyncPhotoItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/sync/photos/`` (``serialize_photo_row``)."""

    id = serializers.UUIDField()
    image_hash = serializers.CharField()
    owner_id = serializers.IntegerField()
    timestamp = serializers.IntegerField(
        allow_null=True,
        help_text="When it was taken (exif_timestamp, else timestamp), in "
        "milliseconds since the epoch; null when undated",
    )
    added_on = _ms()
    last_modified = _last_modified()
    type = serializers.ChoiceField(choices=SYNC_MEDIA_TYPES)
    video_length_ms = serializers.IntegerField(
        allow_null=True, help_text="null for a photo, or a video of unknown length"
    )
    rating = serializers.IntegerField()
    is_favorite = serializers.BooleanField(
        help_text="The rating reaches the owner's favorite_min_rating"
    )
    hidden = serializers.BooleanField()
    archived = serializers.BooleanField(
        help_text="Off the timeline and Memories, still in albums and search"
    )
    in_trashcan = serializers.BooleanField()
    removed = serializers.BooleanField()
    is_public = serializers.BooleanField()
    aspect_ratio = serializers.FloatField(
        allow_null=True, help_text="null without a thumbnail"
    )
    latitude = serializers.FloatField(allow_null=True)
    longitude = serializers.FloatField(allow_null=True)
    search_location = serializers.CharField(
        allow_blank=True, help_text='"" without a place name'
    )
    dominant_color = serializers.CharField(
        allow_null=True, help_text="#rrggbb; null without one"
    )


class SyncPersonItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/sync/persons/`` (``serialize_person_row``): only
    the people the user named are mirrored."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    kind = serializers.CharField(help_text='Always "USER"')
    face_count = serializers.IntegerField()
    cover_photo_hash = serializers.CharField(
        allow_null=True, help_text="The cover the user chose; null without one"
    )
    effective_cover_hash = serializers.CharField(
        allow_null=True,
        help_text="The cover the People list shows: the chosen one, else the "
        "first face's photo; null without either",
    )
    last_modified = _last_modified()


class SyncUserAlbumItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/sync/albums/user/`` (``serialize_user_album_row``)."""

    id = serializers.IntegerField()
    title = serializers.CharField()
    owner_id = serializers.IntegerField()
    favorited = serializers.BooleanField()
    shared = serializers.IntegerField(help_text="1 when shared to anyone, else 0")
    cover_hash = serializers.CharField(
        allow_null=True, help_text="The cover photo's image_hash; null without one"
    )
    photo_count = serializers.IntegerField()
    created_on = _ms()
    last_modified = _last_modified()
    photo_ids = _photo_ids()


class SyncAutoAlbumItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/sync/albums/auto/`` (``serialize_auto_album_row``)."""

    id = serializers.IntegerField()
    title = serializers.CharField()
    timestamp = _ms()
    favorited = serializers.BooleanField()
    photo_count = serializers.IntegerField()
    cover_hash = serializers.CharField(
        allow_null=True,
        help_text="The image_hash of the cover the owner picked, else of the "
        "first photo; null for an empty album",
    )
    last_modified = _last_modified()
    photo_ids = _photo_ids()


class SyncNamedAlbumItemSerializer(serializers.Serializer[None]):
    """A row of the thing and tag feeds (``serialize_named_album_row``): the
    list only, without the photos."""

    id = serializers.IntegerField()
    title = serializers.CharField()
    photo_count = serializers.IntegerField()
    cover_hashes = _cover_hashes()
    last_modified = _last_modified()


class SyncPlaceAlbumItemSerializer(SyncNamedAlbumItemSerializer):
    """A row of ``GET /api/sync/albums/place/``."""

    geolocation_level = serializers.IntegerField(allow_null=True)


class SyncSharedUserItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/sync/sharing/`` (``serialize_shared_user_row``): a
    user the requester shares with, or who shares with the requester."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    first_name = serializers.CharField(allow_blank=True)
    last_name = serializers.CharField(allow_blank=True)
    avatar_url = serializers.CharField(
        allow_null=True, help_text="/media/<avatar>; null without one"
    )
    last_modified = _last_modified()


class SyncEnvelopeSerializer(serializers.Serializer[None]):
    """The page envelope every feed shares. A subclass adds ``items``."""

    v = serializers.IntegerField(help_text="The envelope's version, 1")
    tombstones = serializers.ListField(
        child=serializers.CharField(),
        help_text="The ids of rows deleted or no longer visible since the "
        "cursor; [] on a seed pull",
    )
    next_cursor = serializers.CharField(
        allow_null=True,
        help_text="Pass it as cursor for the next page; null once a page is empty",
    )
    total = serializers.IntegerField(
        required=False, help_text="The rows in the feed; only on a seed pull"
    )
    server_time = serializers.DateTimeField()


class SyncPhotosResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/photos/``."""

    items = SyncPhotoItemSerializer(many=True)


class SyncPersonsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/persons/``."""

    items = SyncPersonItemSerializer(many=True)


class SyncUserAlbumsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/albums/user/``."""

    items = SyncUserAlbumItemSerializer(many=True)


class SyncAutoAlbumsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/albums/auto/``."""

    items = SyncAutoAlbumItemSerializer(many=True)


class SyncThingAlbumsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/albums/thing/``."""

    items = SyncNamedAlbumItemSerializer(many=True)


class SyncPlaceAlbumsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/albums/place/``."""

    items = SyncPlaceAlbumItemSerializer(many=True)


class SyncTagAlbumsResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/albums/tag/``."""

    items = SyncNamedAlbumItemSerializer(many=True)


class SyncSharingResponseSerializer(SyncEnvelopeSerializer):
    """A page of ``GET /api/sync/sharing/``."""

    items = SyncSharedUserItemSerializer(many=True)


class SyncCountsSerializer(serializers.Serializer[None]):
    """``GET /api/sync/counts/``: the rows of each feed, for the app's
    integrity check."""

    photos = serializers.IntegerField()
    persons = serializers.IntegerField()
    user_albums = serializers.IntegerField()
    auto_albums = serializers.IntegerField()
    thing_albums = serializers.IntegerField()
    place_albums = serializers.IntegerField()
    tags = serializers.IntegerField()
    server_time = serializers.DateTimeField()
