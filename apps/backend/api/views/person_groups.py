"""Person groups (#1126): list, create, rename and delete them.

Which people a group holds is set from the person's side,
``PUT /api/persons/<id>/groups/`` (``PersonViewSet.groups``).
"""

from django.db.models import QuerySet
from django.db.models.functions import Lower
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import BaseSerializer

from api.drf.pagination import DefaultPagination
from api.drf.request_user import request_user
from api.models import PersonGroup, User
from api.serializers.person_group import (
    PersonGroupSerializer,
    with_person_group_relations,
)
from api.views.mixins import PartialUpdateModelMixin


class PersonGroupViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[PersonGroup],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The requester's groups of people, by name. Deleting one keeps its people.

    Another user's group id behaves exactly like one that does not exist.
    """

    serializer_class = PersonGroupSerializer
    pagination_class = DefaultPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self) -> QuerySet[PersonGroup]:
        user = self.request.user
        if not isinstance(user, User):
            return PersonGroup.objects.none()
        return with_person_group_relations(PersonGroup.objects.owned_by(user)).order_by(
            Lower("name"), "pk"
        )

    def perform_create(self, serializer: BaseSerializer[PersonGroup]) -> None:
        group = serializer.save(owner=request_user(self.request))
        # The answer carries the group's person count, which a new row lacks.
        serializer.instance = self.get_queryset().get(pk=group.pk)
