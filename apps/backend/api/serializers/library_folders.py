"""Requests and answers of the library folder routes (#123)."""

from rest_framework import serializers


class AddLibraryFolderRequest(serializers.Serializer[None]):
    """``POST /api/manage/user/<id>/library-folders/``: a folder to add."""

    path = serializers.CharField(
        trim_whitespace=False,
        max_length=512,
        help_text="Absolute path of an existing folder inside the data root",
    )


class LibraryFolderEntrySerializer(serializers.Serializer[None]):
    """One folder of a user's library."""

    id = serializers.IntegerField(
        allow_null=True,
        help_text="The further folder's id, to remove it; null for the scan "
        "directory and the upload folder",
    )
    path = serializers.CharField(help_text="Absolute path on the server")
    kind = serializers.ChoiceField(
        choices=["main", "folder", "upload"],
        help_text="main: the scan directory; folder: a further library folder; "
        "upload: the upload folder, when it lies outside the others",
    )
    available = serializers.BooleanField(
        help_text="The folder can be read now; a scan skips it otherwise and "
        "does not flag its photos missing"
    )
    photo_count = serializers.IntegerField(
        help_text="The user's photos in it, outside the trash"
    )


class LibraryFoldersSerializer(serializers.Serializer[None]):
    """Every folder of a user's library, the scan directory first."""

    folders = LibraryFolderEntrySerializer(many=True)
    excluded_folders = serializers.ListField(
        child=serializers.CharField(),
        help_text="Folders inside them the user left out of the library (#791)",
    )


class ExcludedFoldersRequest(serializers.Serializer[None]):
    """``PUT /api/library-folders/excluded/``: every folder to leave out (#791)."""

    excluded_folders = serializers.ListField(
        child=serializers.CharField(trim_whitespace=False, max_length=512),
        max_length=500,
        help_text="Absolute paths of folders inside the library folders; "
        "replaces the list, an empty one takes every folder back in",
    )


class ExcludedFoldersSavedSerializer(LibraryFoldersSerializer):
    """The library after a change of the folders left out of it."""

    outside_count = serializers.IntegerField(
        help_text="The user's photos now outside the library, those in the "
        "folders left out included; they stay until moved to the trash"
    )


class LibrarySubfoldersQuery(serializers.Serializer[None]):
    """``GET /api/library-folders/subfolders/``: a folder of the library."""

    path = serializers.CharField(
        trim_whitespace=False, help_text="Absolute path of a folder in the library"
    )


class LibrarySubfolderSerializer(serializers.Serializer[None]):
    """A folder inside a library folder, for the tree the user leaves folders out in."""

    name = serializers.CharField()
    path = serializers.CharField()
    excluded = serializers.BooleanField(help_text="Left out of the library itself")
    has_subfolders = serializers.BooleanField()
    photo_count = serializers.IntegerField(
        help_text="The user's photos in it and below it, outside the trash"
    )


class LibrarySubfoldersSerializer(serializers.Serializer[None]):
    """The folders inside one folder of the library (at most 500)."""

    path = serializers.CharField()
    subfolders = LibrarySubfolderSerializer(many=True)
    truncated = serializers.BooleanField(help_text="More folders than listed")
