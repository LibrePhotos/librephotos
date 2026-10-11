"""Test rows come from api/tests/utils.py, and the raw creates that remain only shrink.

scripts/factory_baseline.py counts ``<Model>.objects.create(...)`` calls in test
modules for the models that have a factory. The count per file is pinned in
api/tests/infra/test_data_baseline.txt. This module fails when a file has more
raw creates than its entry, when an entry is stale, and when a file that is not
listed has any. The photo factory is checked here too: its image hash is the
hash of its main file, and its file lives in the test media directory.
"""

import importlib.util
import sys
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, TestCase

from api.tests import utils

BACKEND = Path(__file__).resolve().parents[3]
_SCRIPT = BACKEND / "scripts" / "factory_baseline.py"
# A unique name: dataclasses looks the module up in sys.modules while it loads.
_spec = importlib.util.spec_from_file_location("_factory_baseline", _SCRIPT)
assert _spec is not None and _spec.loader is not None
factory_baseline = importlib.util.module_from_spec(_spec)
sys.modules["_factory_baseline"] = factory_baseline
_spec.loader.exec_module(factory_baseline)

REGENERATE = "run `python scripts/factory_baseline.py --update` and commit the result"


class RawCreateBaselineTest(SimpleTestCase):
    def test_the_tree_matches_the_baseline(self):
        hits = factory_baseline.collect(BACKEND)
        actual = factory_baseline.count_by_file(hits)
        found = factory_baseline.problems(actual, factory_baseline.read_baseline())
        details = []
        for hit in hits:
            if not hit.accepted and hit.path in {p.split(":")[0] for p in found}:
                details.append(hit.describe())
        self.assertEqual(
            found,
            [],
            "Raw creates for models with a factory. Use the factory in "
            "api/tests/utils.py (add one there if it is missing). Where a row must "
            "stay raw, put `# raw-create: <reason>` on the line.\n"
            + "\n".join(details)
            + f"\n{REGENERATE}",
        )

    def test_every_covered_model_has_its_factory(self):
        for model, factory in factory_baseline.FACTORIES.items():
            with self.subTest(model=model):
                self.assertTrue(
                    callable(getattr(utils, factory, None)),
                    f"{factory} is missing from api/tests/utils.py",
                )

    def test_the_factories_module_is_not_counted(self):
        paths = {path.relative_to(BACKEND).as_posix() for path in factory_baseline.iter_test_modules(BACKEND)}
        self.assertNotIn(factory_baseline.UTILS, paths)
        self.assertIn("api/tests/infra/test_test_data_factories.py", paths)


class RawCreateScannerTest(SimpleTestCase):
    def test_a_planted_raw_create_is_counted(self):
        hits = factory_baseline.find_raw_creates(
            "from api.models import PhotoStack\n"
            "stack = PhotoStack.objects.create(owner=user)\n",
            "api/tests/stacks/test_planted.py",
        )
        self.assertEqual([(h.line, h.model, h.method) for h in hits], [(2, "PhotoStack", "create")])
        self.assertFalse(hits[0].accepted)

    def test_bulk_and_get_or_create_are_counted(self):
        source = (
            "Tag.objects.get_or_create(name='a', owner=u)\n"
            "File.objects.bulk_create([])\n"
            "User.objects.create_user('x')\n"
        )
        hits = factory_baseline.find_raw_creates(source, "api/tests/test_x.py")
        self.assertEqual([h.method for h in hits], ["get_or_create", "bulk_create", "create_user"])

    def test_models_without_a_factory_are_not_counted(self):
        source = "Thumbnail.objects.create(photo=p)\nPhoto.visible.create()\nmodels.objects.create()\n"
        self.assertEqual(factory_baseline.find_raw_creates(source, "api/tests/test_x.py"), [])

    def test_a_reason_comment_on_any_line_of_the_call_accepts_it(self):
        source = (
            "row = Duplicate.objects.create(\n"
            "    owner=u,  # raw-create: the constraint is the thing under test\n"
            ")\n"
        )
        [hit] = factory_baseline.find_raw_creates(source, "api/tests/test_x.py")
        self.assertTrue(hit.accepted)
        self.assertEqual(factory_baseline.count_by_file([hit]), {})

    def test_only_test_modules_are_walked(self):
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            for rel in (
                "api/tests/stacks/test_a.py",
                "api/feature/tests/helpers.py",
                "api/models/photo.py",
                "api/tests/utils.py",
                ".venv-win/Lib/site-packages/tests/test_vendored.py",
            ):
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("", encoding="utf-8")
            found = sorted(
                p.relative_to(root).as_posix()
                for p in factory_baseline.iter_test_modules(root)
            )
        self.assertEqual(
            found, ["api/feature/tests/helpers.py", "api/tests/stacks/test_a.py"]
        )


class BaselineComparisonTest(SimpleTestCase):
    def test_a_file_with_more_raw_creates_than_listed_fails(self):
        found = factory_baseline.problems({"api/tests/a.py": 3}, {"api/tests/a.py": 2})
        self.assertEqual(len(found), 1)
        self.assertIn("3 raw creates, baseline allows 2", found[0])

    def test_a_new_file_with_raw_creates_fails(self):
        found = factory_baseline.problems({"api/tests/new.py": 1}, {})
        self.assertEqual(len(found), 1)

    def test_a_stale_entry_fails(self):
        found = factory_baseline.problems({"api/tests/a.py": 1}, {"api/tests/a.py": 2})
        self.assertEqual(len(found), 1)
        self.assertIn("regenerate", found[0])

    def test_an_entry_for_a_file_now_clean_fails(self):
        found = factory_baseline.problems({}, {"api/tests/gone.py": 4})
        self.assertEqual(len(found), 1)

    def test_a_matching_baseline_passes(self):
        self.assertEqual(
            factory_baseline.problems({"a.py": 2}, {"a.py": 2}), []
        )

    def test_render_and_read_round_trip(self):
        with tempfile.TemporaryDirectory() as root_name:
            path = Path(root_name) / "baseline.txt"
            text = factory_baseline.render_baseline({"b/test_b.py": 2, "a/test_a.py": 1, "c.py": 0})
            path.write_text(text, encoding="utf-8")
            self.assertEqual(
                factory_baseline.read_baseline(path),
                {"a/test_a.py": 1, "b/test_b.py": 2},
            )
        self.assertTrue(text.startswith("# do not edit by hand"))
        self.assertLess(text.index("a/test_a.py"), text.index("b/test_b.py"))


class CreateTestPhotoTest(TestCase):
    def setUp(self) -> None:
        self.owner = utils.create_test_user()

    def test_image_hash_is_the_main_file_hash(self) -> None:
        photo = utils.create_test_photo(owner=self.owner)
        self.assertEqual(photo.image_hash, photo.main_file.hash)

    def test_the_hash_carries_the_owner_id(self) -> None:
        photo = utils.create_test_photo(owner=self.owner)
        self.assertTrue(photo.main_file.hash.endswith(str(self.owner.id)))
        self.assertEqual(len(photo.main_file.hash), 32 + len(str(self.owner.id)))

    def test_the_main_file_lives_in_the_test_media_directory(self) -> None:
        photo = utils.create_test_photo(owner=self.owner)
        path = Path(photo.main_file.path)
        self.assertTrue(path.is_file())
        self.assertEqual(path.parent, Path(utils.TEST_MEDIA_ROOT))
        self.assertNotEqual(path.parent, Path(tempfile.gettempdir()))

    def test_each_photo_gets_its_own_file(self) -> None:
        first, second = utils.create_test_photos(2, owner=self.owner)
        self.assertNotEqual(first.main_file.path, second.main_file.path)
        self.assertNotEqual(first.image_hash, second.image_hash)
