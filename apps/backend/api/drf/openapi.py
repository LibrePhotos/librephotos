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

``ThrottledBasicScheme`` describes ``ThrottledBasicAuthentication`` as the
``basicAuth`` scheme drf-spectacular gives DRF's own Basic authentication.
``JWTCookieScheme`` describes ``JWTCookieAuthentication`` as either of two
schemes: simplejwt's ``jwtAuth`` bearer header, or the ``jwt`` cookie
(``jwtCookieAuth``). Defining them here registers them: this module is
imported before any schema is generated.
"""

from typing import Any

from drf_spectacular import openapi
from drf_spectacular.authentication import BasicScheme
from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme
from drf_spectacular.plumbing import force_instance
from rest_framework import serializers

PAGE_KEYS = frozenset({"count", "next", "previous", "results"})

# Raw schemas for answers a serializer cannot describe. They live here, not
# next to the serializers: their keys are OpenAPI's camelCase keywords, which
# the snake_case check on api/serializers and api/views would flag.

# A number, or "" when there is none (``get_server_stats``' gpu_memory_in_mb).
INTEGER_OR_EMPTY_STRING: dict[str, Any] = {
    "oneOf": [{"type": "integer"}, {"type": "string", "enum": [""]}]
}

# ``GET /api/locclust/`` (``get_location_clusters``): one row per place name,
# sorted by name. The rows are triples.
LOCATION_CLUSTERS_SCHEMA: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "array",
        "items": {"oneOf": [{"type": "number"}, {"type": "string"}]},
        "minItems": 3,
        "maxItems": 3,
        "description": "[latitude, longitude, place name]",
    },
}


class ThrottledBasicScheme(BasicScheme):
    # A dotted path: importing the class here would import DRF's views from
    # the settings import of the authentication classes.
    target_class = "api.accounts.authentication.ThrottledBasicAuthentication"


class JWTCookieScheme(SimpleJWTScheme):
    """The bearer header, or else the access token in the ``jwt`` cookie.

    Two alternatives (OR), not two credentials sent together (AND): the view
    reads the header first and falls back to the cookie. The header is
    simplejwt's ``jwtAuth`` scheme, which the views on the default
    authentication classes define; this extension defines only the cookie
    (defining ``jwtAuth`` again, for another class, would be a name clash).
    """

    target_class = "api.accounts.authentication.JWTCookieAuthentication"
    name = "jwtCookieAuth"

    def get_security_requirement(
        self, auto_schema: openapi.AutoSchema
    ) -> list[dict[str, list[Any]]]:
        return [{SimpleJWTScheme.name: []}, {self.name: []}]

    def get_security_definition(
        self, auto_schema: openapi.AutoSchema
    ) -> dict[str, str]:
        from api.accounts.authentication import JWT_COOKIE_NAME

        return {"type": "apiKey", "in": "cookie", "name": JWT_COOKIE_NAME}


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
