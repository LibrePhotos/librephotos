"""The agent guides and contributor docs only cite things that exist.

Agents follow AGENTS.md literally, so a renamed test module, a moved file or a
stale version number in it turns into wrong code. This resolves what the docs
cite: every ``api.tests.<module>``, every backend-relative ``*.py``/``*.sh``
path, every ``path.py:NN`` line, and the React and Node majors.

Files outside apps/backend are checked only when the repository root is there
(not inside the backend Docker image).
"""

import json
import re
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
REPO = BACKEND.parent.parent
HAS_REPO = (REPO / "apps" / "frontend" / "package.json").is_file()

BACKEND_DOCS = [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "scripts/setup_test_env.sh",
    *(
        str(p.relative_to(BACKEND))
        for p in (BACKEND / "librephotos/settings").glob("*.py")
    ),
]
REPO_DOCS = [
    "AGENTS.md",
    "apps/frontend/AGENTS.md",
    "README.md",
    "apps/frontend/README.md",
]

TEST_MODULE = re.compile(r"\bapi\.tests(?:\.\w+)+")
BACKEND_TOPS = (
    "api",
    "librephotos",
    "service",
    "scripts",
    "image_similarity",
    "nextcloud",
    "chunked_upload",
)
BACKEND_PATH = re.compile(
    r"(?<![\w/.-])((?:{})/[\w/.-]*?\.(?:py|sh))(?::(\d+))?\b".format(
        "|".join(BACKEND_TOPS)
    )
)


def _docs() -> list[tuple[str, str]]:
    found = [
        (f"apps/backend/{name}", (BACKEND / name).read_text(encoding="utf-8"))
        for name in BACKEND_DOCS
    ]
    if HAS_REPO:
        found += [
            (name, (REPO / name).read_text(encoding="utf-8")) for name in REPO_DOCS
        ]
    return found


def missing_test_modules(text: str) -> list[str]:
    missing = []
    for dotted in TEST_MODULE.findall(text):
        parts = dotted.split(".")
        # A dotted name may end in a class or method: it resolves if some prefix
        # of at least `api.tests.<x>` is a module or package.
        resolves = any(
            (BACKEND.joinpath(*parts[:n]).with_suffix(".py")).is_file()
            or (BACKEND.joinpath(*parts[:n]) / "__init__.py").is_file()
            for n in range(3, len(parts) + 1)
        )
        if not resolves and dotted != "api.tests":
            missing.append(dotted)
    return missing


def bad_paths(text: str) -> list[str]:
    bad = []
    for path, line in BACKEND_PATH.findall(text):
        target = BACKEND / path
        if "<" in path or "*" in path:
            continue
        if not target.is_file():
            bad.append(path)
        elif line and int(line) > len(target.read_text(encoding="utf-8").splitlines()):
            bad.append(f"{path}:{line}")
    return bad


class AgentDocsReferencesTest(SimpleTestCase):
    def test_cited_test_modules_exist(self):
        for name, text in _docs():
            with self.subTest(doc=name):
                self.assertEqual(missing_test_modules(text), [])

    def test_cited_backend_paths_exist(self):
        for name, text in _docs():
            with self.subTest(doc=name):
                self.assertEqual(bad_paths(text), [])

    def test_react_major_matches_the_web_app(self):
        if not HAS_REPO:
            self.skipTest("repository root not available")
        package = json.loads(
            (REPO / "apps/frontend/package.json").read_text(encoding="utf-8")
        )
        major = package["dependencies"]["react"].lstrip("^~").split(".")[0]
        for name, text in _docs():
            for cited in re.findall(r"\bReact (\d+)\b", text):
                with self.subTest(doc=name):
                    self.assertEqual(cited, major)

    def test_node_major_matches_nvmrc(self):
        if not HAS_REPO:
            self.skipTest("repository root not available")
        major = (
            (REPO / "apps/frontend/.nvmrc")
            .read_text(encoding="utf-8")
            .strip()
            .lstrip("v")
            .split(".")[0]
        )
        docs = _docs() + [
            (str(p.relative_to(REPO)), p.read_text(encoding="utf-8"))
            for p in (REPO / "apps/docs/docs").rglob("*.md")
        ]
        for name, text in docs:
            for cited in re.findall(r"\bNode(?:\.js)? (\d+)\b", text):
                with self.subTest(doc=name):
                    self.assertEqual(cited, major)


class CheckersCatchPlantedDriftTest(SimpleTestCase):
    def test_a_missing_test_module_is_reported(self):
        self.assertEqual(
            missing_test_modules("run api.tests.does_not_exist"),
            ["api.tests.does_not_exist"],
        )

    def test_a_class_inside_a_real_module_resolves(self):
        self.assertEqual(
            missing_test_modules(
                "api.tests.infra.test_agent_docs_references.AgentDocsReferencesTest"
            ),
            [],
        )

    def test_a_missing_path_and_a_line_past_the_end_are_reported(self):
        self.assertEqual(
            bad_paths("see api/nope.py and api/request_user.py:9999"),
            ["api/nope.py", "api/request_user.py:9999"],
        )
