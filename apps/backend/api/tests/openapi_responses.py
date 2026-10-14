"""Check a real response against what the committed openapi.json declares for it.

A view that builds its answer as a dict declares the shape separately (a
response serializer in ``@extend_schema``), and nothing at run time ties the
two together. ``openapi_mismatches`` validates a response body against the
schema openapi.json gives that path, method and status, so a key the view
renames, adds or drops fails a test instead of only the clients.

The OpenAPI 3.0 schema is turned into JSON Schema first: ``nullable`` becomes
a ``null`` type, and an object that lists its properties accepts no other key
(drf-spectacular leaves ``additionalProperties`` open, which would let an
undeclared key through). A ``oneOf`` is checked as ``anyOf``: drf-spectacular
writes a Python union as ``oneOf``, and the branches of ``datetime | str``
(``{"format": "date-time"}`` and a plain string) both match any string, since
formats are not asserted, so ``oneOf`` would reject every value.
"""

import functools
import json
from typing import Any

from jsonschema import Draft202012Validator

from api.tests.stubs import BACKEND_ROOT

SCHEMA_FILE = BACKEND_ROOT / "openapi.json"
CHILD_KEYS = ("items", "additionalProperties", "not")
BRANCH_KEYS = ("oneOf", "anyOf", "allOf")


def to_json_schema(node: Any) -> Any:
    """An OpenAPI 3.0 schema node as strict JSON Schema (see the module docstring)."""
    if not isinstance(node, dict):
        return node
    converted = dict(node)
    for key in BRANCH_KEYS:
        if key in node:
            converted[key] = [to_json_schema(branch) for branch in node[key]]
    if "oneOf" in converted:
        converted["anyOf"] = [*converted.pop("oneOf"), *converted.get("anyOf", [])]
    for key in CHILD_KEYS:
        if isinstance(node.get(key), dict):
            converted[key] = to_json_schema(node[key])
    if "properties" in node:
        converted["properties"] = {
            name: to_json_schema(child) for name, child in node["properties"].items()
        }
        converted.setdefault("additionalProperties", False)
    if converted.pop("nullable", False):
        return {"anyOf": [converted, {"type": "null"}]}
    return converted


@functools.cache
def _document() -> dict[str, Any]:
    with open(SCHEMA_FILE, encoding="utf-8") as schema_file:
        document: dict[str, Any] = json.load(schema_file)
    return document


@functools.cache
def _components() -> dict[str, Any]:
    schemas = _document()["components"]["schemas"]
    return {"schemas": {name: to_json_schema(node) for name, node in schemas.items()}}


def declared_schema(
    path: str, method: str, status: int, media_type: str = "application/json"
) -> dict[str, Any]:
    """The body schema openapi.json declares for ``path`` (a template, e.g.
    ``/api/stats/``), ``method``, ``status`` and ``media_type``."""
    responses = _document()["paths"][path][method.lower()]["responses"]
    schema: dict[str, Any] = responses[str(status)]["content"][media_type]["schema"]
    return schema


def declared_body(path: str, method: str, status: int) -> bool:
    """Whether openapi.json declares a body for ``status`` at all."""
    responses = _document()["paths"][path][method.lower()]["responses"]
    return "content" in responses[str(status)]


def openapi_mismatches(path: str, method: str, status: int, body: Any) -> list[str]:
    """Where a JSON ``body`` answered with ``status`` breaks the declared schema; [] when it fits."""
    schema = to_json_schema(declared_schema(path, method, status))
    validator = Draft202012Validator({**schema, "components": _components()})
    return sorted(
        f"{error.json_path}: {error.message}" for error in validator.iter_errors(body)
    )
