"""The edit recipe: sparse JSON in and out, validation, what a recipe changes."""

from django.test import SimpleTestCase

from api.editing.recipe import (
    BANDS,
    CONTROLS,
    WHEELS,
    Crop,
    Recipe,
    changes_geometry,
    is_identity,
    recipe_from_json,
    recipe_to_json,
)

FULL = {
    "version": 1,
    "geometry": {
        "orientation": 90,
        "flip_h": True,
        "straighten": -3.5,
        "crop": {"cx": 0.4, "cy": 0.6, "w": 0.5, "h": 0.7},
        "aspect": "4:5",
    },
    "wb": {"temp": 12, "tint": -4},
    "light": {"exposure": 0.35, "contrast": 20, "blacks": -10},
    "curve": {"master": [[0, 0], [0.5, 0.6], [1, 1]], "red": [[0, 0.1], [1, 0.9]]},
    "color": {"vibrance": 15, "treatment": "bw"},
    "mixer": {"aqua": {"hue": 10, "lum": -20}},
    "bw_mix": {"red": 30},
    "grading": {"global": {"hue": 200, "sat": 30}, "blending": 70},
    "effects": {"clarity": 25},
    "vignette": {"amount": -40, "feather": 80},
    "grain": {"amount": 20, "seed": 4294967295},
    "detail": {"sharpen_amount": 120, "sharpen_radius": 0.5, "nr_color": 30},
}


class RecipeJsonTest(SimpleTestCase):
    def test_default_recipe_is_version_only(self):
        self.assertEqual(recipe_to_json(Recipe()), {"version": 1})
        self.assertEqual(recipe_from_json({}), Recipe())
        self.assertEqual(recipe_from_json({"version": 1}), Recipe())

    def test_round_trip_keeps_every_group(self):
        recipe = recipe_from_json(FULL)
        self.assertEqual(recipe.geometry.crop, Crop(cx=0.4, cy=0.6, w=0.5, h=0.7))
        self.assertEqual(recipe.grading.global_.hue, 200)
        self.assertEqual(recipe.grain.seed, 4294967295)
        self.assertEqual(recipe_to_json(recipe), FULL)
        self.assertEqual(recipe_from_json(recipe_to_json(recipe)), recipe)

    def test_output_drops_default_values(self):
        recipe = recipe_from_json(
            {"light": {"exposure": 0, "contrast": 5}, "vignette": {"midpoint": 50}}
        )
        self.assertEqual(
            recipe_to_json(recipe), {"version": 1, "light": {"contrast": 5}}
        )

    def test_every_numeric_control_accepts_its_bounds(self):
        for path, control in CONTROLS.items():
            if path.startswith(("curve.", "geometry.crop")):
                continue
            for bound in (control.minimum, control.maximum, control.default):
                value = int(bound) if control.integer else bound
                *groups, leaf = path.split(".")
                data: dict = {leaf: value}
                for group in reversed(groups):
                    data = {group: data}
                with self.subTest(path=path, value=value):
                    recipe_from_json(data)

    def test_controls_cover_every_band_and_wheel(self):
        for band in BANDS:
            self.assertIn(f"mixer.{band}.sat", CONTROLS)
            self.assertIn(f"bw_mix.{band}", CONTROLS)
        for wheel in WHEELS:
            self.assertIn(f"grading.{wheel}.lum", CONTROLS)

    def test_invalid_recipes_raise(self):
        cases = {
            "unknown top key": {"bogus": {}},
            "unknown group key": {"light": {"brightness": 1}},
            "out of range": {"light": {"exposure": 5.5}},
            "below range": {"detail": {"sharpen_radius": 0.2}},
            "string number": {"wb": {"temp": "10"}},
            "bool number": {"wb": {"temp": True}},
            "nan": {"wb": {"temp": float("nan")}},
            "bad version": {"version": 2},
            "bad orientation": {"geometry": {"orientation": 45}},
            "bool orientation": {"geometry": {"orientation": True}},
            "flip not bool": {"geometry": {"flip_h": 1}},
            "partial crop": {"geometry": {"crop": {"cx": 0.5}}},
            "empty crop": {
                "geometry": {"crop": {"cx": 0.5, "cy": 0.5, "w": 0, "h": 1}}
            },
            "bad aspect": {"geometry": {"aspect": "7:3"}},
            "bad treatment": {"color": {"treatment": "sepia"}},
            "one point": {"curve": {"master": [[0, 0]]}},
            "seventeen points": {"curve": {"master": [[i / 16, 0] for i in range(17)]}},
            "x not increasing": {"curve": {"master": [[0, 0], [0.5, 0.5], [0.5, 1]]}},
            "point out of range": {"curve": {"master": [[0, 0], [1, 1.2]]}},
            "seed not integer": {"grain": {"seed": 1.5}},
            "seed too big": {"grain": {"seed": 4294967296}},
            "group not object": {"light": [1]},
            "band not object": {"mixer": {"red": 3}},
            "not an object": [],
        }
        for name, data in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                recipe_from_json(data)


class RecipeMeaningTest(SimpleTestCase):
    def test_identity(self):
        self.assertTrue(is_identity(Recipe()))
        quiet = recipe_from_json(
            {
                "geometry": {
                    "aspect": "1:1",
                    "crop": {"cx": 0.5, "cy": 0.5, "w": 1, "h": 1},
                },
                "grain": {"size": 80, "seed": 3},
                "vignette": {"midpoint": 10},
                "detail": {"sharpen_radius": 2},
                "curve": {"master": [[0, 0], [0.4, 0.4], [1, 1]]},
            }
        )
        self.assertTrue(is_identity(quiet))
        for data in (
            {"light": {"exposure": 0.1}},
            {"curve": {"blue": [[0, 0.05], [1, 1]]}},
            {"curve": {"master": [[0.2, 0.2], [1, 1]]}},
            {"bw_mix": {"red": 10}},
            {"grain": {"amount": 1}},
            {"geometry": {"flip_v": True}},
        ):
            with self.subTest(data):
                self.assertFalse(is_identity(recipe_from_json(data)))

    def test_changes_geometry(self):
        recipe = recipe_from_json(FULL)
        self.assertTrue(changes_geometry(recipe))
        self.assertFalse(changes_geometry(recipe_from_json({"light": {"contrast": 9}})))
