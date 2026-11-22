import importlib.metadata
import re
from pathlib import Path

from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    BACKEND_ROOT,
    DEPLOY_DIR,
    REPO_ROOT,
    WORKFLOWS_DIR,
    repository_present,
)

NO_DEPS_FILE = "requirements.nodeps.txt"
UNUSED_DEPENDENCIES = {"tokenizers": {"huggingface-hub"}}
CODE_DIRS = ("api", "service", "librephotos", "nextcloud", "image_similarity")

_PIP_INSTALL = re.compile(r"\bpip3?\s+install\b([^;&|\n`]*)")
_PIN = re.compile(r"^([A-Za-z0-9_.-]+)\s*==\s*([^\s;]+)", re.MULTILINE)
_REQUIREMENT_NAME = re.compile(r"^\s*([A-Za-z0-9_.-]+)")


def _normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def pip_installs(text: str) -> list[tuple[list[str], bool]]:
    installs = []
    for match in _PIP_INSTALL.finditer(text):
        words = match.group(1).split()
        files = [
            words[i + 1]
            for i, word in enumerate(words[:-1])
            if word in ("-r", "--requirement")
        ]
        installs.append((files, "--no-deps" in words))
    return installs


def install_site_problems(text: str) -> list[str]:
    installs = [(files, no_deps) for files, no_deps in pip_installs(text) if files]
    full = [files for files, _ in installs if "requirements.txt" in files]
    no_deps = [files for files, flag in installs if NO_DEPS_FILE in files and flag]
    problems = []
    if any(NO_DEPS_FILE in files and not flag for files, flag in installs):
        problems.append(f"{NO_DEPS_FILE} installed without --no-deps")
    if any(files != [NO_DEPS_FILE] for files in no_deps):
        problems.append(f"{NO_DEPS_FILE} shares its --no-deps install")
    if len(no_deps) < len(full):
        problems.append(f"requirements.txt installed without {NO_DEPS_FILE}")
    return problems


def declared_dependencies(distribution: str) -> set[str]:
    requires = importlib.metadata.requires(distribution) or []
    names = set()
    for requirement in requires:
        _, _, marker = requirement.partition(";")
        if "extra" in marker:
            continue
        match = _REQUIREMENT_NAME.match(requirement)
        if match:
            names.add(_normalized(match.group(1)))
    return names


def _installed(distribution: str) -> bool:
    try:
        importlib.metadata.distribution(distribution)
    except importlib.metadata.PackageNotFoundError:
        return False
    return True


def _pins(path: Path) -> dict[str, str]:
    return {
        _normalized(name): version
        for name, version in _PIN.findall(path.read_text(encoding="utf-8"))
    }


class InstallSiteDetectionTest(SimpleTestCase):
    def test_a_site_that_installs_both_files_passes(self):
        self.assertEqual(
            [],
            install_site_problems(
                "RUN pip install --no-cache-dir -r requirements.txt\n"
                f"RUN pip install --no-cache-dir --no-deps -r {NO_DEPS_FILE}\n"
            ),
        )

    def test_a_site_that_skips_the_no_deps_file_fails(self):
        self.assertEqual(
            [f"requirements.txt installed without {NO_DEPS_FILE}"],
            install_site_problems(
                "pip install -r requirements.txt -r requirements.dev.txt\n"
            ),
        )

    def test_the_no_deps_file_needs_the_flag(self):
        self.assertIn(
            f"{NO_DEPS_FILE} installed without --no-deps",
            install_site_problems(
                f"pip install -r requirements.txt -r {NO_DEPS_FILE}\n"
            ),
        )

    def test_the_flag_never_covers_another_file(self):
        self.assertEqual(
            [f"{NO_DEPS_FILE} shares its --no-deps install"],
            install_site_problems(
                f"pip install --no-deps -r requirements.txt -r {NO_DEPS_FILE}\n"
            ),
        )

    def test_each_install_of_requirements_txt_needs_its_own(self):
        self.assertEqual(
            [f"requirements.txt installed without {NO_DEPS_FILE}"],
            install_site_problems(
                "pip install -r requirements.txt\n"
                f"pip install --no-deps -r {NO_DEPS_FILE}\n"
                "pip install --user -r requirements.txt\n"
            ),
        )


class NoDepsRequirementsTest(SimpleTestCase):
    def setUp(self):
        self.pins = _pins(BACKEND_ROOT / NO_DEPS_FILE)

    def test_every_package_names_the_dependencies_it_goes_without(self):
        self.assertEqual(set(UNUSED_DEPENDENCIES), set(self.pins))

    def test_no_package_is_also_in_requirements_txt(self):
        self.assertEqual(
            set(), set(self.pins) & set(_pins(BACKEND_ROOT / "requirements.txt"))
        )

    def test_every_other_declared_dependency_is_installed(self):
        for name, version in self.pins.items():
            if not _installed(name):
                self.skipTest(f"{name} is not installed")
            self.assertEqual(version, importlib.metadata.version(name), name)
            declared = declared_dependencies(name)
            unused = UNUSED_DEPENDENCIES[name]
            self.assertLessEqual(unused, declared, f"{name} no longer declares them")
            missing = sorted(dep for dep in declared - unused if not _installed(dep))
            self.assertEqual([], missing, f"{name} declares dependencies to install")

    def test_no_code_imports_a_dependency_left_out(self):
        modules = {
            dep.replace("-", "_")
            for deps in UNUSED_DEPENDENCIES.values()
            for dep in deps
        }
        pattern = re.compile(
            r"^\s*(?:from|import)\s+(?:"
            + "|".join(sorted(modules))
            + r")\b|from_pretrained",
            re.MULTILINE,
        )
        found = [
            path.relative_to(BACKEND_ROOT).as_posix()
            for folder in CODE_DIRS
            for path in sorted((BACKEND_ROOT / folder).rglob("*.py"))
            if "tests" not in path.relative_to(BACKEND_ROOT).parts
            and pattern.search(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual([], found)


class NoDepsInstallSitesTest(SimpleTestCase):
    def setUp(self):
        if not repository_present():
            self.skipTest("needs the repository checkout")

    def sites(self) -> dict[str, str]:
        paths = [
            *DEPLOY_DIR.rglob("Dockerfile*"),
            *WORKFLOWS_DIR.glob("*.yml"),
            *(BACKEND_ROOT / "scripts").glob("*.sh"),
            *(BACKEND_ROOT / "scripts").glob("*.ps1"),
            *(REPO_ROOT / "apps" / "docs" / "docs").rglob("*.md"),
        ]
        return {
            path.relative_to(REPO_ROOT).as_posix(): path.read_text(encoding="utf-8")
            for path in sorted(paths)
        }

    def test_every_install_of_requirements_txt_adds_the_no_deps_file(self):
        sites = self.sites()
        problems = [
            f"{path}: {problem}"
            for path, text in sites.items()
            for problem in install_site_problems(text)
        ]
        self.assertEqual([], problems)
        self.assertIn("deploy/docker/backend/Dockerfile", sites)
        self.assertIn(".github/workflows/standalone-windows.yml", sites)

    def test_workflows_that_watch_requirements_txt_watch_the_no_deps_file(self):
        problems = [
            path
            for path, text in self.sites().items()
            if path.startswith(".github/workflows/")
            and "'apps/backend/requirements.txt'" in text
            and f"'apps/backend/{NO_DEPS_FILE}'" not in text
        ]
        self.assertEqual([], problems)
