"""How every list endpoint pages (#2327).

One style and one envelope: ``DefaultPagination`` is DRF's page-number
paginator with ``page``/``page_size`` query parameters, 100 rows a page, at
most 1000, and the answer

    {"count", "next", "previous", "results", "page", "page_size", "num_pages"}

It is ``DEFAULT_PAGINATION_CLASS``, so a ``ListModelMixin`` view gets it
without declaring anything. A preset is a subclass that changes the page size
(and with it the cap), never the envelope. A view that is not a
``GenericAPIView`` pages through ``PaginatedViewMixin``; no view uses Django's
``Paginator`` or slices a queryset into pages by hand. A list that is not
paginated says ``pagination_class = None`` and is listed, with the reason, in
``UNPAGINATED_LIST_VIEWS`` (``api/tests/infra/test_api_conventions.py``).
The one other style is the keyset cursor of the mobile sync feeds
(``api/views/sync.py``).

Clients that need a whole list follow ``next`` until it is null
(``fetchAllPages`` in ``packages/api-client/src/transport/pages.ts``).
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import cached_property
from typing import TypeVar

from django.core.paginator import Page
from django.core.paginator import Paginator as DjangoPaginator
from django.db.models import Model, QuerySet
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import ClampedIntegerField

_Model = TypeVar("_Model", bound=Model)
_Row = TypeVar("_Row")

DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 1000
PAGE_PARAM = "page"
PAGE_SIZE_PARAM = "page_size"


def query_page_number(
    request: Request, name: str, *, default: int, highest: int | None = None
) -> int:
    """A page number or size from the query string, clamped into [1, highest].

    Absent or blank is ``default``; one that is not a number is a 400 naming
    the parameter, as every query field is (``api/drf/params.py``).
    """
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return default
    field = ClampedIntegerField(default=default, lowest=1, highest=highest)
    try:
        # run_validation is typed Any in the stubs; the field returns an int.
        return int(field.run_validation(raw))
    except ValidationError as error:
        raise ValidationError({name: error.detail}) from error


class DefaultPagination(PageNumberPagination):
    """``?page=``/``?page_size=``, 100 a page, at most 1000.

    Both are clamped (``page=0`` is page 1, ``page_size=5000`` is 1000) and
    one that is not a number is a 400 naming it. A page past the end is a 404,
    as in DRF: a client that follows ``next`` never asks for one.
    """

    page_size = DEFAULT_PAGE_SIZE
    page_query_param = PAGE_PARAM
    page_size_query_param = PAGE_SIZE_PARAM
    max_page_size = MAX_PAGE_SIZE

    def default_page_size(self) -> int:
        return self.page_size or DEFAULT_PAGE_SIZE

    def get_page_size(self, request: Request) -> int:
        return query_page_number(
            request,
            PAGE_SIZE_PARAM,
            default=self.default_page_size(),
            highest=self.max_page_size,
        )

    def get_page_number(
        self, request: Request, paginator: DjangoPaginator[object]
    ) -> int:
        if request.query_params.get(PAGE_PARAM) in self.last_page_strings:
            return paginator.num_pages
        return query_page_number(request, PAGE_PARAM, default=1)

    def current_page(self) -> Page[object]:
        """The page ``paginate_queryset`` cut last."""
        if self.page is None:
            raise RuntimeError("paginate_queryset() has not run yet")
        return self.page

    def get_paginated_response(self, data: object) -> Response:
        page = self.current_page()
        return Response(
            {
                "count": page.paginator.count,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
                "page": page.number,
                "page_size": page.paginator.per_page,
                "num_pages": page.paginator.num_pages,
            }
        )

    def get_paginated_response_schema(
        self, schema: dict[str, object]
    ) -> dict[str, object]:
        paginated = super().get_paginated_response_schema(schema)
        for name, example in (("page", 1), ("page_size", 100), ("num_pages", 2)):
            paginated["properties"][name] = {"type": "integer", "example": example}
        paginated["required"] = [
            "count",
            "next",
            "previous",
            "results",
            "page",
            "page_size",
            "num_pages",
        ]
        return paginated


# Presets: a different page size only.


class WholeListPagination(DefaultPagination):
    """1000 a page, for the lists every client released so far reads whole.

    Albums, people, tags and users (and the photo edit list, which had the
    same class): the web and the mobile app up to 1.3 read only the first page
    of these, so their page stays at the 1000 it always had. Move a view to
    ``DefaultPagination`` once a web and a mobile release that follow ``next``
    (``fetchAllPages``) have shipped.
    """

    page_size = MAX_PAGE_SIZE


class PhotoGridPagination(DefaultPagination):
    """2500 a page (and at most that), for photo lists that render as one grid.

    The shared-photo and shared-album lists, which clients up to 1.3 also read
    whole, and the photo list.
    """

    page_size = 2500
    max_page_size = 2500


class DayAlbumPagination(DefaultPagination):
    """The photos of one day album (``AlbumDateViewSet.retrieve``).

    Clients work the page numbers out from the day's ``numberOfItems``, which
    may be stale by the time they ask: a page past the end answers the last
    page and one that is not a number the first, as Django's ``Paginator`` did
    here before. ``size`` is read as a deprecated alias of ``page_size`` (the
    web and the mobile app never send it, scripts may); remove it after the
    next release.
    """

    legacy_page_size_param = "size"

    def get_page_size(self, request: Request) -> int:
        if PAGE_SIZE_PARAM not in request.query_params:
            return query_page_number(
                request,
                self.legacy_page_size_param,
                default=self.default_page_size(),
                highest=self.max_page_size,
            )
        return super().get_page_size(request)

    def get_page_number(
        self, request: Request, paginator: DjangoPaginator[object]
    ) -> int:
        try:
            number = super().get_page_number(request, paginator)
        except ValidationError:
            return 1
        return min(number, paginator.num_pages)


# The page parameters, for the schema of a view drf-spectacular does not see
# as a list (an APIView or a custom action).
PAGE_PARAMETERS = [
    OpenApiParameter("page", OpenApiTypes.INT, description="Page number (default 1)."),
    OpenApiParameter(
        "page_size",
        OpenApiTypes.INT,
        description=f"Rows per page (default {DEFAULT_PAGE_SIZE}, "
        f"at most {MAX_PAGE_SIZE}).",
    ),
]

DAY_ALBUM_PAGE_PARAMETERS = [
    *PAGE_PARAMETERS,
    OpenApiParameter(
        "size",
        OpenApiTypes.INT,
        description="Deprecated alias of page_size.",
        deprecated=True,
    ),
]


class PaginatedViewMixin(APIView):
    """``paginate_queryset``/``get_paginated_response`` for a view that is
    not a ``GenericAPIView``: list it first, before ``APIView`` or
    ``viewsets.ViewSet``.

    The same calls a generic view makes, with the view's ``pagination_class``
    (``DefaultPagination`` unless it names a preset).
    """

    pagination_class: type[DefaultPagination] = DefaultPagination

    @cached_property
    def paginator(self) -> DefaultPagination:
        return self.pagination_class()

    def paginate_queryset(
        self, items: QuerySet[_Model, _Row] | Sequence[_Row]
    ) -> list[_Row]:
        page = self.paginator.paginate_queryset(items, self.request, view=self)
        # DefaultPagination always has a page size, so it always pages.
        return page or []

    def get_paginated_response(self, data: object) -> Response:
        return self.paginator.get_paginated_response(data)


def with_legacy_page_flags(response: Response) -> Response:
    """A page ``response`` plus ``has_next``/``has_previous``.

    The duplicates and stacks lists sent them before they moved to the shared
    envelope, and the web app up to 1.3 requires them (an open tab keeps its
    bundle across a server upgrade). Remove after the next release; ``next``
    and ``previous`` say the same.
    """
    response.data["has_next"] = response.data["next"] is not None
    response.data["has_previous"] = response.data["previous"] is not None
    return response
