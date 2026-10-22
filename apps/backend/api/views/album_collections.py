"""Album collections (#1009, #871): list, create, rename and delete them.

Which albums a collection holds is set from the album's side,
``PUT /api/albums/user/<id>/collections/`` (``AlbumUserViewSet.collections``).
"""

from django.db.models import QuerySet
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import BaseSerializer

from api.drf.pagination import DefaultPagination
from api.drf.request_user import request_user
from api.models import AlbumCollection, User
from api.serializers.album_collection import AlbumCollectionSerializer
from api.views.mixins import PartialUpdateModelMixin


class AlbumCollectionViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[AlbumCollection],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The requester's collections, by name. Deleting one keeps its albums.

    Another user's collection id behaves exactly like one that does not exist.
    """

    serializer_class = AlbumCollectionSerializer
    pagination_class = DefaultPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self) -> QuerySet[AlbumCollection]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumCollection.objects.none()
        return AlbumCollection.objects.owned_by(user).order_by("name", "pk")

    def perform_create(self, serializer: BaseSerializer[AlbumCollection]) -> None:
        serializer.save(owner=request_user(self.request))
