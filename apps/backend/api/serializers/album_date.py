from django.db.models import Prefetch, QuerySet
from drf_spectacular.utils import extend_schema_field
from rest_framework import ISO_8601, serializers

from api.drf.params import TristateFlagField
from api.models import AlbumDate, Photo
from api.models.place_names import town_name
from api.serializers.photos import PhotoSummarySerializer

PUBLIC_PHOTOS_ATTR = "public_photos"


def _public_photos() -> QuerySet[Photo]:
    return (
        Photo.objects.filter(
            public=True, hidden=False, in_trashcan=False, removed=False
        )
        .only("id", "geolocation_json", "exif_timestamp")
        .order_by("exif_timestamp", "id")
    )


def prefetch_public_photos() -> Prefetch:
    """Prefetch for ``IncompleteAlbumDateSerializer`` in the public view."""
    return Prefetch("photos", queryset=_public_photos(), to_attr=PUBLIC_PHOTOS_ATTR)


def _stored_place(obj: AlbumDate) -> str:
    if obj.location:
        return obj.location["places"][0]
    return ""


def _public_place(obj: AlbumDate) -> str:
    """The day's place as its public photos tell it.

    ``AlbumDate.location`` collects the city of every photo of the day,
    private ones included, so the public view must not show it. The town is
    picked the way the geocoder picks it (``add_location_to_album_dates``).
    """
    photos = getattr(obj, PUBLIC_PHOTOS_ATTR, None)
    if photos is None:
        photos = _public_photos().filter(albumdate=obj)
    for photo in photos:
        name = town_name(photo.geolocation_json)
        if name:
            return name
    return ""


def _place(serializer: serializers.BaseSerializer, obj: AlbumDate) -> str:
    if serializer.context.get("public"):
        return _public_place(obj)
    return _stored_place(obj)


class IncompleteAlbumDateSerializer(serializers.ModelSerializer):
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    incomplete = serializers.SerializerMethodField()
    numberOfItems = serializers.SerializerMethodField("get_number_of_items")
    items = serializers.SerializerMethodField()

    class Meta:
        model = AlbumDate
        fields = ("id", "date", "location", "incomplete", "numberOfItems", "items")

    def get_date(self, obj: AlbumDate) -> str | None:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    def get_items(self, obj: AlbumDate) -> list:
        return []

    def get_incomplete(self, obj: AlbumDate) -> bool:
        return True

    def get_number_of_items(self, obj: AlbumDate) -> int:
        # photo_count is annotated by the album list's queryset; not a model field.
        photo_count: int = getattr(obj, "photo_count")
        if photo_count:
            return photo_count
        else:
            return 0

    def get_location(self, obj: AlbumDate) -> str:
        return _place(self, obj)


class AlbumDateSerializer(serializers.ModelSerializer):
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    incomplete = serializers.SerializerMethodField()
    numberOfItems = serializers.SerializerMethodField("get_number_of_items")
    items = serializers.SerializerMethodField()

    class Meta:
        model = AlbumDate
        fields = ("id", "date", "location", "incomplete", "numberOfItems", "items")

    def get_date(self, obj: AlbumDate) -> str | None:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    # AlbumDateViewSet.retrieve fills both in after serializing (a page of
    # photo summaries and their count), so the schema names those types: the
    # annotations alone are None, which drf-spectacular cannot map.
    @extend_schema_field(PhotoSummarySerializer(many=True))
    def get_items(self, obj: AlbumDate) -> None:
        # This method is removed as we're directly including paginated photos in the response.
        pass

    def get_incomplete(self, obj: AlbumDate) -> bool:
        return False

    @extend_schema_field(int)
    def get_number_of_items(self, obj: AlbumDate) -> None:
        # this will also get added in the response
        pass

    def get_location(self, obj: AlbumDate) -> str:
        return _place(self, obj)


class PublicViewQuery(serializers.Serializer[None]):
    """Whether a date-album or user-album read is the public view.

    ``public`` opens the read to anonymous callers and scopes it to public
    photos (or to the album's public link). It used to be read by truthiness,
    so ``?public=false`` opened the public view too; a false word is false now
    and any other value than a boolean spelling is a 400.
    """

    public = serializers.BooleanField(
        default=False, help_text="The public view: public photos of any user"
    )


class DateAlbumFilterQuery(PublicViewQuery):
    """The filters ``/api/albums/date/list/`` and ``/api/albums/date/<id>/`` take.

    A blank parameter counts as absent. The media filters (``media`` down to
    ``apply_default``) are resolved by ``api.albums.timeline_filter``.
    """

    username = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="With public: only this user's public photos",
    )
    hidden = serializers.BooleanField(
        default=False, help_text="Hidden photos instead of the visible ones"
    )
    in_trashcan = serializers.BooleanField(
        default=False, help_text="Photos in the trash (not yet removed)"
    )
    show_all_stack_photos = serializers.BooleanField(
        default=False, help_text="Also the photos of a stack that are not its primary"
    )
    folder = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="Only photos with a file under this folder",
    )
    person = serializers.IntegerField(
        required=False, help_text="Only photos showing this person"
    )
    last_modified = serializers.DateTimeField(
        required=False,
        input_formats=[ISO_8601, "%Y-%m-%d"],
        help_text="A date or date-time. For the owner it replaces every other "
        "filter; with public it narrows the public photos.",
    )
    media = serializers.CharField(
        required=False, allow_blank=True, help_text="all, photos or videos"
    )
    video = TristateFlagField(help_text="Only videos (false: no videos)")
    photo = TristateFlagField(help_text="Only photos (false: no photos)")
    favorite = TristateFlagField(
        help_text="Only favorites (false turns a saved favorites default off)"
    )
    is_screenshot = TristateFlagField(
        help_text="Only screenshots (false: no screenshots)"
    )
    is_document = TristateFlagField(help_text="Only documents (false: no documents)")
    hide_screenshots = TristateFlagField()
    hide_documents = TristateFlagField()
    archived = TristateFlagField(
        help_text="Only archived photos (false: no archived photos, the "
        "timeline); absent: archived or not"
    )
    apply_default = TristateFlagField(
        help_text="Apply the user's default_timeline_filter; the other filter "
        "params override it key by key."
    )


class AlbumDateListQuery(DateAlbumFilterQuery):
    """The day list's filters plus its search term."""

    search = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="Caption, location or person name",
    )
