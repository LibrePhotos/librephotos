from typing import Any, TypeVar

from django.db.models import Model, QuerySet
from rest_framework import serializers

from api.models import Photo

M = TypeVar("M", bound=Model)
S = TypeVar("S", bound=serializers.Serializer[None])


class OwnedPhotoField(serializers.PrimaryKeyRelatedField):
    """A photo id in a write payload, resolved against the requester's own photos.

    Use this for every writable photo reference. A bare
    ``PrimaryKeyRelatedField(queryset=Photo.objects.all())`` lets any
    authenticated user attach another user's photos to objects they own
    (GHSA-phvg-g65q-rhq3). A foreign id is rejected like an unknown one, and
    a serializer instantiated without a request accepts nothing.
    """

    def get_queryset(self) -> QuerySet[Photo]:
        return Photo.objects.owned_by(
            getattr(self.context.get("request"), "user", None)
        )


def declare_fields(
    serializer_class: type[S],
    **fields: serializers.Field[Any, Any, Any, Any],
) -> type[S]:
    """Add fields to a serializer that its class body cannot declare.

    A response field named like a ``Serializer`` attribute (``data``,
    ``source``, ``label``) would be an assignment the type checker rejects,
    and a field that nests the serializer itself (a tree) does not exist
    while the body runs. They come after the fields of the body.
    """
    serializer_class._declared_fields.update(fields)
    return serializer_class


def shared_serializer(
    parent: serializers.BaseSerializer,
    serializer_class: type[serializers.BaseSerializer],
) -> serializers.BaseSerializer:
    """One *serializer_class* instance per *parent* serializer.

    For ``get_*`` methods that render one related object per row: building a
    ModelSerializer's fields introspects the model and costs a few ms, which a
    list of hundreds of rows paid once per row. Render with
    ``.to_representation(obj)`` on the returned instance.
    """
    cache = parent.__dict__.setdefault("_shared_serializers", {})
    serializer = cache.get(serializer_class)
    if serializer is None:
        serializer = cache[serializer_class] = serializer_class(context=parent.context)
    return serializer


class MissingRelationsError(RuntimeError):
    """A serializer was handed a row its ``with_*_relations()`` function did not load.

    List serializers read prefetched relations and annotations only. Querying
    for a missing one instead would cost a query per row, an N+1 nobody sees
    until a page of a thousand rows takes seconds; failing makes the forgotten
    prefetch show up in the first test that renders the row (#2331).
    """


def loaded(obj: Model, name: str) -> object:
    """``obj.<name>`` as an annotation or a ``Prefetch(to_attr=...)`` stored it.

    Raises ``MissingRelationsError`` when the queryset did not load it.
    """
    try:
        return obj.__dict__[name]
    except KeyError:
        raise MissingRelationsError(
            f"{type(obj).__name__}.{name} was not loaded: pass the queryset "
            "through the serializer's with_*_relations() function"
        ) from None


def loaded_count(obj: Model, name: str) -> int:
    """An annotated count of ``obj``; see ``loaded``."""
    value = loaded(obj, name)
    if not isinstance(value, int):
        raise TypeError(f"{type(obj).__name__}.{name} is not a count: {value!r}")
    return value


def loaded_list(obj: Model, name: str, model: type[M]) -> list[M]:
    """The ``Prefetch(to_attr=name)`` list of ``obj``; see ``loaded``."""
    value = loaded(obj, name)
    if not isinstance(value, list):
        raise TypeError(f"{type(obj).__name__}.{name} is not a prefetched list")
    return [item for item in value if isinstance(item, model)]


def prefetched(obj: Model, relation: str, model: type[M]) -> list[M]:
    """The rows of ``obj.<relation>`` from its ``prefetch_related`` cache.

    Raises ``MissingRelationsError`` instead of querying when the relation was
    not prefetched.
    """
    cache: dict[str, QuerySet[Model]] = getattr(obj, "_prefetched_objects_cache", {})
    if relation not in cache:
        raise MissingRelationsError(
            f"{type(obj).__name__}.{relation} was not prefetched: pass the "
            "queryset through the serializer's with_*_relations() function"
        )
    return [item for item in cache[relation] if isinstance(item, model)]
