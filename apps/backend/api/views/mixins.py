"""Viewset mixins DRF does not ship.

A viewset is ``viewsets.GenericViewSet`` plus exactly the mixins of the
actions it serves (or ``viewsets.ReadOnlyModelViewSet`` when it is
read-only), never ``ModelViewSet``: every verb a route answers is one
somebody chose. ``api/tests/infra/test_api_conventions.py`` pins the verbs
of every router prefix.
"""

from typing import TypeVar

from django.db.models import Model
from rest_framework.generics import GenericAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

_MT = TypeVar("_MT", bound=Model)


class PartialUpdateModelMixin(GenericAPIView[_MT]):
    """PATCH without PUT.

    DRF's ``UpdateModelMixin`` brings ``update`` along with
    ``partial_update``, and the router answers PUT for any viewset that has
    an ``update``. A full replace is what no client sends and what the
    serializers were not written for (a PUT has to repeat every required
    field), so viewsets that only take partial edits use this instead.

    It subclasses ``GenericAPIView`` (rather than being a bare mixin) only so
    ``get_object`` and ``get_serializer`` are typed; list it before
    ``viewsets.GenericViewSet`` like any other mixin.
    """

    def partial_update(
        self, request: Request, *args: object, **kwargs: object
    ) -> Response:
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if getattr(instance, "_prefetched_objects_cache", None):
            # As UpdateModelMixin does: a prefetch on the queryset would
            # otherwise serve the relations as they were before the update.
            setattr(instance, "_prefetched_objects_cache", {})

        return Response(serializer.data)

    def perform_update(self, serializer: BaseSerializer[_MT]) -> None:
        serializer.save()
