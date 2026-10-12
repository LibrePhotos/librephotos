"""Owned rows are scoped through the model's manager, not an inline owner filter.

Every owned model has ``owned_by(user)`` / ``get_owned(user, ...)`` (and
``owned_or_shared_to`` where it has ``shared_to``) from ``api/models/scopes.py``,
which names the owner column once per model: ``owner``, ``cluster_owner``
(Person), ``started_by`` (LongRunningJob), ``photo__owner`` (Face). This
module walks ``api/`` and ``nextcloud/`` (not tests, not migrations) and fails
on a ``filter`` / ``exclude`` / ``get`` / ``first`` / ``get_object_or_404`` /
``Q`` call with a keyword that ends in one of those columns, e.g.
``Tag.objects.filter(owner=request.user)`` or ``Q(photos__owner=user)``.

Allowed: ``api/models/scopes.py`` and the ``*QuerySet`` classes in
``api/models/``, a call carrying ``# owner-scope: <reason>`` on one of its
lines (a condition between two rows, such as "the album's owner is the
photo's owner", rather than a scope to a user), and the per-file counts in
``owner_scope_baseline.txt``. The baseline only shrinks: the test fails when
a file has more sites than its entry, and when an entry is higher than the
tree (lower it in the same change that converts a site).
"""

import ast
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
BASELINE = Path(__file__).resolve().parent / "owner_scope_baseline.txt"
ROOTS = ("api", "nextcloud")
SKIPPED_DIRS = frozenset({"tests", "migrations", "__pycache__"})
ALLOWED_FILES = frozenset({"api/models/scopes.py"})
MARK = "# owner-scope:"

CALLS = frozenset({"filter", "exclude", "get", "first", "get_object_or_404", "Q"})
OWNER_COLUMNS = frozenset(
    {
        "owner",
        "owner_id",
        "cluster_owner",
        "cluster_owner_id",
        "started_by",
        "started_by_id",
    }
)
# Lookups that still compare the owner column with a user (or users).
EQUALITY_LOOKUPS = frozenset({"exact", "in"})


@dataclass(frozen=True)
class Site:
    path: str
    line: int
    call: str
    keyword: str

    def describe(self) -> str:
        return f"{self.path}:{self.line}: {self.call}({self.keyword}=...)"


def is_owner_keyword(keyword: str) -> bool:
    """``owner``, ``photo__owner``, ``owner__in``; not ``owner__username``."""
    parts = keyword.split("__")
    if len(parts) > 1 and parts[-1] in EQUALITY_LOOKUPS:
        parts = parts[:-1]
    return parts[-1] in OWNER_COLUMNS


def _call_name(node: ast.Call) -> str | None:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _queryset_class_lines(tree: ast.Module) -> set[int]:
    """Lines inside a ``*QuerySet`` class: where each model names its column."""
    lines: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name.endswith("QuerySet"):
            end = node.end_lineno or node.lineno
            lines.update(range(node.lineno, end + 1))
    return lines


def find_sites(source: str, path: str) -> list[Site]:
    """The inline owner filters in one module, minus the marked ones."""
    if path in ALLOWED_FILES:
        return []
    tree = ast.parse(source)
    source_lines = source.splitlines()
    exempt = _queryset_class_lines(tree) if path.startswith("api/models/") else set()
    sites = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        if name not in CALLS or node.lineno in exempt:
            continue
        end = node.end_lineno or node.lineno
        if any(MARK in line for line in source_lines[node.lineno - 1 : end]):
            continue
        sites.extend(
            Site(path, node.lineno, name, kw.arg)
            for kw in node.keywords
            if kw.arg is not None and is_owner_keyword(kw.arg)
        )
    return sites


def iter_modules(backend: Path = BACKEND) -> Iterator[tuple[str, Path]]:
    for root in ROOTS:
        for path in sorted((backend / root).rglob("*.py")):
            rel = path.relative_to(backend)
            if SKIPPED_DIRS.intersection(rel.parts[:-1]):
                continue
            yield rel.as_posix(), path


def collect(backend: Path = BACKEND) -> list[Site]:
    sites: list[Site] = []
    for rel, path in iter_modules(backend):
        sites.extend(find_sites(path.read_text(encoding="utf-8"), rel))
    return sites


def read_baseline(path: Path = BASELINE) -> dict[str, int]:
    counts: dict[str, int] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, _, count = line.rpartition(":")
        counts[name.strip()] = int(count)
    return counts


def problems(actual: Counter[str], baseline: dict[str, int]) -> list[str]:
    """Files above their entry (new sites) or below it (entry not lowered)."""
    found = []
    for path in sorted(actual.keys() | baseline.keys()):
        have, allowed = actual.get(path, 0), baseline.get(path, 0)
        if have > allowed:
            found.append(f"{path}: {have} inline owner filters, baseline {allowed}")
        elif have < allowed:
            found.append(
                f"{path}: baseline {allowed} but only {have} left; lower the entry"
            )
    return found


def render_baseline(actual: Counter[str]) -> str:
    return "\n".join(f"{path}: {actual[path]}" for path in sorted(actual))


class OwnerScopeCallsTest(SimpleTestCase):
    def test_the_tree_matches_the_baseline(self):
        sites = collect()
        actual = Counter(site.path for site in sites)
        found = problems(actual, read_baseline())
        flagged = {p.split(":")[0] for p in found}
        details = [s.describe() for s in sites if s.path in flagged]
        self.assertEqual(
            found,
            [],
            "Scope owned rows through the manager: Model.objects.owned_by(user), "
            "get_owned(user, ...), owned_or_shared_to(user), or owner_q(user, "
            "through=...) inside one filter() call (api/models/scopes.py). "
            "Never spell owner=/cluster_owner=/started_by=/photo__owner=.\n"
            + "\n".join(details)
            + "\nBaseline entries for the current tree:\n"
            + render_baseline(actual),
        )

    def test_views_have_no_baseline_entries(self):
        """api/views/ is fully converted: no entry may come back."""
        self.assertEqual(
            [path for path in read_baseline() if path.startswith("api/views/")], []
        )

    def test_the_walk_sees_the_view_modules(self):
        paths = {rel for rel, _ in iter_modules()}
        self.assertIn("api/views/albums.py", paths)
        self.assertIn("api/models/scopes.py", paths)
        self.assertFalse(any("/tests/" in p or "/migrations/" in p for p in paths))


class OwnerScopeScannerTest(SimpleTestCase):
    def sites(self, source: str, path: str = "api/views/planted.py") -> list[str]:
        return [s.describe() for s in find_sites(source, path)]

    def test_a_planted_tag_filter_in_a_view_is_reported(self):
        self.assertEqual(
            self.sites("qs = Tag.objects.filter(owner=request.user)\n"),
            ["api/views/planted.py:1: filter(owner=...)"],
        )

    def test_every_owner_column_and_call_is_reported(self):
        source = (
            "Person.objects.get(cluster_owner=user)\n"
            "LongRunningJob.objects.filter(started_by=user).first()\n"
            "Face.objects.exclude(photo__owner=user)\n"
            "Q(photos__owner_id=user.id)\n"
            "get_object_or_404(AlbumUser, pk=1, owner__in=users)\n"
            "Photo.objects.filter(owner__exact=user)\n"
        )
        self.assertEqual(len(self.sites(source)), 6)

    def test_other_lookups_on_the_owner_are_not_scopes(self):
        source = (
            "AlbumUser.objects.filter(owner__username=name)\n"
            "Person.objects.filter(cluster_owner__isnull=True)\n"
            "Tag.objects.create(owner=user)\n"
            "Photo.objects.owned_by(user).filter(public=True)\n"
        )
        self.assertEqual(self.sites(source), [])

    def test_a_marked_call_is_accepted(self):
        source = (
            "photo.albumuser_set.filter(\n"
            "    owner_id=photo.owner_id  # owner-scope: same owner as the photo\n"
            ")\n"
        )
        self.assertEqual(self.sites(source), [])

    def test_queryset_classes_in_models_may_name_their_column(self):
        source = (
            "class TagQuerySet(OwnedQuerySet):\n"
            "    def mine(self, user):\n"
            "        return self.filter(owner=user)\n"
            "def helper(user):\n"
            "    return Tag.objects.filter(owner=user)\n"
        )
        self.assertEqual(
            self.sites(source, "api/models/tag.py"),
            ["api/models/tag.py:5: filter(owner=...)"],
        )
        self.assertEqual(len(self.sites(source, "api/views/tags.py")), 2)

    def test_the_scopes_module_is_allowed(self):
        self.assertEqual(
            self.sites("Q(owner=user)\n", "api/models/scopes.py"),
            [],
        )

    def test_a_count_above_the_baseline_fails(self):
        self.assertEqual(
            problems(Counter({"api/stats.py": 3}), {"api/stats.py": 2}),
            ["api/stats.py: 3 inline owner filters, baseline 2"],
        )

    def test_a_file_missing_from_the_baseline_fails(self):
        self.assertEqual(
            problems(Counter({"api/views/tags.py": 1}), {}),
            ["api/views/tags.py: 1 inline owner filters, baseline 0"],
        )

    def test_a_count_below_the_baseline_fails_until_lowered(self):
        self.assertEqual(
            problems(Counter({"api/stats.py": 1}), {"api/stats.py": 2}),
            ["api/stats.py: baseline 2 but only 1 left; lower the entry"],
        )
        self.assertEqual(
            problems(Counter(), {"api/stats.py": 1})[0][:13], "api/stats.py:"
        )
