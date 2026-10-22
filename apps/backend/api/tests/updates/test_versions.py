"""Release tags as versions (#2311): which ones compare, and in which order."""

from django.test import SimpleTestCase

from api.updates.versions import is_newer, parse_version


class VersionOrderTest(SimpleTestCase):
    def test_semver_compares_by_number(self):
        self.assertTrue(is_newer("1.3.0", "1.2.1"))
        self.assertTrue(is_newer("1.10.0", "1.9.9"))
        self.assertTrue(is_newer("2.0.0", "1.99.99"))
        self.assertFalse(is_newer("1.2.1", "1.3.0"))
        self.assertFalse(is_newer("1.3.0", "1.3.0"))

    def test_every_weekly_tag_is_older_than_1_0_0(self):
        self.assertTrue(is_newer("1.0.0", "2026w25"))
        self.assertTrue(is_newer("1.0.0", "2099w52"))
        self.assertFalse(is_newer("2026w25", "1.0.0"))

    def test_weekly_tags_compare_by_year_then_week(self):
        self.assertTrue(is_newer("2026w25", "2026w9"))
        self.assertTrue(is_newer("2026w01", "2025w52"))

    def test_a_leading_v_and_spaces_are_allowed(self):
        self.assertEqual(parse_version(" v1.4.0 "), parse_version("1.4.0"))

    def test_what_is_not_a_version_is_never_offered(self):
        for tag in (
            "dev",
            "",
            "windows-wheels-2026.09.16",
            "1.5.0-rc1",
            "1.5",
            "latest",
        ):
            with self.subTest(tag=tag):
                self.assertIsNone(parse_version(tag))
                self.assertFalse(is_newer(tag, "1.0.0"))
                self.assertFalse(is_newer("9.9.9", tag))
