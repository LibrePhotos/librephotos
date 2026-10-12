"""scripts/check_dead_code.py: the vulture dead-code check CI runs.

Runs the real check on the backend and on a temporary copy with unused code
planted in it, so a change to the skip rules that hides real findings fails.
"""

import contextlib
import importlib.util
import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
_SCRIPT = BACKEND / "scripts" / "check_dead_code.py"
# A unique name: dataclasses looks the module up in sys.modules while it loads.
_spec = importlib.util.spec_from_file_location("_check_dead_code_script", _SCRIPT)
assert _spec is not None and _spec.loader is not None
check_dead_code = importlib.util.module_from_spec(_spec)
sys.modules["_check_dead_code_script"] = check_dead_code
_spec.loader.exec_module(check_dead_code)

_UNUSED_FUNCTIONS = """

def planted_unused_helper() -> int:
    return 1


def planted_test_only_helper() -> int:
    return 1
"""

# Framework hooks: the getters, the validator and Meta must not be reported.
_SERIALIZER = """

from rest_framework import serializers


class PlantedSerializer(serializers.Serializer):
    planted_field = serializers.SerializerMethodField()
    renamed = serializers.SerializerMethodField("planted_getter")

    class Meta:
        fields = ("planted_field",)

    def get_planted_field(self, obj: object) -> int:
        return 1

    def planted_getter(self, obj: object) -> int:
        return 1

    def validate_planted_field(self, value: int) -> int:
        return value


# A generic base (the typed request serializers) is a serializer too.
class PlantedRequest(serializers.Serializer[None]):
    planted_value = serializers.CharField()

    def validate_planted_value(self, value: str) -> str:
        return value


PlantedSerializer
PlantedRequest
"""

_TEST_CALLER = """from api.photos.paths import planted_test_only_helper

planted_test_only_helper()
"""

_MODEL_METHOD = """    def planted_unused_method(self) -> int:
        return 1

"""


def _copy_backend(target: Path) -> None:
    ignore = shutil.ignore_patterns("tests", "test", "migrations", "__pycache__")
    for name in (
        *check_dead_code.PATHS,
        *check_dead_code.CONTEXT_PATHS,
        check_dead_code.WHITELIST,
    ):
        source = BACKEND / name
        if source.is_dir():
            shutil.copytree(source, target / name, ignore=ignore)
        elif source.is_file():
            shutil.copy2(source, target / name)


class LiveBackendTest(SimpleTestCase):
    def test_backend_has_no_dead_code(self):
        findings = check_dead_code.find_dead_code(BACKEND)
        self.assertEqual([str(f) for f in findings], [])


class PlantedDeadCodeTest(SimpleTestCase):
    """One scan of a temporary copy of the backend with code planted in it."""

    exit_code: int
    report: str

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _copy_backend(root)
            with open(root / "api" / "photos" / "paths.py", "a", encoding="utf-8") as f:
                f.write(_UNUSED_FUNCTIONS + _SERIALIZER)
            # A function only a test calls is dead: tests do not count as uses.
            os.makedirs(root / "api" / "tests")
            (root / "api" / "tests" / "test_planted.py").write_text(
                _TEST_CALLER, encoding="utf-8"
            )
            model = root / "api" / "models" / "album_date.py"
            text = model.read_text(encoding="utf-8")
            anchor = "    def __str__(self) -> str:\n"
            assert anchor in text
            model.write_text(
                text.replace(anchor, _MODEL_METHOD + anchor, 1), encoding="utf-8"
            )
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                cls.exit_code = check_dead_code.main(["--root", tmp])
        cls.report = out.getvalue()

    def test_check_fails(self):
        self.assertEqual(self.exit_code, 1, self.report)

    def test_unused_function_is_reported(self):
        self.assertIn("api/photos/paths.py:", self.report)
        self.assertIn("unused function 'planted_unused_helper'", self.report)

    def test_unused_model_method_is_reported(self):
        self.assertIn("api/models/album_date.py:", self.report)
        self.assertIn("unused method 'planted_unused_method'", self.report)

    def test_function_only_a_test_calls_is_reported(self):
        self.assertIn("unused function 'planted_test_only_helper'", self.report)

    def test_only_the_planted_dead_code_is_reported(self):
        findings = [line for line in self.report.splitlines() if ": unused " in line]
        self.assertEqual(len(findings), 3, self.report)
