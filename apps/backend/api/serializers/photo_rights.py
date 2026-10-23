"""Request input and answers of the rights views (#425, ``api/views/photo_rights.py``)."""

from typing import Any

from rest_framework import serializers

from api.metadata.rights import RIGHTS_FIELDS, Keep
from api.models.photo_license import PhotoLicense
from api.models.photo_metadata import CREATOR_MAX_LENGTH
from api.serializers.photos import PhotoSelectionRequest

_KEEP_HELP = (
    "What the change leaves alone: 'any' value a photo has (only empty fields "
    "are filled), the values its 'file' gives, or 'none'"
)


class SetPhotosRightsRequest(PhotoSelectionRequest):
    """The photos (as every bulk photo action names them) and their new rights.

    A field left out stays as each photo has it; null or "" clears it.
    """

    copyright = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="The copyright notice; {year} becomes the year each photo was taken",
    )
    creator = serializers.CharField(
        max_length=CREATOR_MAX_LENGTH,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    license = serializers.ChoiceField(
        choices=PhotoLicense.choices, required=False, allow_null=True, allow_blank=True
    )
    keep = serializers.ChoiceField(
        choices=[(keep.value, keep.value) for keep in Keep],
        default=Keep.FILE.value,
        help_text=_KEEP_HELP,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        if not any(field in attrs for field in RIGHTS_FIELDS):
            raise serializers.ValidationError(
                {"license": "Name at least one of copyright, creator and license."}
            )
        return attrs


class SetPhotosRightsResponse(serializers.Serializer[None]):
    count = serializers.IntegerField(help_text="Photos whose rights changed")
    kept = serializers.IntegerField(
        help_text="Photos that kept a value of theirs (see keep)"
    )


class RightsFieldSummary(serializers.Serializer[None]):
    value = serializers.CharField(
        allow_null=True, help_text="The value when every photo has the same one"
    )
    mixed = serializers.BooleanField(help_text="Whether the photos differ")


class RightsSummaryResponse(serializers.Serializer[None]):
    """A selection's rights before "Set rights…" changes them."""

    count = serializers.IntegerField(help_text="Photos in the selection")
    from_file = serializers.IntegerField(
        help_text="Photos with a rights value their file gives"
    )
    copyright = RightsFieldSummary()
    creator = RightsFieldSummary()
    license = RightsFieldSummary()


class ApplyRightsDefaultRequest(serializers.Serializer[None]):
    keep = serializers.ChoiceField(
        choices=[(keep.value, keep.value) for keep in Keep],
        default=Keep.ANY.value,
        help_text=_KEEP_HELP,
    )


class RightsDefaultCountsResponse(serializers.Serializer[None]):
    """How many photos "Apply" in Settings > Metadata would reach."""

    total = serializers.IntegerField(help_text="The requester's photos")
    missing = serializers.IntegerField(
        help_text="Of those, the photos without a value in a field the "
        "default sets (0 without a default)"
    )
