"""Numbers a recipe or a history step cannot hold are a 400, never a 500.

JSON allows an integer of any length; ``float()`` of one past about 1e308
raises ``OverflowError``. Each numeric entry point of the edit request is
fed the numbers that break a naive parser.
"""

from __future__ import annotations

from typing import Any

from api.editing.recipe import recipe_from_json
from api.tests.editing.edited_photo import EditedPhotoTestCase

HUGE = "1" + "0" * 400
STEP = '{"action": "set", "at": "2026-11-12T09:30:00Z", "settings": {"version": 1}'


class HugeNumberTest(EditedPhotoTestCase):
    def put_raw(self, raw: str) -> Any:
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.generic(
                "PUT", self.url(), raw, content_type="application/json"
            )

    def assert_refused(self, raw: str, code: str, field: str | None = None) -> None:
        response = self.put_raw(raw)
        self.assertEqual(response.status_code, 400, response.content[:300])
        (error,) = response.json()["errors"]
        self.assertEqual(error["code"], code)
        if field is not None:
            self.assertEqual(error["field"], field)

    def body(self, settings: str, history: str = "[]", cursor: str = "-1") -> str:
        return (
            f'{{"settings": {settings}, "history": {history}, '
            f'"history_cursor": {cursor}}}'
        )

    def test_a_huge_integer_in_the_settings(self):
        self.assert_refused(
            self.body(f'{{"version": 1, "light": {{"exposure": {HUGE}}}}}'),
            "invalid_recipe",
            "settings.light.exposure",
        )

    def test_a_huge_negative_integer_in_the_settings(self):
        self.assert_refused(
            self.body(f'{{"version": 1, "wb": {{"temp": -{HUGE}}}}}'),
            "invalid_recipe",
            "settings.wb.temp",
        )

    def test_a_huge_seed_crop_and_curve_point(self):
        for settings, field in (
            (f'{{"version": 1, "grain": {{"seed": {HUGE}}}}}', "settings.grain.seed"),
            (
                f'{{"version": 1, "geometry": {{"crop": {{"cx": {HUGE}, "cy": 0.5, '
                '"w": 0.5, "h": 0.5}}}',
                "settings.geometry.crop",
            ),
            (
                f'{{"version": 1, "curve": {{"master": [[0, 0], [1, {HUGE}]]}}}}',
                "settings.curve",
            ),
        ):
            with self.subTest(field=field):
                response = self.put_raw(self.body(settings))
                self.assertEqual(response.status_code, 400)
                (error,) = response.json()["errors"]
                self.assertEqual(error["code"], "invalid_recipe")
                self.assertTrue(error["field"].startswith(field))

    def test_a_huge_version(self):
        self.assert_refused(self.body(f'{{"version": {HUGE}}}'), "invalid_recipe")

    def test_a_huge_integer_as_a_step_value(self):
        self.assert_refused(
            self.body('{"version": 1}', f'[{STEP}, "value": {HUGE}}}]', "0"),
            "invalid_step",
            "history.0.value",
        )

    def test_a_huge_integer_in_a_step_recipe(self):
        self.assert_refused(
            self.body(
                '{"version": 1}',
                '[{"action": "set", "at": "2026-11-12T09:30:00Z", '
                f'"settings": {{"version": 1, "light": {{"exposure": {HUGE}}}}}}}]',
            ),
            "invalid_recipe",
            "history.0.settings.light.exposure",
        )

    def test_a_huge_exponent_is_not_finite(self):
        self.assert_refused(
            self.body('{"version": 1, "light": {"exposure": 1e400}}'),
            "invalid_recipe",
            "settings.light.exposure",
        )
        self.assert_refused(
            self.body('{"version": 1}', f'[{STEP}, "value": -1e400}}]', "0"),
            "invalid_step",
            "history.0.value",
        )

    def test_a_huge_cursor(self):
        self.assert_refused(self.body('{"version": 1}', cursor=HUGE), "invalid_cursor")

    def test_a_boolean_is_not_a_number(self):
        self.assert_refused(
            self.body('{"version": 1, "light": {"exposure": true}}'),
            "invalid_recipe",
            "settings.light.exposure",
        )

    def test_a_list_where_a_number_belongs(self):
        nested = "[" * 50 + "1" + "]" * 50
        self.assert_refused(
            self.body(f'{{"version": 1, "light": {{"exposure": {nested}}}}}'),
            "invalid_recipe",
            "settings.light.exposure",
        )
        self.assert_refused(
            self.body('{"version": 1}', f'[{STEP}, "value": {nested}}}]', "0"),
            "invalid_step",
            "history.0.value",
        )

    def test_a_number_too_long_to_parse_is_refused(self):
        # Python refuses integers of more than 4300 digits when it parses JSON.
        response = self.put_raw(
            self.body(f'{{"version": 1, "light": {{"exposure": 1{"0" * 5000}}}}}')
        )
        self.assertEqual(response.status_code, 400)

    def test_minus_zero_is_zero(self):
        response = self.put_raw(
            self.body('{"version": 1, "light": {"exposure": -0}, "wb": {"temp": -0.0}}')
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["settings"], {"version": 1})
        self.assertEqual(response.json()["rendition"], "none")

    def test_the_parser_says_value_error_not_overflow(self):
        with self.assertRaisesMessage(ValueError, "light.exposure"):
            recipe_from_json({"version": 1, "light": {"exposure": 10**400}})
