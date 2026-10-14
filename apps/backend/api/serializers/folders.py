"""Request input of the folder views (``api/views/album_folder.py``,
``RootPathTreeView`` in ``api/views/user.py``), and the directory tree."""

from rest_framework import serializers

from api.serializers.fields import declare_fields


class FolderPathQuery(serializers.Serializer[None]):
    path = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        help_text="Absolute folder path; the default depends on the view",
    )


class DirTreeSerializer(serializers.Serializer[None]):
    """A folder of a directory tree (``api.serving.directory_tree.PathNode``):
    ``GET /api/dirtree/`` (two levels below the path) and
    ``GET /api/nextcloud/listdir/`` (one level, without children)."""

    title = serializers.CharField(allow_blank=True, help_text="The folder's name")
    absolute_path = serializers.CharField()


declare_fields(
    DirTreeSerializer,
    children=DirTreeSerializer(
        many=True, help_text="The folders in it, by name; [] at the last level"
    ),
)
