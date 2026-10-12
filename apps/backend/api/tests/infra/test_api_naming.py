"""API payloads use snake_case keys, and new photo routes take ``Photo.id``.

The naming rules from the glossary (``apps/docs/docs/development/glossary.md``)
that a machine can check, held against the code (#2371):

* Every serializer field under ``api/`` and ``nextcloud/`` (declared fields
  and ``Meta.fields``) and every property and parameter name in the committed
  ``openapi.json`` is snake_case.
* No view or serializer module writes a camelCase string key into a dict: the
  keys of dict literals and of ``x["key"] = ...`` stores.
* No ``api/`` route takes an ``image_hash`` URL argument: a new route takes the
  photo as ``Photo.id`` in a ``photo_id`` argument; ``image_hash`` is for
  content-hash lookups.

The camelCase names that predate the rule are public API: the web app,
``packages/api-client`` and shipped mobile builds read them. Renaming one
needs a deprecation period that sends both keys, so they are frozen below.
Each list only shrinks: an entry that no longer occurs fails the suite until
it is deleted.
"""

import ast
import importlib
import json
import pkgutil
import re
from collections.abc import Iterable, Iterator
from pathlib import Path

from django.test import SimpleTestCase
from rest_framework import serializers

from api.tests.infra.routes import FunctionRoute, Route, api_routes, function_routes

BACKEND = Path(__file__).resolve().parents[3]

SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")
# A string key that starts like a camelCase identifier. Narrower than "not
# snake_case" on purpose: dict keys also hold header names, ExifTool tags and
# other strings that are not JSON field names.
CAMEL_CASE_KEY = re.compile(r"^[a-z]+[A-Z]")

# Packages whose serializers and dict keys make up the API.
SERIALIZER_PACKAGES = ("api.serializers", "api.views", "nextcloud")
DICT_KEY_ROOTS = ("api/views", "api/serializers", "nextcloud")

# Serializer fields (and so openapi.json properties) that predate the rule.
LEGACY_CAMEL_CASE_FIELDS = frozenset(
    {
        "aspectRatio",
        "birthTime",
        "digitalZoomRatio",
        "dominantColor",
        "focalLength35Equivalent",
        "newPersonName",
        "numberOfItems",
        "removedPhotos",
        "subjectDistance",
    }
)
# Dict keys written by views and serializers that predate the rule.
LEGACY_CAMEL_CASE_DICT_KEYS = frozenset(
    {
        "birthTime",
        "isFirstTimeSetup",
        "numberOfItems",
    }
)
# The routes that take a photo's image_hash in the URL. New ones take the id.
LEGACY_IMAGE_HASH_ROUTES = frozenset(
    {
        "api/photos/(?P<image_hash>[a-f0-9]+)/file/(?P<file_hash>[a-f0-9]+)/",
        "api/photos/(?P<image_hash>[a-f0-9]+)/main-file/",
    }
)


def _import_packages(packages: Iterable[str]) -> None:
    for package in packages:
        module = importlib.import_module(package)
        for info in pkgutil.walk_packages(
            getattr(module, "__path__", []), f"{package}."
        ):
            if ".tests" in info.name or ".migrations" in info.name:
                continue
            importlib.import_module(info.name)


def _subclasses(cls: type) -> Iterator[type]:
    for sub in cls.__subclasses__():
        yield sub
        yield from _subclasses(sub)


def project_serializers() -> list[type[serializers.BaseSerializer]]:
    """Every serializer class defined in the API packages."""
    _import_packages(SERIALIZER_PACKAGES)
    found = {
        cls
        for cls in _subclasses(serializers.BaseSerializer)
        if cls.__module__.split(".")[0] in {"api", "nextcloud"}
        and ".tests" not in cls.__module__
    }
    return sorted(found, key=lambda cls: f"{cls.__module__}.{cls.__qualname__}")


def serializer_field_names(cls: type) -> set[str]:
    """Declared fields plus the names listed in ``Meta.fields``."""
    names = set(getattr(cls, "_declared_fields", {}))
    meta = getattr(cls, "Meta", None)
    listed = getattr(meta, "fields", None)
    if isinstance(listed, (list, tuple)):
        names.update(name for name in listed if isinstance(name, str))
    elif listed == "__all__":
        model = getattr(meta, "model", None)
        if model is not None:
            names.update(field.name for field in model._meta.get_fields())
    return names


def non_snake_case_fields(classes: Iterable[type]) -> dict[str, set[str]]:
    """``{"module.Serializer": {name, ...}}`` for each name that is not snake_case."""
    found: dict[str, set[str]] = {}
    for cls in classes:
        bad = {
            name for name in serializer_field_names(cls) if not SNAKE_CASE.match(name)
        }
        if bad:
            found[f"{cls.__module__}.{cls.__qualname__}"] = bad
    return found


def openapi_names(document: object) -> set[str]:
    """Every property name and parameter name in an OpenAPI document."""
    names: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            properties = node.get("properties")
            if isinstance(properties, dict):
                names.update(str(key) for key in properties)
            if isinstance(node.get("in"), str) and isinstance(node.get("name"), str):
                names.add(node["name"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(document)
    return names


def camel_case_dict_keys(source: str) -> list[tuple[int, str]]:
    """``(line, key)`` for each camelCase string key a module writes into a dict."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        keys: list[ast.expr | None] = []
        if isinstance(node, ast.Dict):
            keys = list(node.keys)
        elif isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Store):
            keys = [node.slice]
        for key in keys:
            if (
                isinstance(key, ast.Constant)
                and isinstance(key.value, str)
                and CAMEL_CASE_KEY.match(key.value)
            ):
                found.append((key.lineno, key.value))
    return found


def project_dict_keys() -> dict[str, list[tuple[int, str]]]:
    """Per backend-relative path, the camelCase dict keys it writes."""
    found: dict[str, list[tuple[int, str]]] = {}
    for root in DICT_KEY_ROOTS:
        for path in sorted((BACKEND / root).rglob("*.py")):
            if "tests" in path.parts or "migrations" in path.parts:
                continue
            keys = camel_case_dict_keys(path.read_text(encoding="utf-8"))
            if keys:
                found[path.relative_to(BACKEND).as_posix()] = keys
    return found


def image_hash_routes(routes: Iterable[Route]) -> list[str]:
    """The routes that take an ``image_hash`` URL argument."""
    return sorted({route.route for route in routes if "image_hash" in route.kwargs})


def stale_entries(allowed: Iterable[str], found: Iterable[str]) -> list[str]:
    """Allow-list entries that no longer occur, so the list can shrink."""
    return sorted(set(allowed) - set(found))


class ApiNamingTest(SimpleTestCase):
    def test_serializer_fields_are_snake_case(self) -> None:
        found = non_snake_case_fields(project_serializers())
        new = {
            name: bad - LEGACY_CAMEL_CASE_FIELDS
            for name, bad in found.items()
            if bad - LEGACY_CAMEL_CASE_FIELDS
        }
        self.assertEqual(
            new,
            {},
            "Name serializer fields in snake_case (glossary: JSON keys are snake_case).",
        )
        legacy = set().union(*found.values()) if found else set()
        self.assertEqual(
            stale_entries(LEGACY_CAMEL_CASE_FIELDS, legacy),
            [],
            "No serializer uses these any more: delete them from LEGACY_CAMEL_CASE_FIELDS.",
        )

    def test_openapi_names_are_snake_case(self) -> None:
        document = json.loads((BACKEND / "openapi.json").read_text(encoding="utf-8"))
        bad = {
            name
            for name in openapi_names(document)
            if not SNAKE_CASE.match(name) and name not in LEGACY_CAMEL_CASE_FIELDS
        }
        self.assertEqual(sorted(bad), [])

    def test_views_write_no_camel_case_dict_keys(self) -> None:
        found = project_dict_keys()
        new = {
            path: [
                (line, key)
                for line, key in keys
                if key not in LEGACY_CAMEL_CASE_DICT_KEYS
            ]
            for path, keys in found.items()
        }
        self.assertEqual(
            {path: keys for path, keys in new.items() if keys},
            {},
            "Use snake_case keys in API payloads (glossary: JSON keys are snake_case).",
        )
        used = {key for keys in found.values() for _line, key in keys}
        self.assertEqual(
            stale_entries(LEGACY_CAMEL_CASE_DICT_KEYS, used),
            [],
            "No module writes these any more: delete them from LEGACY_CAMEL_CASE_DICT_KEYS.",
        )

    def test_new_photo_routes_take_the_photo_id(self) -> None:
        found = image_hash_routes([*api_routes(), *function_routes()])
        self.assertEqual(
            sorted(set(found) - LEGACY_IMAGE_HASH_ROUTES),
            [],
            "Take the photo as Photo.id in a photo_id URL argument, not image_hash.",
        )
        self.assertEqual(stale_entries(LEGACY_IMAGE_HASH_ROUTES, found), [])


class CheckersCatchPlantedDriftTest(SimpleTestCase):
    def test_a_camel_case_serializer_field_is_reported(self) -> None:
        # Built with type(): ruff's N815 would flag the planted name in a class body.
        meta = type("Meta", (), {"fields": ("fooBar", "snake_case", "listedOnly")})
        planted = type(
            "PlantedSerializer",
            (serializers.Serializer,),
            {
                "fooBar": serializers.CharField(),
                "snake_case": serializers.CharField(),
                "Meta": meta,
            },
        )

        found = non_snake_case_fields([planted])
        self.assertEqual(list(found.values()), [{"fooBar", "listedOnly"}])

    def test_a_camel_case_response_key_is_reported(self) -> None:
        source = (
            "def get(self, request):\n"
            "    data = {'snake_case': 1}\n"
            "    data['laterKey'] = 2\n"
            "    print(data['readOnly'])\n"
            "    return Response({'fooBar': 1, 'Content-Type': 'x'})\n"
        )
        self.assertEqual(camel_case_dict_keys(source), [(3, "laterKey"), (5, "fooBar")])

    def test_a_camel_case_openapi_property_is_reported(self) -> None:
        document = {
            "components": {"schemas": {"X": {"properties": {"fooBar": {}, "ok": {}}}}},
            "paths": {
                "/a/": {"get": {"parameters": [{"in": "query", "name": "pageSize"}]}}
            },
        }
        self.assertEqual(openapi_names(document), {"fooBar", "ok", "pageSize"})

    def test_an_image_hash_route_is_reported(self) -> None:
        def view() -> None:
            return None

        planted = [
            FunctionRoute(
                "api/photos/(?P<image_hash>[a-f0-9]+)/thing/", view, ("image_hash",)
            ),
            FunctionRoute("api/photos/<photo_id>/thing/", view, ("photo_id",)),
        ]
        self.assertEqual(
            image_hash_routes(planted), ["api/photos/(?P<image_hash>[a-f0-9]+)/thing/"]
        )

    def test_a_removed_legacy_name_is_reported_as_stale(self) -> None:
        self.assertEqual(
            stale_entries({"aspectRatio", "numberOfItems"}, {"numberOfItems"}),
            ["aspectRatio"],
        )
