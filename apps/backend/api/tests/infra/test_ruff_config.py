"""The backend ruff config: rules, banned APIs, the baseline and the Python floor.

The tests that lint run the pinned ruff from the test environment
(requirements.dev.txt) and skip where it is not installed, as in the production
image. Source is fed through stdin with a project path as its name, so it is
checked exactly as a file at that path would be, without writing one.
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

BACKEND = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
HAS_RUFF = importlib.util.find_spec("ruff") is not None

_spec = importlib.util.spec_from_file_location(
    "_ruff_baseline_script", os.path.join(BACKEND, "scripts", "ruff_baseline.py")
)
assert _spec is not None and _spec.loader is not None
ruff_baseline = importlib.util.module_from_spec(_spec)
# A unique name: dataclasses looks the module up in sys.modules while it loads.
sys.modules["_ruff_baseline_script"] = ruff_baseline
_spec.loader.exec_module(ruff_baseline)


def run_ruff(*args, stdin=None):
    return subprocess.run(
        [sys.executable, "-m", "ruff", *args],
        cwd=BACKEND,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def lint(source, path):
    """Codes ruff reports for `source` as if it were the file at `path`."""
    result = run_ruff(
        "check",
        "--no-cache",
        "--output-format",
        "json",
        "--stdin-filename",
        path,
        "-",
        stdin=source,
    )
    if result.returncode not in (0, 1):
        raise AssertionError(result.stderr)
    return {item["code"] for item in json.loads(result.stdout)}


def read(path):
    with open(os.path.join(BACKEND, path), encoding="utf-8") as handle:
        return handle.read()


PLANTED = """\
import os
import datetime
from datetime import UTC


def probe():
    try:
        os.listdir(".")
    except Exception:
        pass
    print(datetime.datetime.now(UTC))
"""


def finding(path, code, row=1):
    return ruff_baseline.Finding(
        path=path, code=code, row=row, column=1, message="boom"
    )


@unittest.skipUnless(HAS_RUFF, "ruff is not installed (requirements.dev.txt)")
class PythonFloorSyntaxTests(unittest.TestCase):
    def test_backend_parses_on_python_310(self):
        # The backend-gpu image runs Python 3.10 (CUDA 12.1.1 / ubuntu22.04).
        # Syntax added later (PEP 646 star expressions in subscripts, PEP 701
        # f-strings, ...) is a SyntaxError there and the module fails to import.
        result = run_ruff(
            "check",
            "--no-cache",
            "--exit-zero",
            "--target-version",
            "py310",
            "--select",
            "E9",
            "--output-format",
            "json",
            ".",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        syntax = [
            f"{os.path.relpath(item['filename'], BACKEND)}:"
            f"{item['location']['row']}: {item['message']}"
            for item in json.loads(result.stdout)
            if item["code"] in (None, "invalid-syntax")
        ]
        self.assertEqual(syntax, [], "syntax Python 3.10 rejects")

    def test_config_targets_python_310(self):
        # pyupgrade would otherwise rewrite datetime.timezone.utc to datetime.UTC.
        source = "import datetime\n\nprint(datetime.timezone.utc)\n"
        self.assertNotIn("UP017", lint(source, "scripts/_ruff_probe.py"))


@unittest.skipUnless(HAS_RUFF, "ruff is not installed (requirements.dev.txt)")
class NewCodeRulesTests(unittest.TestCase):
    def test_a_new_file_fails_the_intended_rules(self):
        codes = lint(PLANTED, "api/_ruff_probe.py")
        for code in ("BLE001", "S110", "I001", "T201", "TID251"):
            self.assertIn(code, codes)

    def test_banned_api_also_catches_attribute_access(self):
        source = "import datetime\n\nNOW = datetime.datetime.now(datetime.UTC)\n"
        self.assertIn("TID251", lint(source, "api/_ruff_probe.py"))

    def test_subprocess_is_banned_outside_the_tool_runner(self):
        # Issue #2338: tools run through api.binaries, which demands a timeout.
        for source in (
            "import subprocess\n\nsubprocess.run(['ffmpeg'], check=True)\n",
            "from subprocess import Popen\n\nPopen(['ffmpeg'])\n",
        ):
            self.assertIn("TID251", lint(source, "api/views/_ruff_probe.py"))
            for exempt in (
                "api/binaries.py",
                "api/services.py",
                "librephotos/standalone.py",
                "scripts/_ruff_probe.py",
                "api/tests/_ruff_probe.py",
            ):
                self.assertNotIn("TID251", lint(source, exempt), exempt)

    def test_console_tools_may_print(self):
        source = 'print("hello")\n'
        self.assertIn("T201", lint(source, "api/_ruff_probe.py"))
        self.assertNotIn("T201", lint(source, "scripts/_ruff_probe.py"))


@unittest.skipUnless(HAS_RUFF, "ruff is not installed (requirements.dev.txt)")
class BaselineConfigTests(unittest.TestCase):
    """ruff-baseline.toml silences the listed codes in the listed files, nothing more."""

    def setUp(self):
        entries = ruff_baseline.parse_baseline(read("ruff-baseline.toml"))
        self.path = next(
            path
            for path, codes in sorted(entries.items())
            if "BLE001" in codes and not any(c.startswith("T20") for c in codes)
        )
        self.source = read(self.path)

    def test_a_listed_file_passes(self):
        self.assertEqual(lint(self.source, self.path), set())

    def test_a_new_violation_in_a_listed_file_fails(self):
        codes = lint(self.source + '\nprint("new")\n', self.path)
        self.assertEqual(codes, {"T201"})

    def test_the_same_findings_in_an_unlisted_file_fail(self):
        self.assertIn("BLE001", lint(self.source, "api/_ruff_probe_copy.py"))


class RenderAndParseTests(unittest.TestCase):
    def test_render_is_sorted_and_round_trips(self):
        entries = {"b.py": {"N802", "BLE001"}, "a/x.py": {"G004"}}
        text = ruff_baseline.render(entries)
        self.assertIn("Do not edit by hand", text)
        lines = [line for line in text.splitlines() if line.startswith('"')]
        self.assertEqual(lines, ['"a/x.py" = ["G004"]', '"b.py" = ["BLE001", "N802"]'])
        self.assertEqual(ruff_baseline.parse_baseline(text), entries)

    def test_paths_with_glob_characters_are_refused(self):
        with self.assertRaises(ruff_baseline.RuffError):
            ruff_baseline.render({"api/[x].py": {"N802"}})

    def test_syntax_errors_keep_a_code(self):
        out = json.dumps(
            [
                {
                    "filename": os.path.join(BACKEND, "api", "x.py"),
                    "code": None,
                    "location": {"row": 3, "column": 1},
                    "message": "bad",
                }
            ]
        )
        [parsed] = ruff_baseline.parse_findings(out)
        self.assertEqual((parsed.path, parsed.code), ("api/x.py", "invalid-syntax"))


class CheckTests(unittest.TestCase):
    """What fails the check, with ruff's findings faked."""

    def setUp(self):
        self.findings = [finding("api/a.py", "BLE001"), finding("api/b.py", "N802")]
        self.committed = ruff_baseline.render(ruff_baseline.group(self.findings))

    def check(self, findings, committed, base_ref=None):
        with mock.patch("sys.stderr"), mock.patch("sys.stdout"):
            return ruff_baseline.check(findings, committed, base_ref)

    def test_matching_baseline_passes(self):
        self.assertTrue(self.check(self.findings, self.committed))

    def test_a_new_file_code_pair_fails(self):
        findings = [*self.findings, finding("api/a.py", "T201")]
        self.assertFalse(self.check(findings, self.committed))

    def test_fixing_a_finding_without_update_fails(self):
        self.assertFalse(self.check(self.findings[:1], self.committed))

    def test_another_finding_of_a_listed_pair_passes(self):
        # Per file and code, not per finding: the documented trade-off.
        findings = [*self.findings, finding("api/a.py", "BLE001", row=99)]
        self.assertTrue(self.check(findings, self.committed))

    def test_a_hand_edited_baseline_fails(self):
        edited = self.committed.replace("# Do not edit by hand.", "#")
        self.assertFalse(self.check(self.findings, edited))


class GrowthTests(unittest.TestCase):
    """--base-ref: the committed baseline may only lose entries."""

    OLD = ruff_baseline.render({"api/a.py": {"BLE001"}, "api/old.py": {"N802"}})

    def git(self, old_baseline, old_pyproject=None, renames=""):
        pyproject = read("pyproject.toml")

        def fake(*args):
            if args[0] == "show" and args[1].endswith("ruff-baseline.toml"):
                return subprocess.CompletedProcess(args, 0, old_baseline, "")
            if args[0] == "show":
                return subprocess.CompletedProcess(
                    args, 0, old_pyproject or pyproject, ""
                )
            return subprocess.CompletedProcess(args, 0, renames, "")

        return mock.patch.object(ruff_baseline, "_git", side_effect=fake)

    def grows(self, committed, **kwargs):
        with self.git(self.OLD, **kwargs), mock.patch("sys.stderr"):
            with mock.patch("sys.stdout"):
                return not ruff_baseline.check_growth("origin/dev", committed)

    def test_shrinking_passes(self):
        self.assertFalse(self.grows({"api/a.py": {"BLE001"}}))

    def test_an_added_pair_fails(self):
        self.assertTrue(self.grows({"api/a.py": {"BLE001", "T201"}}))

    def test_an_added_file_fails(self):
        self.assertTrue(self.grows({"api/new.py": {"BLE001"}}))

    def test_a_renamed_file_keeps_its_entry(self):
        renames = "R097\tapps/backend/api/old.py\tapps/backend/api/moved.py\n"
        self.assertFalse(self.grows({"api/moved.py": {"N802"}}, renames=renames))
        self.assertTrue(
            self.grows({"api/moved.py": {"N802", "BLE001"}}, renames=renames)
        )

    def test_a_ruff_config_change_allows_growth(self):
        old_pyproject = read("pyproject.toml").replace('"BLE001",  #', '"BLE002",  #')
        self.assertFalse(
            self.grows({"api/new.py": {"BLE001"}}, old_pyproject=old_pyproject)
        )

    def test_a_comment_change_does_not_allow_growth(self):
        old_pyproject = read("pyproject.toml").replace(
            "# pep8-naming", "# naming conventions"
        )
        self.assertTrue(
            self.grows({"api/new.py": {"BLE001"}}, old_pyproject=old_pyproject)
        )


@unittest.skipUnless(HAS_RUFF, "ruff is not installed (requirements.dev.txt)")
class ScriptEndToEndTests(unittest.TestCase):
    """main() with the real ruff on the real tree, against a temporary baseline."""

    def run_main(self, baseline_text, *args):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ruff-baseline.toml")
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(baseline_text)
            with (
                mock.patch.object(ruff_baseline, "BASELINE", ruff_baseline.Path(path)),
                mock.patch("sys.stdout"),
                mock.patch("sys.stderr"),
            ):
                return ruff_baseline.main(list(args))

    def test_committed_baseline_is_up_to_date(self):
        self.assertEqual(self.run_main(read("ruff-baseline.toml"), "--check"), 0)

    def test_a_stale_entry_fails(self):
        # As if a finding had been fixed without running --update.
        entries = ruff_baseline.parse_baseline(read("ruff-baseline.toml"))
        path = sorted(entries)[0]
        entries[path].add("N802" if "N802" not in entries[path] else "N803")
        self.assertEqual(self.run_main(ruff_baseline.render(entries), "--check"), 1)

    def test_a_missing_entry_fails(self):
        lines = read("ruff-baseline.toml").splitlines(keepends=True)
        first_entry = next(i for i, line in enumerate(lines) if line.startswith('"'))
        del lines[first_entry]
        self.assertEqual(self.run_main("".join(lines), "--check"), 1)
