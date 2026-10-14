"""Every SerializerMethodField getter says what it returns, precisely.

drf-spectacular reads a getter's return annotation to describe the field in
openapi.json, which packages/api-client compares its zod schemas with. Without
an annotation the field is a string with a warning; a bare ``list`` or
``dict`` (or ``Any`` inside one) becomes ``items: {}`` or a free-form object,
so nothing about the field's shape can be checked. A getter returns a precise
type (``list[str]``, a ``TypedDict``, ``int | None``) or names its shape with
``@extend_schema_field`` (a serializer or an ``OpenApiTypes`` value).

SHAPELESS lists the getters that predate this test. It only shrinks: the test
fails on a new offender and on a listed getter that is fixed.
"""

import ast
from collections.abc import Iterator
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
SCANNED = ("api", "nextcloud")
SHAPELESS_NAMES = frozenset({"list", "dict", "Any", "object", "List", "Dict"})

# "<path>:<Class>.<getter>" for getters with no shape, as found when the test
# was added (issue #2370). Fix one: give it a precise annotation or
# @extend_schema_field, regenerate openapi.json, then delete its line here.
SHAPELESS = frozenset(
    {
        "api/serializers/album_date.py:IncompleteAlbumDateSerializer.get_items",
        "api/serializers/album_user.py:AlbumUserListSerializer.get_public_sharing_options",
        "api/serializers/album_user.py:AlbumUserSerializer.get_public_sharing_options",
        "api/serializers/photo_metadata.py:PhotoMetadataSerializer.get_edit_history",
        "api/serializers/photos.py:PhotoSerializer.get_captions_json",
        "api/serializers/photos.py:PhotoSerializer.get_embedded_media",
        "api/serializers/photos.py:PhotoSerializer.get_file_variants",
        "api/serializers/photos.py:PhotoSerializer.get_ocr",
        "api/serializers/photos.py:PhotoSerializer.get_people",
        "api/serializers/photos.py:PhotoSerializer.get_similar_photos",
        "api/serializers/photos.py:PhotoSerializer.get_stacks",
        "api/serializers/photos.py:PhotoSummarySerializer.get_stacks",
        "api/serializers/photos.py:PublicPhotoDetailSerializer.get_captions_json",
        "api/serializers/photos.py:PublicPhotoDetailSerializer.get_geolocation_json",
    }
)


def _is_method_field(value: ast.expr) -> bool:
    return (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Attribute | ast.Name)
        and (
            value.func.attr if isinstance(value.func, ast.Attribute) else value.func.id
        )
        == "SerializerMethodField"
    )


def _getter_name(field: str, call: ast.Call) -> str:
    """``get_<field>``, or the method_name the field names (first argument or keyword)."""
    for keyword in call.keywords:
        if keyword.arg == "method_name" and isinstance(keyword.value, ast.Constant):
            return str(keyword.value.value)
    if call.args and isinstance(call.args[0], ast.Constant):
        return str(call.args[0].value)
    return f"get_{field}"


def _has_schema_decorator(function: ast.FunctionDef) -> bool:
    for decorator in function.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        name = target.attr if isinstance(target, ast.Attribute) else None
        if isinstance(target, ast.Name):
            name = target.id
        if name == "extend_schema_field":
            return True
    return False


def _subscript_is_shapeless(annotation: ast.Subscript) -> bool:
    base = annotation.value
    base_name = base.id if isinstance(base, ast.Name) else ""
    parts = (
        list(annotation.slice.elts)
        if isinstance(annotation.slice, ast.Tuple)
        else [annotation.slice]
    )
    if base_name in ("Optional", "Union"):
        return any(is_shapeless(part) for part in parts)
    # list[X] has X's shape; dict[K, V] has V's.
    return is_shapeless(parts[-1])


def is_shapeless(annotation: ast.expr | None) -> bool:
    """No annotation, or one drf-spectacular can only render without a shape."""
    if annotation is None:
        return True
    if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
        annotation = ast.parse(annotation.value, mode="eval").body
    if isinstance(annotation, ast.Name | ast.Attribute):
        name = annotation.id if isinstance(annotation, ast.Name) else annotation.attr
        return name in SHAPELESS_NAMES
    if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
        return is_shapeless(annotation.left) or is_shapeless(annotation.right)
    if isinstance(annotation, ast.Subscript):
        return _subscript_is_shapeless(annotation)
    return False


def shapeless_getters(source: str, path: str) -> Iterator[str]:
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.ClassDef):
            continue
        methods = {
            item.name: item for item in node.body if isinstance(item, ast.FunctionDef)
        }
        for item in node.body:
            if not isinstance(item, ast.Assign | ast.AnnAssign):
                continue
            targets = item.targets if isinstance(item, ast.Assign) else [item.target]
            value = item.value
            if value is None or not _is_method_field(value):
                continue
            assert isinstance(value, ast.Call)
            for target in targets:
                if not isinstance(target, ast.Name):
                    continue
                getter = methods.get(_getter_name(target.id, value))
                # A getter inherited from a base class is checked there.
                if getter is None or _has_schema_decorator(getter):
                    continue
                if is_shapeless(getter.returns):
                    yield f"{path}:{node.name}.{getter.name}"


def scan() -> set[str]:
    found: set[str] = set()
    for root in SCANNED:
        for file in sorted((BACKEND / root).rglob("*.py")):
            relative = file.relative_to(BACKEND).as_posix()
            if "/tests/" in relative or "/migrations/" in relative:
                continue
            source = file.read_text(encoding="utf-8")
            if "SerializerMethodField" in source:
                found.update(shapeless_getters(source, relative))
    return found


class SerializerMethodAnnotationTest(SimpleTestCase):
    def test_no_new_shapeless_getter(self) -> None:
        new = sorted(scan() - SHAPELESS)
        self.assertEqual(
            new,
            [],
            "Annotate these SerializerMethodField getters with a precise return type "
            "(a TypedDict, list[str], int | None) or @extend_schema_field, then "
            "regenerate openapi.json (python scripts/openapi_schema.py).",
        )

    def test_allow_list_has_no_fixed_getter(self) -> None:
        fixed = sorted(SHAPELESS - scan())
        self.assertEqual(
            fixed, [], "These getters have a shape now; delete them from SHAPELESS."
        )

    def test_flags_a_planted_offender(self) -> None:
        source = (
            "from rest_framework import serializers\n"
            "class S(serializers.Serializer):\n"
            "    a = serializers.SerializerMethodField()\n"
            "    b = serializers.SerializerMethodField()\n"
            "    c = serializers.SerializerMethodField('count_c')\n"
            "    d = serializers.SerializerMethodField()\n"
            "    e = serializers.SerializerMethodField()\n"
            "    def get_a(self, obj): return 1\n"
            "    def get_b(self, obj) -> list | None: return []\n"
            "    def count_c(self, obj) -> dict[str, Any]: return {}\n"
            "    def get_d(self, obj) -> list[str]: return []\n"
            "    @extend_schema_field(int)\n"
            "    def get_e(self, obj) -> dict: return {}\n"
        )
        self.assertEqual(
            sorted(shapeless_getters(source, "x.py")),
            ["x.py:S.count_c", "x.py:S.get_a", "x.py:S.get_b"],
        )
