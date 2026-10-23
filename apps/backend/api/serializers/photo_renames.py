"""Request input and answers of renaming photos after their capture date
(#2773, ``api/views/photo_renames.py``)."""

from rest_framework import serializers

from api.photos.naming import check_name_pattern
from api.photos.renames import RENAME_STATUSES
from api.serializers.photo_moves import (
    MOVE_REFUSAL_REASONS,
    RefusedCountSerializer,
    pattern_validator,
)
from api.serializers.photos import PhotoSelectionRequest

#: What a rename does with one photo of the preview.
RENAME_STATUS_CHOICES = list(RENAME_STATUSES)


class RenamePhotosRequest(PhotoSelectionRequest):
    """The photos (as every bulk photo action names them) and their new name."""

    pattern = serializers.CharField(
        trim_whitespace=False,
        validators=[pattern_validator(check_name_pattern)],
        help_text="The new name without extension, made from the capture date "
        "with the tokens {year} {month} {day} {hour} {minute} {second} and "
        "{name} (the current name without extension). No path separators, "
        "no characters Windows refuses, at most 200 characters",
    )


class RenameRowSerializer(serializers.Serializer[None]):
    """One photo of the preview."""

    photo_id = serializers.UUIDField()
    image_hash = serializers.CharField(help_text="For the photo's thumbnail")
    name = serializers.CharField(help_text="The main file's name now")
    new_name = serializers.CharField(
        allow_null=True, help_text="The main file's new name; null when it keeps it"
    )
    other_files = serializers.IntegerField(
        help_text="More files renamed with it: RAW, Live Photo video, XMP sidecars"
    )
    status = serializers.ChoiceField(
        choices=RENAME_STATUS_CHOICES,
        help_text="rename; unchanged: it has the name already; undated: no "
        "capture date; refused: see reason; no_free_name: every numbered "
        "name is taken",
    )
    number = serializers.IntegerField(
        help_text='The " (n)" the new name got because the name was taken; 0: none'
    )
    reason = serializers.ChoiceField(
        choices=MOVE_REFUSAL_REASONS,
        allow_null=True,
        help_text="Why a refused photo keeps its name",
    )


class RenamePreviewResponse(serializers.Serializer[None]):
    """What renaming the selection would do; nothing changed yet."""

    photos = serializers.IntegerField(help_text="Photos that get a new name")
    files = serializers.IntegerField(
        help_text="Their files, variants and XMP sidecars included"
    )
    unchanged = serializers.IntegerField(help_text="Photos that have the name already")
    undated = serializers.IntegerField(help_text="Photos without a capture date")
    undated_hashes = serializers.ListField(
        child=serializers.CharField(),
        help_text="The image hashes of those photos, to set their date",
    )
    numbered = serializers.IntegerField(
        help_text='Photos whose name was taken and that get " (1)", " (2)", ...'
    )
    no_free_name = serializers.IntegerField(
        help_text="Photos for which every numbered name is taken"
    )
    refused = RefusedCountSerializer(
        many=True, help_text="Photos that cannot be renamed"
    )
    rows = RenameRowSerializer(
        many=True, help_text="The first photos, one by one; the rest are counted"
    )


class RenamePhotosResponse(serializers.Serializer[None]):
    """What the rename did, in photos (200: it ran in the request)."""

    renamed = serializers.IntegerField()
    unchanged = serializers.IntegerField(help_text="They had the name already")
    undated = serializers.IntegerField(help_text="No capture date: not renamed")
    refused = serializers.IntegerField(help_text="Photos that cannot be renamed")
    failed = serializers.IntegerField(
        help_text="Photos whose files could not be renamed; they keep their names"
    )


class RenamePhotosStartedResponse(serializers.Serializer[None]):
    """202: more photos than a request renames; the "Rename Photos" job does it."""

    job_id = serializers.CharField()
