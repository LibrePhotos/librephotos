"""Request input of the folder views (``api/views/album_folder.py``,
``RootPathTreeView`` in ``api/views/user.py``), and the directory tree."""

from rest_framework import serializers

from api.serializers.fields import declare_fields
from api.serializers.photos import PhotoHashListSerializer


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


class FolderEntrySerializer(serializers.Serializer[None]):
    """A subfolder with photos in it (``_folder_listing``)."""

    name = serializers.CharField()
    path = serializers.CharField(help_text="Absolute path")
    photo_count = serializers.IntegerField(
        help_text="The caller's photos in it and below"
    )
    modified = serializers.FloatField(help_text="The folder's mtime, in seconds")
    cover_photo = PhotoHashListSerializer(
        allow_null=True,
        help_text="The caller's newest visible photo in it and below (#2233)",
    )


class FolderLegacyPaginationSerializer(serializers.Serializer[None]):
    """The page fields as ``GET /api/folders/subfolders/`` sent them before #2327."""

    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    total_folders = serializers.IntegerField(
        help_text="Directory entries, also those without photos"
    )
    total_pages = serializers.IntegerField()
    has_next = serializers.BooleanField()
    has_previous = serializers.BooleanField()


class FolderSubfoldersPageSerializer(serializers.Serializer[None]):
    """``GET /api/folders/subfolders/``: one page of a folder's subfolders.

    The page envelope (``api/drf/pagination.py``), with the folder's own paths.
    A page holds 100 directory entries, and those without photos are dropped
    after paging, so a page can hold fewer, or none, while ``next`` says more
    follow. ``subfolders`` and ``pagination`` repeat the page for web bundles
    up to 1.3.
    """

    count = serializers.IntegerField(help_text="Directory entries in the folder")
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = FolderEntrySerializer(many=True)
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    num_pages = serializers.IntegerField()
    current_path = serializers.CharField(
        allow_null=True,
        help_text="The folder listed; null, with an empty page, for a user "
        "without a scan directory",
    )
    parent_path = serializers.CharField(
        allow_null=True, help_text="null at the top the caller may see"
    )
    subfolders = FolderEntrySerializer(
        many=True, help_text="Deprecated, for web bundles up to 1.3: results"
    )
    pagination = FolderLegacyPaginationSerializer(
        help_text="Deprecated, for web bundles up to 1.3: the page fields"
    )
