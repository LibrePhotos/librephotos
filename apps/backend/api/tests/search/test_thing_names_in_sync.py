import importlib.util
from pathlib import Path

from django.test import SimpleTestCase

from api.search.translate import LEXICONS, THING_NAMES_FILE, lexicon_for

BACKEND = Path(__file__).resolve().parents[3]
SCRIPT = BACKEND / "scripts" / "sync_thing_names.py"


def _sync_module():
    spec = importlib.util.spec_from_file_location("sync_thing_names", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ThingNamesTest(SimpleTestCase):
    def test_the_copy_matches_the_web_apps_translations(self):
        sync = _sync_module()
        if not (sync.LOCALES / "en" / "tags.json").exists():
            self.skipTest("the web app's locales are not in this checkout")
        self.assertEqual(
            THING_NAMES_FILE.read_text(encoding="utf-8"),
            sync.render(sync.collect(sync.LOCALES)),
            "run scripts/sync_thing_names.py",
        )

    def test_foreign_names_map_to_english_things(self):
        self.assertEqual(LEXICONS["de"]["strand"], "beach")
        self.assertEqual(LEXICONS["fr"]["plage"], "beach")

    def test_a_name_that_is_also_an_english_thing_keeps_its_english_meaning(self):
        self.assertNotIn("chat", LEXICONS["fr"])

    def test_the_language_of_the_app_picks_the_lexicon(self):
        self.assertIs(lexicon_for("de-DE"), LEXICONS["de"])
        self.assertIs(lexicon_for("pt_BR"), LEXICONS["pt_BR"])
        self.assertEqual(lexicon_for("en"), {})
        self.assertEqual(lexicon_for(""), {})
