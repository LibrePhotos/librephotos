"""The body of POST /api/sitesettings."""

from collections.abc import Mapping

from rest_framework import serializers

from api.drf.params import JsonBooleanField, JsonFractionField, JsonStringField


class SiteSettingsRequest(serializers.Serializer[None]):
    """The settings to change: every field optional, at least one present.

    Keys the endpoint does not store (``heavyweight_process``, ``llm_model``,
    ...) are ignored, so a client may post back what GET returned.
    """

    allow_registration = JsonBooleanField(required=False)
    allow_upload = JsonBooleanField(required=False)
    skip_patterns = JsonStringField(required=False)
    map_api_provider = JsonStringField(required=False)
    map_api_key = JsonStringField(required=False)
    map_tile_provider = JsonStringField(required=False)
    captioning_model = JsonStringField(required=False)
    ocr_model = JsonStringField(required=False)
    face_recognition_model = JsonStringField(required=False)
    nextcloud_enabled = JsonBooleanField(required=False)
    auto_create_user_directory = JsonBooleanField(required=False)
    scan_missing_max_fraction = JsonFractionField(
        required=False,
        help_text="Largest share of a user's photos a scan may flag missing at once"
        " (0 to 1); 1 turns the check off.",
    )

    def validate(self, attrs: Mapping[str, object]) -> Mapping[str, object]:
        if not attrs:
            raise serializers.ValidationError(
                f"Give at least one of: {', '.join(self.fields)}."
            )
        return attrs
