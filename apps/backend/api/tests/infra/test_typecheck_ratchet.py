"""scripts/typecheck.py: the mypy baseline ratchet.

mypy itself is not run here (CI's type-check step does that); these tests pin
how its output is keyed and compared, which decides what fails CI.
"""

import importlib.util
import json
import os
import sys
import unittest
from collections import Counter
from unittest import mock

from django.test import SimpleTestCase

_SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "scripts",
    "typecheck.py",
)
# The script reads pyproject.toml with tomllib (3.11+). It only runs where mypy
# does, and requirements.dev.txt installs mypy on 3.11+ only, so on the floor
# Python (3.10) these tests skip.
HAS_TOMLLIB = importlib.util.find_spec("tomllib") is not None
needs_tomllib = unittest.skipUnless(
    HAS_TOMLLIB, "scripts/typecheck.py needs Python 3.11+ (tomllib)"
)

if HAS_TOMLLIB:
    # A unique name: dataclasses looks the module up in sys.modules while it loads.
    _spec = importlib.util.spec_from_file_location("_typecheck_script", _SCRIPT)
    assert _spec is not None and _spec.loader is not None
    typecheck = importlib.util.module_from_spec(_spec)
    sys.modules["_typecheck_script"] = typecheck
    _spec.loader.exec_module(typecheck)


def _line(path, line, message, code, severity="error"):
    return json.dumps(
        {
            "file": path,
            "line": line,
            "column": 4,
            "message": message,
            "hint": None,
            "code": code,
            "severity": severity,
        }
    )


@needs_tomllib
class ParseErrorsTest(SimpleTestCase):
    def test_keys_have_no_line_numbers_and_posix_paths(self):
        out = _line(
            "api\\views\\x.py",
            12,
            'Incompatible return value type (got "int")',
            "return-value",
        )
        [error] = typecheck.parse_errors(out)
        self.assertEqual(
            error.key,
            'api/views/x.py: [return-value] Incompatible return value type (got "int")',
        )
        self.assertIn("api/views/x.py:12:", error.raw)

    def test_a_moved_error_keeps_its_key(self):
        before = typecheck.parse_errors(_line("a.py", 10, "Boom", "misc"))
        after = typecheck.parse_errors(_line("a.py", 42, "Boom", "misc"))
        self.assertEqual(before[0].key, after[0].key)

    def test_line_numbers_inside_messages_are_normalised(self):
        [error] = typecheck.parse_errors(
            _line("a.py", 5, 'Name "x" already defined on line 3', "no-redef")
        )
        self.assertTrue(error.key.endswith("already defined on line N"))

    def test_notes_and_non_json_noise_are_skipped(self):
        out = "\n".join(
            [
                "use SECRET_KEY from env",
                "Traceback (most recent call last):",
                _line("a.py", 1, "See docs", "misc", severity="note"),
                _line("a.py", 2, "Real", "misc"),
            ]
        )
        self.assertEqual(
            [e.key for e in typecheck.parse_errors(out)], ["a.py: [misc] Real"]
        )


@needs_tomllib
class ExcessTest(SimpleTestCase):
    def test_counts_are_compared_as_a_multiset(self):
        have = Counter(["a", "a", "b"])
        allowed = Counter(["a", "b", "c"])
        self.assertEqual(typecheck.excess(have, allowed), ["a"])
        self.assertEqual(typecheck.excess(allowed, have), ["c"])


@needs_tomllib
class MainTest(SimpleTestCase):
    def _run(
        self,
        mypy_stdout,
        baseline,
        status=1,
        argv=(),
        checked_modules=frozenset({"api.strict", "api.x"}),
    ):
        with (
            mock.patch.object(
                typecheck, "run_mypy", return_value=(status, mypy_stdout, "")
            ),
            mock.patch.object(typecheck, "read_baseline", return_value=baseline),
            mock.patch.object(typecheck, "strict_modules", return_value=["api.strict"]),
            mock.patch.object(
                typecheck, "checked_modules", return_value=checked_modules
            ),
        ):
            return typecheck.main(list(argv))

    def test_clean_run_passes(self):
        self.assertEqual(self._run("", [], status=0), 0)

    def test_new_error_fails(self):
        out = _line(
            "api/x.py",
            3,
            'Incompatible return value type (got "int", expected "str")',
            "return-value",
        )
        self.assertEqual(self._run(out, []), 1)

    def test_new_unannotated_function_fails(self):
        out = _line(
            "api/x.py", 3, "Function is missing a type annotation", "no-untyped-def"
        )
        self.assertEqual(self._run(out, []), 1)

    def test_known_error_passes(self):
        out = _line("api/x.py", 3, "Boom", "misc")
        self.assertEqual(self._run(out, ["api/x.py: [misc] Boom"]), 0)

    def test_fixed_error_without_update_fails(self):
        self.assertEqual(self._run("", ["api/x.py: [misc] Boom"], status=0), 1)

    def test_strict_module_with_baseline_entry_fails(self):
        out = _line("api/strict.py", 3, "Boom", "misc")
        self.assertEqual(self._run(out, ["api/strict.py: [misc] Boom"]), 1)

    def test_strict_pattern_matching_no_module_fails(self):
        # A renamed or deleted module left in the strict list: the strict
        # flags would silently stop applying to its replacement.
        self.assertEqual(
            self._run("", [], status=0, checked_modules=frozenset({"api.x"})), 1
        )

    def test_mypy_failure_without_errors_exits_2(self):
        self.assertEqual(self._run("mypy: can't read file 'x'", [], status=2), 2)


@needs_tomllib
class StrictViolationsTest(SimpleTestCase):
    def test_matches_modules_and_package_patterns(self):
        with mock.patch.object(
            typecheck,
            "strict_modules",
            return_value=["api.a", "api.pkg.*", "typecheck"],
        ):
            hits = typecheck.strict_violations(
                [
                    "api/a.py: [misc] x",
                    "api/ab.py: [misc] x",
                    "api/pkg/__init__.py: [misc] x",
                    "api/pkg/mod.py: [misc] x",
                    "scripts/typecheck.py: [misc] x",
                ]
            )
        self.assertEqual(
            hits,
            [
                "api/a.py: [misc] x",
                "api/pkg/__init__.py: [misc] x",
                "api/pkg/mod.py: [misc] x",
                "scripts/typecheck.py: [misc] x",
            ],
        )

    def test_the_strict_list_is_read_from_pyproject(self):
        self.assertIn("typecheck", typecheck.strict_modules())


@needs_tomllib
class UnmatchedStrictPatternsTest(SimpleTestCase):
    def test_a_pattern_needs_a_module_or_a_package_member(self):
        modules = {"api.a", "api.pkg", "api.pkg.mod", "api.lone.mod", "typecheck"}
        self.assertEqual(
            typecheck.unmatched_strict_patterns(
                ["api.a", "api.gone", "api.pkg.*", "api.lone.*", "api.no.*"],
                modules,
            ),
            ["api.gone", "api.no.*"],
        )

    def test_checked_modules_follow_files_and_exclude(self):
        modules = typecheck.checked_modules()
        self.assertIn("api.drf.pagination", modules)
        self.assertIn("api.models", modules)
        self.assertIn("typecheck", modules)
        self.assertNotIn("api.tests.infra.test_typecheck_ratchet", modules)
        self.assertFalse(any(".migrations." in module for module in modules))

    def test_every_strict_pattern_names_a_checked_module(self):
        self.assertEqual(
            typecheck.unmatched_strict_patterns(
                typecheck.strict_modules(), typecheck.checked_modules()
            ),
            [],
        )


@needs_tomllib
class GrowthTest(SimpleTestCase):
    def _git(self, old_baseline):
        def fake(*args):
            result = mock.Mock(returncode=0, stdout="")
            if args[0] == "show" and args[1].endswith("mypy-baseline.txt"):
                result.stdout = "\n".join(old_baseline)
            return result

        return fake

    def test_shrinking_is_fine(self):
        with mock.patch.object(typecheck, "_git", side_effect=self._git(["a", "b"])):
            self.assertTrue(typecheck.check_growth("origin/dev", ["a"]))

    def test_growing_fails_without_a_dependency_change(self):
        with (
            mock.patch.object(typecheck, "_git", side_effect=self._git(["a"])),
            mock.patch.object(typecheck, "dependency_change_reason", return_value=None),
        ):
            self.assertFalse(typecheck.check_growth("origin/dev", ["a", "b"]))

    def test_growing_is_allowed_with_a_dependency_change(self):
        with (
            mock.patch.object(typecheck, "_git", side_effect=self._git(["a"])),
            mock.patch.object(
                typecheck,
                "dependency_change_reason",
                return_value="changes apps/backend/requirements.dev.txt",
            ),
        ):
            self.assertTrue(typecheck.check_growth("origin/dev", ["a", "b"]))
