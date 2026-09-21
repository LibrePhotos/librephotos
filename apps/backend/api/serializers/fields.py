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
