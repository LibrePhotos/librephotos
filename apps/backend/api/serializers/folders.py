"""Request input of the folder views (``api/views/album_folder.py``,
``RootPathTreeView`` in ``api/views/user.py``)."""

from rest_framework import serializers


class FolderPathQuery(serializers.Serializer[None]):
    path = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        help_text="Absolute folder path; the default depends on the view",
    )
