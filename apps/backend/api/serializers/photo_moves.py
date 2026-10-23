"""Request input and answers of moving photos to another folder (#352,
``api/views/photo_moves.py``), and of sorting them into dated folders (#2774)."""

from collections.abc import Callable

from rest_framework import serializers

from api.drf.params import required_string
from api.photos.moves import REFUSAL_REASONS
from api.photos.naming import InvalidPatternError, check_folder_pattern
from api.serializers.photos import PhotoSelectionRequest


def pattern_validator(check: Callable[[str], None]) -> Callable[[str], None]:
    """A field validator from a pattern check of ``api.photos.naming``: its
    refusal is a 400 ``invalid_pattern`` on the field."""

    def validate(value: str) -> None:
        try:
            check(value)
        except InvalidPatternError as error:
            raise serializers.ValidationError(
                str(error), code="invalid_pattern"
            ) from error

    return validate


#: ``on_conflict``: what to do with a photo whose name is taken in the folder.
ON_CONFLICT_CHOICES = ["rename", "skip"]
#: Why a photo of the selection does not move (``api.photos.moves.refusal``).
MOVE_REFUSAL_REASONS = list(REFUSAL_REASONS)


class MovePreviewRequest(PhotoSelectionRequest):
    """The photos (as every bulk photo action names them) and where they go."""

    target_folder = required_string(
        "target_folder is required",
        help_text="An absolute folder inside the requester's library; it is "
        "created when it does not exist",
    )
    folder_pattern = serializers.CharField(
        required=False,
        validators=[pattern_validator(check_folder_pattern)],
        allow_blank=True,
        trim_whitespace=False,
        help_text="Sort by date (#2774): each photo goes into this folder "
        "inside target_folder, made from its capture date with the tokens "
        "{year} {month} {day} {hour} {minute} {second}, levels separated by "
        '"/" ("{year}/{month}"). Photos without a date stay where they are',
    )


class MovePhotosRequest(MovePreviewRequest):
    on_conflict = serializers.ChoiceField(
        choices=ON_CONFLICT_CHOICES,
        required=False,
        help_text='"rename" gives a photo whose name is taken a free one '
        '("IMG_1 (1).jpg"), "skip" leaves it where it is. Without it a '
        "taken name is a 409 name_conflict and nothing moves. A file in the "
        "folder is never overwritten",
    )


class MoveFolderQuery(serializers.Serializer[None]):
    path = serializers.CharField(
        required=False,
        trim_whitespace=False,
        help_text="The folder to list; without it the library folders themselves",
    )


class RefusedCountSerializer(serializers.Serializer[None]):
    reason = serializers.ChoiceField(
        choices=MOVE_REFUSAL_REASONS,
        help_text="nextcloud: a local copy of a Nextcloud file; shared_file: a "
        "file another photo also uses; not_on_disk: its files are missing",
    )
    photos = serializers.IntegerField()


class MoveClashSerializer(serializers.Serializer[None]):
    photo_id = serializers.UUIDField()
    name = serializers.CharField(help_text="The main file's name, taken in the folder")
    renamed_to = serializers.CharField(
        allow_null=True,
        help_text='The name "rename" gives it; null when no free name was found',
    )


class MoveFolderCountSerializer(serializers.Serializer[None]):
    """What a move sorted by date does in one of its folders."""

    path = serializers.CharField()
    photos = serializers.IntegerField(help_text="Photos that move into it")
    unchanged = serializers.IntegerField(help_text="Photos already in it")
    clashes = serializers.IntegerField(help_text="Photos whose name is taken in it")
    new = serializers.BooleanField(help_text="The move makes the folder")


class MovePreviewResponse(serializers.Serializer[None]):
    """What a move to ``target_folder`` would do; nothing changed yet."""

    target_folder = serializers.CharField(help_text="The folder, normalised")
    photos = serializers.IntegerField(help_text="Photos that would move")
    files = serializers.IntegerField(
        help_text="Their files, variants and XMP sidecars included"
    )
    unchanged = serializers.IntegerField(help_text="Photos already in the folder")
    refused = RefusedCountSerializer(many=True, help_text="Photos that cannot move")
    clashes = MoveClashSerializer(
        many=True, help_text="Photos whose name is taken in the folder"
    )
    undated = serializers.IntegerField(
        help_text="Photos without a capture date, left out by folder_pattern"
    )
    undated_hashes = serializers.ListField(
        child=serializers.CharField(),
        help_text="The image hashes of those photos, to set their date",
    )
    folders = MoveFolderCountSerializer(
        many=True,
        help_text="With folder_pattern: each folder the photos go to; else empty",
    )


class MovePhotosResponse(serializers.Serializer[None]):
    """What the move did, in photos (200: the move ran in the request)."""

    target_folder = serializers.CharField()
    moved = serializers.IntegerField()
    skipped = serializers.IntegerField(
        help_text='Left in place: a name was taken ("skip")'
    )
    unchanged = serializers.IntegerField(help_text="Already in the folder")
    refused = serializers.IntegerField(help_text="Photos that cannot move")
    failed = serializers.IntegerField(
        help_text="Photos whose files could not be moved; they stay where they were"
    )
    undated = serializers.IntegerField(
        help_text="Photos without a capture date, left out by folder_pattern"
    )


class MovePhotosStartedResponse(serializers.Serializer[None]):
    """202: more photos than a request moves; the "Move Photos" job does it."""

    job_id = serializers.CharField()
    target_folder = serializers.CharField()


class LibraryFolderSerializer(serializers.Serializer[None]):
    name = serializers.CharField()
    path = serializers.CharField()
    has_subfolders = serializers.BooleanField()


class LibraryFolderListingSerializer(serializers.Serializer[None]):
    """The folders a move can go to, one level at a time."""

    path = serializers.CharField(
        allow_null=True, help_text="The folder listed; null for the library folders"
    )
    folders = LibraryFolderSerializer(many=True)
    truncated = serializers.BooleanField(
        help_text="More subfolders exist than were listed"
    )
