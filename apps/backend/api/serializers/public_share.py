"""The answers of the sharing views: album and photo links
(``api/views/public_albums.py``, ``api/views/public_photos.py``) and sharing an
album with a user (``api/views/sharing.py``).

The views build these answers as dicts; the serializers here only describe
them for the OpenAPI schema. The public ones (``PublicAlbumResponse``,
``PublicPhotoDetailResponse``, ``SharedPhotoResponse``) are what an anonymous
visitor holding a link gets, field for field: what the owner's sharing
settings leave out is sent as null, "" or 0, never left out.
"""

from rest_framework import serializers

from api.serializers.album_user import (
    AlbumUserListSerializer,
    AlbumUserPublicSerializer,
)
from api.serializers.photo_metadata import PhotoRightsSerializer
from api.serializers.photos import PublicPhotoDetailSerializer

# Fields of PublicPhotoDetailSerializer a photo link must not hand out: the
# content hash and the hash-addressed /media/ URLs derived from it. The page
# gets slug-scoped media URLs instead, so revoking or replacing the link cuts
# the media off together with the metadata.
HASH_DERIVED_FIELDS = (
    "image_hash",
    "square_thumbnail_url",
    "big_thumbnail_url",
    "small_square_thumbnail_url",
)


class PublicSharingSettingsSerializer(serializers.Serializer[None]):
    """What a link shares: the owner's defaults, then the album's overrides
    (``get_effective_sharing_settings``)."""

    share_location = serializers.BooleanField(help_text="GPS position and place names")
    share_camera_info = serializers.BooleanField(
        help_text="Camera, lens, exposure and size"
    )
    share_timestamps = serializers.BooleanField(help_text="When the photo was taken")
    share_captions = serializers.BooleanField(help_text="Captions")
    share_faces = serializers.BooleanField(help_text="The names of the people")


class PublicAlbumResponseSerializer(serializers.Serializer[None]):
    """``GET /api/public/albums/s/{slug}/``: a public album, for a visitor."""

    results = AlbumUserPublicSerializer()
    sharing_settings = PublicSharingSettingsSerializer()


class PublicPhotoDetailResponseSerializer(serializers.Serializer[None]):
    """``GET /api/public/albums/s/{slug}/photos/{photo_id}/``: one photo of a
    public album, filtered by the album's sharing settings."""

    results = PublicPhotoDetailSerializer()
    sharing_settings = PublicSharingSettingsSerializer()


class SharedPhotoPersonSerializer(serializers.Serializer[None]):
    """A person on a photo link: the name only, no face crop."""

    name = serializers.CharField()


class SharedPhotoSerializer(serializers.Serializer[None]):
    """A photo behind a photo link: what ``PublicPhotoDetailSerializer`` sends,
    without ``HASH_DERIVED_FIELDS`` and with slug-scoped media URLs instead.

    What the owner's settings leave out is null, "" or 0, as in the album's
    photo detail.
    """

    video = serializers.BooleanField()
    exif_timestamp = serializers.DateTimeField(
        allow_null=True, help_text="With share_timestamps"
    )
    exif_gps_lat = serializers.FloatField(
        allow_null=True, help_text="With share_location"
    )
    exif_gps_lon = serializers.FloatField(
        allow_null=True, help_text="With share_location"
    )
    geolocation_json = serializers.DictField(
        allow_null=True, help_text="With share_location"
    )
    search_location = serializers.CharField(help_text="With share_location")
    camera = serializers.CharField(allow_null=True, help_text="With share_camera_info")
    lens = serializers.CharField(allow_null=True, help_text="With share_camera_info")
    focal_length = serializers.FloatField(
        allow_null=True, help_text="With share_camera_info"
    )
    fstop = serializers.FloatField(allow_null=True, help_text="With share_camera_info")
    iso = serializers.IntegerField(allow_null=True, help_text="With share_camera_info")
    shutter_speed = serializers.CharField(
        allow_null=True, help_text="With share_camera_info"
    )
    width = serializers.IntegerField(help_text="With share_camera_info, else 0")
    height = serializers.IntegerField(help_text="With share_camera_info, else 0")
    search_captions = serializers.CharField(help_text="With share_captions")
    captions_json = serializers.DictField(
        help_text='With share_captions, else {"im2txt": ""}'
    )
    people = SharedPhotoPersonSerializer(
        many=True, help_text="With share_faces, else []"
    )
    rights = PhotoRightsSerializer(
        allow_null=True,
        help_text="Copyright, creator and license, when the photo has a license (#425)",
    )
    thumbnail_url = serializers.CharField(
        help_text="The big thumbnail, under the link's slug"
    )
    video_url = serializers.CharField(
        allow_null=True, help_text="The video, under the link's slug; null for a still"
    )
    video_playback_type = serializers.CharField(
        allow_null=True,
        help_text="The canPlayType() argument of a probed video, else null",
    )


class SharedPhotoResponseSerializer(serializers.Serializer[None]):
    """``GET /api/public/photo/{slug}/``: a photo link, for a visitor."""

    results = SharedPhotoSerializer()
    sharing_settings = PublicSharingSettingsSerializer()


class PhotoShareSerializer(serializers.Serializer[None]):
    """A photo's link (``_share_payload``): revoked, it has no slug and no url."""

    enabled = serializers.BooleanField()
    slug = serializers.CharField(allow_null=True)
    url = serializers.CharField(
        allow_null=True, help_text="The page's path, /public/p/{slug}"
    )
    created_at = serializers.DateTimeField(
        required=False, help_text="Only while the link is enabled"
    )


class PhotoShareListItemSerializer(PhotoShareSerializer):
    """One of the caller's live photo links."""

    slug = serializers.CharField()
    url = serializers.CharField(help_text="The page's path, /public/p/{slug}")
    created_at = serializers.DateTimeField()
    photo_id = serializers.UUIDField()
    image_hash = serializers.CharField()


class SetPhotoShareResponseSerializer(serializers.Serializer[None]):
    """``POST /api/photo/share/``: the link after the action."""

    status = serializers.BooleanField(help_text="Always true")
    share = PhotoShareSerializer()


class PhotoShareListSerializer(serializers.Serializer[None]):
    """``GET /api/photo/share/list/``: the caller's live photo links, newest first."""

    results = PhotoShareListItemSerializer(many=True)


class SetUserAlbumPublicResponseSerializer(serializers.Serializer[None]):
    """``POST /api/useralbum/makepublic/``: the album's card with its link settings."""

    status = serializers.BooleanField(help_text="Always true")
    album = AlbumUserListSerializer()
