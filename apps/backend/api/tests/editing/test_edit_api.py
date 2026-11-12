"""``/api/photos/<photo_id>/edit/`` and ``.../edit/source/``: shapes, rules, owners."""

from __future__ import annotations

import json
import os
from typing import Any

from api.editing.source import FILE_MAGIC
from api.models import PhotoEdit
from api.tests.editing.edited_photo import (
    CROP,
    EXPOSURE,
    EditedPhotoTestCase,
    body,
    jpeg_bytes,
    quadrants,
    recipe,
)
from api.tests.utils import create_test_user


class EditRoundTripTest(EditedPhotoTestCase):
    def test_a_photo_never_edited_answers_the_default_and_makes_no_row(self):
        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "photo_id": str(self.photo.pk),
                "settings": {"version": 1},
                "history": [],
                "history_cursor": -1,
                "version": 0,
                "rendition": "none",
                "updated_at": None,
            },
        )
        self.assertFalse(PhotoEdit.objects.filter(pk=self.photo.pk).exists())

    def test_put_stores_the_edit_and_get_answers_it(self):
        history = [
            {
                "action": "set",
                "control": "light.exposure",
                "value": 0.5,
                "at": "2026-11-12T09:30:00Z",
                "settings": recipe(light={"exposure": 0.5}),
            },
            {
                "action": "preset",
                "value": "warm",
                "at": "2026-11-12T09:31:00+00:00",
                "settings": EXPOSURE,
            },
        ]

        saved = self.save(EXPOSURE, history=history)

        self.assertEqual(saved["version"], 1)
        self.assertEqual(saved["rendition"], "pending")
        self.assertEqual(saved["settings"], {"version": 1, "light": {"exposure": 1.0}})
        self.assertEqual(saved["history"], history)
        self.assertEqual(saved["history_cursor"], 1)
        self.assertIsNotNone(saved["updated_at"])
        self.assertEqual(self.client.get(self.url()).json(), saved)
        self.assertEqual(self.save(EXPOSURE, history=history)["version"], 2)

    def test_the_cursor_may_stand_before_the_last_step(self):
        history = [
            {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": EXPOSURE},
            {"action": "crop", "at": "2026-11-12T09:31:00Z", "settings": CROP},
        ]
        saved = self.save(EXPOSURE, history=history, cursor=0)
        self.assertEqual(saved["history_cursor"], 0)
        self.assertEqual(len(saved["history"]), 2)

    def test_the_default_recipe_at_cursor_minus_one_keeps_the_history(self):
        history = [
            {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": EXPOSURE}
        ]
        saved = self.save(recipe(), history=history, cursor=-1)
        self.assertEqual(saved["rendition"], "none")
        self.assertEqual(saved["history"], history)

    def test_delete_removes_the_edit(self):
        self.save(EXPOSURE)

        response = self.delete_edit()

        self.assertEqual(response.status_code, 204)
        self.assertFalse(PhotoEdit.objects.filter(pk=self.photo.pk).exists())
        self.assertEqual(self.client.get(self.url()).json()["version"], 0)

    def test_delete_without_an_edit_is_fine(self):
        self.assertEqual(self.delete_edit().status_code, 204)


class EditValidationTest(EditedPhotoTestCase):
    def assert_refused(self, data: dict[str, Any], field: str, code: str) -> None:
        response = self.put(data)
        self.assertEqual(response.status_code, 400, response.content[:300])
        errors = response.json()["errors"]
        self.assertEqual(
            [(error["field"], error["code"]) for error in errors],
            [(field, code)],
            errors,
        )
        self.assertFalse(PhotoEdit.objects.filter(pk=self.photo.pk).exists())

    def test_a_number_out_of_range_names_its_path(self):
        bad = recipe(light={"exposure": 6})
        self.assert_refused(body(bad), "settings.light.exposure", "invalid_recipe")

    def test_an_unknown_key_is_refused(self):
        self.assert_refused(
            body(recipe(light={"glow": 1})), "settings.light", "invalid_recipe"
        )
        self.assert_refused(body(recipe(sparkle={})), "settings", "invalid_recipe")

    def test_a_bad_curve_is_refused(self):
        bad = recipe(curve={"master": [[0, 0], [0.5, 0.5], [0.4, 1]]})
        self.assert_refused(body(bad), "settings.curve.master", "invalid_recipe")

    def test_a_wrong_version_is_refused(self):
        self.assert_refused(body({"version": 2}), "settings.version", "invalid_recipe")

    def test_a_missing_field_is_refused(self):
        self.assert_refused(
            {"settings": EXPOSURE, "history": []}, "history_cursor", "required"
        )

    def test_a_step_with_a_bad_recipe_names_its_path(self):
        history = [
            {
                "action": "set",
                "at": "2026-11-12T09:30:00Z",
                "settings": recipe(wb={"temp": 101}),
            }
        ]
        self.assert_refused(
            body(EXPOSURE, history=history),
            "history.0.settings.wb.temp",
            "invalid_recipe",
        )

    def test_step_rules(self):
        good = {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": EXPOSURE}
        cases = [
            ({**good, "action": "undo"}, "history.0.action"),
            ({**good, "control": "Light Exposure"}, "history.0.control"),
            ({**good, "control": "a" * 65}, "history.0.control"),
            ({**good, "value": "x" * 65}, "history.0.value"),
            ({**good, "value": [1]}, "history.0.value"),
            ({**good, "at": "yesterday"}, "history.0.at"),
            ({**good, "extra": 1}, "history.0"),
            (
                {key: value for key, value in good.items() if key != "settings"},
                "history.0.settings",
            ),
            ("set", "history.0"),
        ]
        for step, field in cases:
            with self.subTest(field=field, step=step):
                self.assert_refused(
                    body(EXPOSURE, history=[step], cursor=0), field, "invalid_step"
                )

    def test_at_most_200_steps(self):
        step = {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": EXPOSURE}
        self.assert_refused(
            body(EXPOSURE, history=[step] * 201), "history", "too_many_steps"
        )
        saved = self.save(EXPOSURE, history=[step] * 200)
        self.assertEqual(len(saved["history"]), 200)

    def test_a_history_that_is_not_a_list_is_refused(self):
        self.assert_refused(
            {"settings": EXPOSURE, "history": {}, "history_cursor": -1},
            "history",
            "invalid_history",
        )

    def test_the_cursor_stays_inside_the_history(self):
        self.assert_refused(
            body(EXPOSURE, cursor=1), "history_cursor", "invalid_cursor"
        )
        self.assert_refused(body(EXPOSURE, cursor=-2), "history_cursor", "min_value")
        self.assert_refused(
            body(EXPOSURE, history=[], cursor=0), "history_cursor", "invalid_cursor"
        )

    def test_settings_must_be_the_recipe_under_the_cursor(self):
        history = [{"action": "set", "at": "2026-11-12T09:30:00Z", "settings": CROP}]
        self.assert_refused(
            body(EXPOSURE, history=history), "settings", "settings_mismatch"
        )
        # At -1 the recipe is the default one.
        self.assert_refused(
            body(EXPOSURE, history=history, cursor=-1), "settings", "settings_mismatch"
        )

    def test_settings_are_compared_as_recipes(self):
        written_out = recipe(
            light={"exposure": 1, "contrast": 0}, curve={"master": [[0, 0], [1, 1]]}
        )
        history = [
            {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": written_out}
        ]
        saved = self.save(EXPOSURE, history=history)
        # Stored in normal form: defaults left out.
        self.assertEqual(saved["history"][0]["settings"], EXPOSURE)

    def test_an_empty_history_stands_alone(self):
        saved = self.save(CROP, history=[], cursor=-1)
        self.assertEqual(saved["rendition"], "pending")
        self.assertEqual(saved["history"], [])

    def test_a_body_too_large_is_refused(self):
        step = {
            "action": "set",
            "at": "2026-11-12T09:30:00Z",
            "settings": recipe(curve={"master": [[i / 15, i / 15] for i in range(16)]}),
            "control": "x" * 64,
        }
        huge = json.loads(json.dumps(step))
        huge["settings"]["curve"] = {
            channel: [[i / 15, i / 15] for i in range(16)]
            for channel in ("master", "red", "green", "blue")
        }
        huge["settings"]["mixer"] = {
            band: {"hue": 12.123456789, "sat": 13.123456789, "lum": 14.123456789}
            for band in (
                "red",
                "orange",
                "yellow",
                "green",
                "aqua",
                "blue",
                "purple",
                "magenta",
            )
        }
        # Padding inside a JSON key is still JSON: an unknown key a step may
        # not carry would fail first, so the padding rides in the timestamp.
        huge["at"] = "2026-11-12T09:30:00" + "0" * 9000 + "Z"
        self.assert_refused(
            body(EXPOSURE, history=[huge] * 200), "history", "too_large"
        )


class EditOwnerOnlyTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.stranger = create_test_user()
        self.client.force_authenticate(user=self.stranger)

    def test_someone_else_gets_a_404_for_every_verb(self):
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        self.assertEqual(self.put(body(EXPOSURE)).status_code, 404)
        self.assertEqual(self.client.delete(self.url()).status_code, 404)
        self.assertEqual(self.client.get(self.url() + "source/").status_code, 404)
        self.assertFalse(PhotoEdit.objects.filter(pk=self.photo.pk).exists())

    def test_an_anonymous_caller_is_refused(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.url()).status_code, 401)


class NotEditableTest(EditedPhotoTestCase):
    def test_a_video_is_not_editable(self):
        video = self.make_photo(
            self.owner, b"not really a video", "clip.mp4", video=True
        )

        response = self.put(body(EXPOSURE), photo=video)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["code"], "not_editable")
        source = self.client.get(self.url(video) + "source/")
        self.assertEqual(source.status_code, 400)

    def test_a_missing_file_is_a_404(self):
        os.remove(self.photo.main_file.path)

        response = self.put(body(EXPOSURE))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["errors"][0]["code"], "file_missing")
        source = self.client.get(self.url() + "source/")
        self.assertEqual(source.json()["errors"][0]["code"], "file_missing")

    def test_a_file_that_is_no_picture_is_refused(self):
        broken = self.make_photo(
            self.owner, jpeg_bytes(quadrants())[:200], "cut.jpg", thumbnails=False
        )

        response = self.put(body(EXPOSURE), photo=broken)

        self.assertEqual(response.status_code, 400, response.content[:300])
        self.assertEqual(response.json()["errors"][0]["code"], "not_decodable")


class EditSourceTest(EditedPhotoTestCase):
    def test_the_source_file_with_its_validator(self):
        response = self.client.get(self.url() + "source/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertEqual(response["Cache-Control"], "private, no-cache")
        data = response.content
        self.assertEqual(data[:4], FILE_MAGIC)
        length = int.from_bytes(data[8:12], "little")
        header = json.loads(data[12 : 12 + length])
        self.assertEqual(
            header,
            {
                "kind": "srgb8",
                "width": 120,
                "height": 80,
                "full_width": 120,
                "full_height": 80,
                "max": 1.0,
            },
        )
        again = self.client.get(
            self.url() + "source/", HTTP_IF_NONE_MATCH=response["ETag"]
        )
        self.assertEqual(again.status_code, 304)

    def test_a_rotation_changes_the_validator(self):
        first = self.client.get(self.url() + "source/")["ETag"]
        self.photo.local_orientation = 6
        self.photo.save(update_fields=["local_orientation"])

        turned = self.client.get(self.url() + "source/", HTTP_IF_NONE_MATCH=first)

        self.assertEqual(turned.status_code, 200)
        length = int.from_bytes(turned.content[8:12], "little")
        header = json.loads(turned.content[12 : 12 + length])
        self.assertEqual((header["width"], header["height"]), (80, 120))
