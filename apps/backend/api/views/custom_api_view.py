from collections.abc import Sequence
from typing import TypeVar

from django.db.models import Model, QuerySet
from rest_framework import mixins, viewsets

from api.albums.covers import attach_cover_photos

_M = TypeVar("_M", bound=Model)
_Row = TypeVar("_Row")


class ListViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """A viewset that provides `list` actions.

    To use it, override the class and set the `.queryset` and
    `.serializer_class` attributes.
    """

    pass


class CoverPhotosMixin(viewsets.GenericViewSet[_M]):
    """A list of album or tag cards, each with a few cover photos.

    The covers of the page's cards are set on ``cover_photos_attr`` once the
    page is cut (``api.albums.covers``), so only the cards sent get them.
    """

    cover_photos_attr = "cover_photos"

    def paginate_queryset(
        self, queryset: QuerySet[_M, _Row] | Sequence[_Row]
    ) -> list[_Row] | None:
        page = super().paginate_queryset(queryset)
        if page is not None and self.action == "list":
            attach_cover_photos(
                [row for row in page if isinstance(row, Model)],
                self.cover_photos_attr,
            )
        return page
