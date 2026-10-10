from rest_framework import serializers

from api.models import Photo


class OwnedPhotoField(serializers.PrimaryKeyRelatedField):
    """A photo id in a write payload, resolved against the requester's own photos.

    Use this for every writable photo reference. A bare
    ``PrimaryKeyRelatedField(queryset=Photo.objects.all())`` lets any
    authenticated user attach another user's photos to objects they own
    (GHSA-phvg-g65q-rhq3). A foreign id is rejected like an unknown one, and
    a serializer instantiated without a request accepts nothing.
    """

    def get_queryset(self):
        return Photo.objects.owned_by(
            getattr(self.context.get("request"), "user", None)
        )


def shared_serializer(parent, serializer_class):
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
