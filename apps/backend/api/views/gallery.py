"""The public gallery (#434): ``/api/gallery/...``.

Open to whom the admin's ``PUBLIC_GALLERY`` setting says (``GalleryIsOpen``);
to everyone else every route here is a 404, so a closed gallery looks like no
gallery at all. Visitors without an account are throttled
(``PublicGalleryRateThrottle``), and every answer carries ``noindex`` unless
the admin lets search engines in. What each answer shows of each photo is
``api.sharing.gallery``'s call.
"""

from __future__ import annotations

from functools import cached_property
from typing import Any

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission, IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from api.accounts.throttling import PublicGalleryRateThrottle
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_query
from api.models import Photo
from api.serializers.gallery import (
    GalleryDayListSerializer,
    GalleryDaySerializer,
    GalleryFilterQuery,
    GalleryOwnerQuery,
    GalleryPersonSerializer,
    GalleryPhotographerSerializer,
    GalleryPhotoSerializer,
    GalleryPhotosQuery,
    GalleryPlaceSerializer,
    GalleryPreviewSerializer,
    GallerySerializer,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
    with_photo_summary_relations,
)
from api.sharing.gallery import (
    GalleryOwners,
    GalleryQuery,
    gallery_indexable,
    gallery_open_to,
    gallery_stage,
    gallery_summary,
    people_rows,
    person_entries,
    photographer_entries,
    photographer_rows,
    place_rows,
)
from api.sharing.grants import PUBLIC_OWNER_GRANTS
from api.views.custom_api_view import ListViewSet

# The photographers the admin's confirm names.
PREVIEW_PHOTOGRAPHERS = 20


class GalleryIsOpen(BasePermission):
    """The gallery is open to the requester: a 404 otherwise, never a 401 or
    403 that would tell a visitor there is a gallery to sign in to."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        if not gallery_open_to(request.user):
            raise NotFound()
        return True


class GalleryAPIView(APIView):
    """The base of every gallery route: who may open it, the throttle and
    the ``noindex`` header."""

    permission_classes = (GalleryIsOpen,)

    def get_throttles(self) -> list[BaseThrottle]:
        return [PublicGalleryRateThrottle()]

    def finalize_response(
        self, request: Request, response: Response, *args: Any, **kwargs: Any
    ) -> Response:
        response = super().finalize_response(request, response, *args, **kwargs)
        if not gallery_indexable():
            response["X-Robots-Tag"] = "noindex, nofollow"
        return response


def _owners(request: Request, query: type[GalleryOwnerQuery]) -> GalleryOwners:
    return GalleryOwners.load(parse_query(request, query).get("owner"))


def _gallery_query(request: Request, query: type[GalleryFilterQuery]) -> GalleryQuery:
    params = parse_query(request, query)
    return GalleryQuery(
        GalleryOwners.load(params.get("owner")), params["place"], params.get("person")
    )


class GalleryView(GalleryAPIView):
    """Whether the gallery is open to the requester, and how much it shows."""

    @extend_schema(responses=GallerySerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(
            {
                "stage": gallery_stage(),
                "indexable": gallery_indexable(),
                **gallery_summary(GalleryOwners.load()),
            }
        )


class GalleryDayViewSet(GalleryAPIView, ListViewSet):
    """The gallery's timeline: its days, newest first, then one group of the
    photos whose owners keep dates to themselves (or that have none)."""

    # For the schema only: list() builds its rows itself.
    queryset = Photo.objects.none()
    serializer_class = GalleryDaySerializer
    pagination_class = None

    @extend_schema(parameters=[GalleryFilterQuery], responses=GalleryDayListSerializer)
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        days = _gallery_query(request, GalleryFilterQuery).day_rows()
        return Response({"results": self.get_serializer(days, many=True).data})


class GalleryPhotoViewSet(GalleryAPIView, ListViewSet):
    """The photos of one day of the gallery's timeline (or of its undated
    group), a page at a time."""

    serializer_class = GalleryPhotoSerializer
    pagination_class = DefaultPagination

    @cached_property
    def _query(self) -> GalleryQuery:
        return _gallery_query(self.request, GalleryPhotosQuery)

    def get_queryset(self) -> QuerySet[Photo]:
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        day = parse_query(self.request, GalleryPhotosQuery)["day"]
        photos = self._query.day_photos(day)
        if photos is None:
            raise NotFound("No such day in the gallery")
        return with_photo_summary_relations(photos)

    def get_serializer_context(self) -> dict[str, Any]:
        context = {**super().get_serializer_context()}
        if not getattr(self, "swagger_fake_view", False):
            # Each owner's switches, loaded with the owners: no query per owner.
            context[PUBLIC_OWNER_GRANTS] = self._query.owners.grants
        return context

    # The page's rows have PhotoSummary's fields (GalleryPhotoSerializer only
    # blanks more of them), so the schema names that component.
    @extend_schema(
        parameters=[GalleryPhotosQuery], responses=PhotoSummarySerializer(many=True)
    )
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().list(request, *args, **kwargs)


class GalleryPlaceViewSet(GalleryAPIView, ListViewSet):
    """The towns of the gallery's photos whose owners share places."""

    # For the schema only: list() builds its rows itself.
    queryset = Photo.objects.none()
    serializer_class = GalleryPlaceSerializer
    pagination_class = DefaultPagination

    @extend_schema(parameters=[GalleryOwnerQuery])
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        rows = self.paginate_queryset(place_rows(_owners(request, GalleryOwnerQuery)))
        return self.get_paginated_response(
            self.get_serializer(rows or [], many=True).data
        )


class GalleryPersonViewSet(GalleryAPIView, ListViewSet):
    """The named people on the gallery's photos whose owners share people's
    names, one entry per owner and person."""

    # For the schema only: list() builds its rows itself.
    queryset = Photo.objects.none()
    serializer_class = GalleryPersonSerializer
    pagination_class = DefaultPagination

    @extend_schema(parameters=[GalleryOwnerQuery])
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        rows = self.paginate_queryset(people_rows(_owners(request, GalleryOwnerQuery)))
        entries = person_entries(rows or [])
        return self.get_paginated_response(self.get_serializer(entries, many=True).data)


class GalleryPhotographerViewSet(GalleryAPIView, ListViewSet):
    """The users who take part and have photos in the gallery."""

    # For the schema only: list() builds its rows itself.
    queryset = Photo.objects.none()
    serializer_class = GalleryPhotographerSerializer
    pagination_class = DefaultPagination

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        rows = self.paginate_queryset(photographer_rows(GalleryOwners.load()))
        entries = photographer_entries(rows or [])
        return self.get_paginated_response(self.get_serializer(entries, many=True).data)


class GalleryPreviewView(APIView):
    """What the gallery shows once it is open, whatever it is set to now: the
    admin's confirm before turning it on names the photographers and counts."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=GalleryPreviewSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        owners = GalleryOwners.load()
        rows = photographer_rows(owners)[:PREVIEW_PHOTOGRAPHERS]
        return Response(
            {**gallery_summary(owners), "photographers": photographer_entries(rows)}
        )
