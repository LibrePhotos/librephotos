"""``/api/days/``: the date-grouped photo lists (the timeline, favourites, a
person's or a folder's photos, a shared library, a user's public page).

* ``GET /api/days/``: the days, with how many photos each holds;
* ``GET /api/days/<id>/photos/?after=<photo id>``: a page of a day;
* ``GET /api/days/<id>/layout/``: every photo's aspect ratio and the cursor
  of each page, so a client lays a day out before it loads and jumps into it.

All three take the same filters (``DayQuery``) and read the photos through
``api.timeline``, so a day's count, pages and layout agree.
"""

from __future__ import annotations

from typing import Any

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models import Photo, User
from api.serializers.days import (
    DayLayoutQuery,
    DayLayoutSerializer,
    DayListSerializer,
    DayPhotosQuery,
    DayPhotosSerializer,
    DayQuery,
    PublicViewQuery,
    public_view_filters,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
    with_person_video_time,
    with_photo_summary_relations,
)
from api.timeline.days import (
    StaleCursorError,
    Walk,
    after,
    day_of,
    day_q,
    ordered,
    walk_of,
)
from api.timeline.photos import TimelineView, library_view, own_view, public_view
from api.timeline.rows import day_rows

DAY_ID = OpenApiParameter(
    "id",
    OpenApiTypes.INT,
    OpenApiParameter.PATH,
    description="The day's id from /api/days/ (YYYYMMDD, 1 for the undated group)",
)


def public_view_permissions(request: Request) -> list[BasePermission]:
    """Anyone may read the public view (``?public``); the rest needs a sign-in.

    Only the flag is read here, so an anonymous caller without it is answered
    401 before any other parameter is validated.
    """
    if parse_query(request, PublicViewQuery)["public"]:
        return [AllowAny()]
    return [IsAuthenticated()]


def public_view_owner(request: Request, username: str) -> User:
    """The user whose public photos the public view (``?public``) shows.

    The public view is per user: their public profile, ``/public/<username>``.
    The combined view of everyone's public photos is the public gallery
    (``/api/gallery/``, #434), which has switches of its own. A blank or
    unknown username, a deactivated user, or one whose public profile
    (``public_sharing``) is off is a 404, except to that user themselves (the
    Public Links page lists their own public photos).
    """
    owner = (
        User.objects.filter(username=username, is_active=True).first()
        if username
        else None
    )
    if owner is None:
        raise NotFound()
    requester = request.user
    if not owner.public_sharing and not (
        isinstance(requester, User) and requester.pk == owner.pk
    ):
        raise NotFound()
    return owner


class DayViewMixin(viewsets.ViewSet):
    """How a read of the days resolves its view and a day: shared by
    ``DayViewSet`` and the legacy date-album routes (``legacy_date_albums``)."""

    def get_permissions(self) -> list[BasePermission]:
        return public_view_permissions(self.request)

    def _params(self, query: type[DayQuery]) -> dict[str, Any]:
        return public_view_filters(parse_query(self.request, query))

    def _view(self, params: dict[str, Any]) -> TimelineView:
        if params["public"]:
            return public_view(
                public_view_owner(self.request, params["username"]), params
            )
        user = request_user(self.request)
        if params.get("library") is not None:
            return library_view(user, params)
        return own_view(user, params)

    def _day(self, view: TimelineView, pk: str | None) -> tuple[QuerySet[Photo], Walk]:
        """The photos of the day ``pk`` names and how they are ordered; 404
        for an id that names no day of the view."""
        try:
            day = day_of(int(pk or ""))
        except ValueError as error:
            raise NotFound("No such day") from error
        if view.undated_only:
            # The public view of an owner who keeps dates to themselves: one
            # group, under the undated id only.
            if day is not None:
                raise NotFound("No such day")
            return view.photos, walk_of(undated=True, opaque=True)
        return view.photos.filter(day_q(day)), walk_of(day is None, opaque=False)


class DayViewSet(DayViewMixin):
    # The day list is one {"results": [...]} object.
    list_returns_object = True

    @extend_schema(parameters=[DayQuery], responses=DayListSerializer)
    def list(self, request: Request) -> Response:
        """The days of the view, newest (or oldest) first, then the undated group."""
        return Response({"results": day_rows(self._view(self._params(DayQuery)))})

    @extend_schema(parameters=[DAY_ID, DayPhotosQuery], responses=DayPhotosSerializer)
    @action(detail=True)
    def photos(self, request: Request, pk: str | None = None) -> Response:
        """A page of the day: ``limit`` photos after ``after``, and ``next``."""
        params = self._params(DayPhotosQuery)
        view = self._view(params)
        photos, walk = self._day(view, pk)
        if params.get("after") is not None:
            try:
                photos = after(photos, params["after"], view.order, walk)
            except StaleCursorError as error:
                raise ValidationError(
                    {"after": "That photo is not in this day any more"}
                ) from error
        limit = params["limit"]
        page = with_photo_summary_relations(ordered(photos, view.order, walk))
        if params.get("person") is not None:
            # A person's video opens where the person is (#2762).
            page = with_person_video_time(page, params["person"])
        rows = list(page[: limit + 1])
        items = PhotoSummarySerializer(
            rows[:limit],
            many=True,
            context={"request": request, "public": params["public"]},
        ).data
        more = len(rows) > limit
        return Response({"items": items, "next": rows[limit - 1].pk if more else None})

    @extend_schema(parameters=[DAY_ID, DayLayoutQuery], responses=DayLayoutSerializer)
    @action(detail=True)
    def layout(self, request: Request, pk: str | None = None) -> Response:
        """Every photo's aspect ratio in the day's order, and ``page_after``:
        the ``after`` of each page of ``limit`` photos."""
        params = self._params(DayLayoutQuery)
        view = self._view(params)
        photos, walk = self._day(view, pk)
        rows = list(
            ordered(photos, view.order, walk).values_list(
                "pk", "thumbnail__aspect_ratio"
            )
        )
        limit = params["limit"]
        return Response(
            {
                "id": int(pk or 0),
                "numberOfItems": len(rows),
                "aspectRatios": [ratio for _, ratio in rows],
                "page_after": [None]
                + [rows[i - 1][0] for i in range(limit, len(rows), limit)],
            }
        )
