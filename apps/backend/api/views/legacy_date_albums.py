"""``/api/albums/date/``: the date-album routes released clients still call.

#2920 replaced the date albums with ``/api/days/`` and removed these routes,
but released clients (UhuruPhotos for Android) build their timeline, trash,
favourites, hidden and person pages on them. They are served here from the
same day queries as ``/api/days/``, read-only, in the shape they had:

* ``GET /api/albums/date/list/``: ``{"results": [day, ...]}``, every day with
  ``incomplete`` true and no ``items``;
* ``GET /api/albums/date/<id>/?page=N``: one page of 100 photos of a day, the
  day with that page in ``items`` as ``results``.

A day's id is its ``/api/days/`` id (YYYYMMDD, 1 for the undated group), which
the photo summary also gives as ``album_date_id``. New clients use
``/api/days/``: its keyset pages stay fast on very large days, these offset
pages do not.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.pagination import PaginatedViewMixin
from api.drf.request_user import request_user
from api.models import Photo
from api.serializers.days import (
    LegacyDateAlbumListSerializer,
    LegacyDateAlbumPageSerializer,
    LegacyDateAlbumQuery,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
    with_person_video_time,
    with_photo_summary_relations,
)
from api.timeline.days import ordered
from api.timeline.photos import TimelineView
from api.timeline.rows import day_rows
from api.views.days import DAY_ID, DayViewMixin


class LegacyDateAlbumMixin(DayViewMixin):
    def _legacy_view(self) -> tuple[dict[str, Any], TimelineView]:
        """The view the old routes showed, and its filters.

        ``last_modified`` is how clients sync changes: for the owner it
        replaces every other filter, so photos moved to the trash or hidden
        since then are listed too, as before #2920.
        """
        params = self._params(LegacyDateAlbumQuery)
        view = self._view(params)
        last_modified = params.get("last_modified")
        if last_modified is None:
            return params, view
        if params["public"]:
            photos = view.photos.filter(last_modified__gte=last_modified)
        else:
            photos = Photo.objects.owned_by(request_user(self.request)).filter(
                last_modified__gte=last_modified
            )
        return params, dataclasses.replace(view, photos=photos)


class LegacyDateAlbumListViewSet(LegacyDateAlbumMixin):
    """``GET /api/albums/date/list/``: the day list in the date-album shape."""

    list_returns_object = True

    @extend_schema(
        parameters=[LegacyDateAlbumQuery],
        responses=LegacyDateAlbumListSerializer,
        deprecated=True,
        description="The days, in the shape of the date albums #2920 removed, "
        "for released clients. Use /api/days/.",
    )
    def list(self, request: Request) -> Response:
        _params, view = self._legacy_view()
        # The released clients' shape: the row without aspect_ratio_sum.
        rows: list[dict[str, Any]] = [
            {
                "id": row["id"],
                "date": row["date"],
                "location": row["location"],
                "numberOfItems": row["numberOfItems"],
                "incomplete": True,
                "items": [],
            }
            for row in day_rows(view)
        ]
        return Response({"results": rows})


class LegacyDateAlbumViewSet(PaginatedViewMixin, LegacyDateAlbumMixin):
    """``GET /api/albums/date/<id>/?page=N``: a page of a day."""

    @extend_schema(
        parameters=[DAY_ID, LegacyDateAlbumQuery],
        responses=LegacyDateAlbumPageSerializer,
        deprecated=True,
        description="A page of a day, in the shape of the date albums #2920 "
        "removed, for released clients. Use /api/days/<id>/photos/.",
    )
    def retrieve(self, request: Request, pk: str | None = None) -> Response:
        params, view = self._legacy_view()
        photos, walk = self._day(view, pk)
        day = next(iter(day_rows(dataclasses.replace(view, photos=photos))), None)
        rows = with_photo_summary_relations(ordered(photos, view.order, walk))
        if params.get("person") is not None:
            # A person's video opens where the person is (#2762).
            rows = with_person_video_time(rows, params["person"])
        page = self.paginate_queryset(rows)
        items = PhotoSummarySerializer(
            page,
            many=True,
            context={"request": request, "public": params["public"]},
        ).data
        response = self.get_paginated_response(
            {
                "id": int(pk or 0),
                "date": day["date"] if day else None,
                "location": day["location"] if day else "",
                "incomplete": False,
                "items": items,
            }
        )
        # The day's total, where clients have always read it.
        response.data["results"]["numberOfItems"] = response.data["count"]
        return response
