"""Request input of the Nextcloud views (``nextcloud/views.py``)."""

from rest_framework import serializers


class ListDirQuery(serializers.Serializer[None]):
    fpath = serializers.CharField(
        default="",
        allow_blank=True,
        trim_whitespace=False,
        help_text="The Nextcloud folder to list; none lists nothing",
    )
