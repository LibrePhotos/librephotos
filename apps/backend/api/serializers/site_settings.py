"""The body of POST /api/sitesettings."""

from collections.abc import Mapping

from rest_framework import serializers
from rest_framework.fields import empty


class JsonBooleanField(serializers.BooleanField):
    """A JSON ``true``/``false`` only: ``"true"`` or ``1`` are refused.

    ``serializers.BooleanField`` accepts those spellings; the settings
    endpoint never did. An absent field stays absent on a form body too,
    where ``BooleanField`` would read it as an unchecked box (false).
    """

    default_empty_html = empty

    def to_internal_value(self, data: str | bool | int) -> bool:
        if not isinstance(data, bool):
            self.fail("invalid", input=data)
        return data


class JsonStringField(serializers.CharField):
    """A JSON string kept as sent: blank allowed, whitespace not trimmed.

    ``serializers.CharField`` would turn a number into a string.
    """

    def __init__(self) -> None:
        super().__init__(required=False, allow_blank=True, trim_whitespace=False)

    def to_internal_value(self, data: str) -> str:
        if not isinstance(data, str):
            self.fail("invalid")
        return data


class SiteSettingsRequest(serializers.Serializer[None]):
    """The settings to change: every field optional, at least one present.

    Keys the endpoint does not store (``heavyweight_process``, ``llm_model``,
    ...) are ignored, so a client may post back what GET returned.
    """

    allow_registration = JsonBooleanField(required=False)
    allow_upload = JsonBooleanField(required=False)
    skip_patterns = JsonStringField()
    map_api_provider = JsonStringField()
    map_api_key = JsonStringField()
    map_tile_provider = JsonStringField()
    captioning_model = JsonStringField()
    ocr_model = JsonStringField()
    face_recognition_model = JsonStringField()
    nextcloud_enabled = JsonBooleanField(required=False)
    auto_create_user_directory = JsonBooleanField(required=False)

    def validate(self, attrs: Mapping[str, object]) -> Mapping[str, object]:
        if not attrs:
            raise serializers.ValidationError(
                f"Give at least one of: {', '.join(self.fields)}."
            )
        return attrs
