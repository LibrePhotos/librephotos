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
