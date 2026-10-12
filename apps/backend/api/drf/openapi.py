"""The OpenAPI schema class (``REST_FRAMEWORK["DEFAULT_SCHEMA_CLASS"]``).

drf-spectacular lists a field as required in a response component only when it
is read-only or required on input. A writable model field with a default
(``rating``, ``hidden``) therefore came out optional in ``Photo``, although a
``ModelSerializer`` writes every declared field of the instance it renders.
packages/api-client compares its zod schemas with these components, and a
schema that calls an always-present field optional would hide a client that
does not expect it, so responses of model serializers list every field.

Plain ``Serializer`` classes keep drf-spectacular's rule: they often render
dicts, and DRF skips a non-required field whose key is missing.

DRF's page schemas list only ``count`` and ``results`` as required, although a
page always carries ``next`` and ``previous`` (null at the ends);
``require_page_keys`` (a postprocessing hook) lists all four.
"""

from typing import Any

from drf_spectacular import openapi
from drf_spectacular.plumbing import force_instance
from rest_framework import serializers

PAGE_KEYS = frozenset({"count", "next", "previous", "results"})


class AutoSchema(openapi.AutoSchema):
    def _map_basic_serializer(
        self, serializer: serializers.BaseSerializer, direction: str
    ) -> dict[str, Any]:
        schema: dict[str, Any] = super()._map_basic_serializer(serializer, direction)
        properties = schema.get("properties")
        if (
            direction == "response"
            and properties
            and isinstance(force_instance(serializer), serializers.ModelSerializer)
        ):
            schema["required"] = sorted(properties)
        return schema


def require_page_keys(
    result: dict[str, Any], generator: object, request: object, public: bool
) -> dict[str, Any]:
    """Postprocessing hook: a page component requires all four keys."""
    for component in result.get("components", {}).get("schemas", {}).values():
        if set(component.get("properties", {})) == PAGE_KEYS:
            component["required"] = sorted(PAGE_KEYS)
    return result
