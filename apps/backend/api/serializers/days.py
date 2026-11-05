"""The queries and rows of ``/api/days/``: the date-grouped photo lists."""

from __future__ import annotations

from rest_framework import serializers

from api.drf.params import TristateFlagField
from api.models import User
from api.serializers.photos import PhotoSummarySerializer

#: Photos a page holds unless ``limit`` says otherwise, and at most.
DAY_PAGE_SIZE = 100
MAX_DAY_PAGE_SIZE = 500


class PublicViewQuery(serializers.Serializer[None]):
    """Whether a read is the public view.

    ``public`` opens the read to anonymous callers and scopes it to public
    photos (or to the album's public link). A false word is false and any
    other value than a boolean spelling is a 400.
    """

    public = serializers.BooleanField(
        default=False,
        help_text="The public view: one user's public photos (with username)",
    )


class DayQuery(PublicViewQuery):
    """The filters every ``/api/days/`` read takes: the day list, a day's
    photos and its layout, so the three agree on which photos are in view.

    A blank parameter counts as absent. The media filters (``media`` down to
    ``apply_default``) are resolved by ``api.albums.timeline_filter``.
    """

    username = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="With public (required there): whose public photos. The "
        "public view is per user and needs their public profile on; everyone's "
        "public photos together are the public gallery (/api/gallery/)",
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
    library = serializers.IntegerField(
        required=False,
        help_text="The id of a user who shares their library with you: their "
        "photos instead of yours, read-only (404 without such a share)",
    )
    libraries = serializers.BooleanField(
        default=False,
        help_text="Also the photos of the libraries you show in your timeline; "
        "ignored by views of your own library only (hidden, trash, a person, "
        "a folder, favourites)",
    )
    order = serializers.ChoiceField(
        choices=User.PhotoOrder.choices,
        default=User.PhotoOrder.NEWEST,
        help_text="newest (the default) or oldest day first, by date taken, "
        "and a day's photos in the same order; the undated day comes last "
        "either way",
    )


class DayPhotosQuery(DayQuery):
    """A page of a day: the photos after ``after``."""

    after = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="The id of the last photo of the previous page (a page's "
        "`next`, or a layout's `page_after`); absent for the first page",
    )
    limit = serializers.IntegerField(
        default=DAY_PAGE_SIZE, min_value=1, max_value=MAX_DAY_PAGE_SIZE
    )


# What the public view ignores of a query: filters by what it does not show
# (people, folders, favourites, archiving) and the photos it never lists
# (hidden, in the trash, another library's).
PUBLIC_VIEW_NEUTRAL: dict[str, object] = {
    "hidden": False,
    "in_trashcan": False,
    "folder": "",
    "favorite": None,
    "archived": None,
    "libraries": False,
}
PUBLIC_VIEW_IGNORED = ("person", "library")


def public_view_filters(params: dict[str, object]) -> dict[str, object]:
    """``params`` of a day read, as the public view applies them.

    The public view lists public photos only, by what their owners publish:
    a filter on anything else would tell which public photo shows whom, sits
    in which folder or is a favourite.
    """
    if params.get("public") is not True:
        return params
    neutral = {
        key: value for key, value in params.items() if key not in PUBLIC_VIEW_IGNORED
    }
    neutral.update(
        {key: value for key, value in PUBLIC_VIEW_NEUTRAL.items() if key in params}
    )
    return neutral


class DaySerializer(serializers.Serializer[None]):
    """A day of the list: ``id`` names it in ``/api/days/<id>/...``."""

    id = serializers.IntegerField(
        help_text="YYYYMMDD of the day, or 1 for the photos without a date"
    )
    date = serializers.DateField(
        allow_null=True, help_text="The day; null for the undated group"
    )
    location = serializers.CharField(help_text="The town of its first located photo")
    numberOfItems = serializers.IntegerField()


class DayListSerializer(serializers.Serializer[None]):
    results = DaySerializer(many=True)


class DayPhotosSerializer(serializers.Serializer[None]):
    """A page of a day's photos."""

    items = PhotoSummarySerializer(many=True)
    next = serializers.UUIDField(
        allow_null=True,
        help_text="``after`` for the next page; null on the last one",
    )


class DayLayoutSerializer(serializers.Serializer[None]):
    """What a client lays a day out with before its photos load."""

    id = serializers.IntegerField()
    numberOfItems = serializers.IntegerField()
    aspectRatios = serializers.ListField(
        child=serializers.FloatField(allow_null=True),
        help_text="Every photo's aspect ratio, in the day's order",
    )

    page_after = serializers.ListField(
        child=serializers.UUIDField(allow_null=True),
        help_text="``after`` for each page of ``limit`` photos: null for the "
        "first, then the id of the photo before the page",
    )
