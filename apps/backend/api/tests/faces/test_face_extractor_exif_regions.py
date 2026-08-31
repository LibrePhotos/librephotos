"""Characterization tests for ``api.face_extractor.extract_from_exif`` (unit 12).

These tests pin the CURRENT behaviour of ``extract_from_exif`` before it is
refactored.  They assert what the code does *today*, quirks and bugs included
(see the comments on the individual tests).

Everything heavy is mocked: ``get_metadata`` (which would otherwise shell out
to exiftool) and ``PIL.Image.open`` (which would otherwise need a real
thumbnail on disk).  No network, no ML models, no exiftool binary.
"""

from unittest.mock import patch

import numpy as np
from django.test import TestCase

from api import face_extractor
from api.metadata.tags import Tags

IMAGE_PATH = "/photos/img.jpg"
THUMB_PATH = "/thumbs/img.jpg"

# The fake big thumbnail is 200 px wide and 100 px high (numpy shape is
# (height, width, channels)).
THUMB_WIDTH = 200
THUMB_HEIGHT = 100
FAKE_THUMB = np.zeros((THUMB_HEIGHT, THUMB_WIDTH, 3), dtype=np.uint8)

# Deliberately asymmetric so that every orientation branch produces a
# distinguishable box.
AREA = {"X": "0.25", "Y": "0.75", "W": "0.2", "H": "0.4", "Unit": "normalized"}


def face_region(name="Alice", area=None, **extra):
    region = {"Type": "Face", "Name": name}
    if area is not None:
        region["Area"] = area
    region.update(extra)
    return region


class ExtractFromExifBaseTest(TestCase):
    """Shared plumbing: patch ``get_metadata`` and ``PIL.Image.open``."""

    def setUp(self):
        super().setUp()
        meta_patcher = patch("api.face_extractor.get_metadata")
        self.mock_get_metadata = meta_patcher.start()
        self.addCleanup(meta_patcher.stop)

        open_patcher = patch("api.face_extractor.PIL.Image.open")
        self.mock_open = open_patcher.start()
        self.mock_open.return_value = FAKE_THUMB
        self.addCleanup(open_patcher.stop)

    def run_extract(self, region_info, orientation=None):
        self.mock_get_metadata.return_value = (region_info, orientation)
        return face_extractor.extract_from_exif(IMAGE_PATH, THUMB_PATH)


class ExtractFromExifMetadataTest(ExtractFromExifBaseTest):
    def test_get_metadata_called_with_region_info_and_orientation(self):
        self.run_extract({"RegionList": []})
        self.mock_get_metadata.assert_called_once_with(
            IMAGE_PATH,
            tags=[Tags.REGION_INFO, Tags.ORIENTATION],
            try_sidecar=True,
            struct=True,
        )

    def test_no_region_info_returns_none(self):
        """Falsy region_info short-circuits to a bare ``return`` (None)."""
        self.assertIsNone(self.run_extract(None))
        self.mock_open.assert_not_called()

    def test_empty_dict_region_info_returns_none(self):
        # ``{}`` is falsy, so it takes the same early-exit path as ``None``.
        self.assertIsNone(self.run_extract({}))

    def test_empty_region_list_returns_empty_list(self):
        """A present-but-empty RegionList returns ``[]``, not ``None``."""
        self.assertEqual(self.run_extract({"RegionList": []}), [])

    def test_region_info_without_region_list_raises_keyerror(self):
        """Current behaviour: no defensive lookup on ``RegionList``."""
        with self.assertRaises(KeyError):
            self.run_extract({"SomethingElse": 1})


class ExtractFromExifRegionFilterTest(ExtractFromExifBaseTest):
    def test_non_face_regions_are_skipped_before_opening_thumbnail(self):
        result = self.run_extract(
            {"RegionList": [{"Type": "Pet", "Name": "Rex", "Area": dict(AREA)}]}
        )
        self.assertEqual(result, [])
        self.mock_open.assert_not_called()

    def test_region_without_type_is_skipped(self):
        result = self.run_extract({"RegionList": [{"Name": "Alice"}]})
        self.assertEqual(result, [])

    def test_face_region_without_area_or_dimensions_is_skipped(self):
        """The thumbnail is still opened, but no box is produced."""
        result = self.run_extract({"RegionList": [face_region()]})
        self.assertEqual(result, [])
        self.assertEqual(self.mock_open.call_count, 1)

    def test_area_with_other_unit_is_skipped(self):
        area = dict(AREA, Unit="pixel")
        result = self.run_extract({"RegionList": [face_region(area=area)]})
        self.assertEqual(result, [])

    def test_thumbnail_is_reopened_for_every_face_region(self):
        """Quirk: ``PIL.Image.open`` is called once per Face region."""
        regions = [
            face_region("A", dict(AREA)),
            face_region("B", dict(AREA)),
            {"Type": "Pet"},
        ]
        result = self.run_extract({"RegionList": regions})
        self.assertEqual(len(result), 2)
        self.assertEqual(self.mock_open.call_count, 2)
        self.mock_open.assert_called_with(THUMB_PATH)


class ExtractFromExifNormalizedAreaTest(ExtractFromExifBaseTest):
    def test_happy_path_no_orientation(self):
        result = self.run_extract({"RegionList": [face_region(area=dict(AREA))]})
        # (top, right, bottom, left, person_name)
        self.assertEqual(result, [(55, 70, 95, 30, "Alice")])

    def test_person_name_may_be_none(self):
        region = {"Type": "Face", "Area": dict(AREA)}
        result = self.run_extract({"RegionList": [region]})
        self.assertEqual(result, [(55, 70, 95, 30, None)])

    def test_numeric_strings_and_floats_both_accepted(self):
        area = {"X": 0.25, "Y": 0.75, "W": 0.2, "H": 0.4, "Unit": "normalized"}
        result = self.run_extract({"RegionList": [face_region(area=area)]})
        self.assertEqual(result, [(55, 70, 95, 30, "Alice")])

    def test_applied_to_dimensions_pixel_unit_uses_normalized_math(self):
        """Bug pinned: a *pixel*-unit AppliedToDimensions still makes the code
        treat Area's X/Y/W/H as normalized fractions."""
        region = face_region(
            area={"X": "0.25", "Y": "0.75", "W": "0.2", "H": "0.4"},
            AppliedToDimensions={"W": 400, "H": 200, "Unit": "pixel"},
        )
        result = self.run_extract({"RegionList": [region]})
        self.assertEqual(result, [(55, 70, 95, 30, "Alice")])

    def test_pixel_dimensions_without_area_raises_attributeerror(self):
        """Bug pinned: the ``area is None`` case is not guarded once
        AppliedToDimensions says ``pixel``."""
        region = face_region(AppliedToDimensions={"Unit": "pixel"})
        with self.assertRaises(AttributeError):
            self.run_extract({"RegionList": [region]})

    def test_non_numeric_coordinates_are_skipped(self):
        for missing in ("X", "Y", "W", "H"):
            with self.subTest(missing=missing):
                area = dict(AREA)
                area[missing] = "not-a-number"
                result = self.run_extract({"RegionList": [face_region(area=area)]})
                self.assertEqual(result, [])

    def test_missing_coordinate_key_is_skipped(self):
        area = dict(AREA)
        del area["W"]
        result = self.run_extract({"RegionList": [face_region(area=area)]})
        self.assertEqual(result, [])

    def test_broken_region_does_not_abort_the_others(self):
        good = face_region("Alice", dict(AREA))
        bad = face_region("Bob", dict(AREA, X="nope"))
        result = self.run_extract({"RegionList": [bad, good]})
        self.assertEqual(result, [(55, 70, 95, 30, "Alice")])

    def test_coordinates_may_be_negative_or_out_of_bounds(self):
        """No clamping happens today."""
        area = {"X": "0.0", "Y": "0.0", "W": "0.5", "H": "0.5", "Unit": "normalized"}
        result = self.run_extract({"RegionList": [face_region(area=area)]})
        self.assertEqual(result, [(-25, 50, 25, -50, "Alice")])


class ExtractFromExifOrientationTest(ExtractFromExifBaseTest):
    """One case per orientation branch; boxes are (top, right, bottom, left)."""

    def assert_box(self, orientation, expected):
        result = self.run_extract(
            {"RegionList": [face_region(area=dict(AREA))]}, orientation=orientation
        )
        self.assertEqual(result, [(*expected, "Alice")])

    def test_rotate_90_cw(self):
        self.assert_box("Rotate 90 CW", (15, 90, 35, 10))

    def test_mirror_horizontal(self):
        self.assert_box("Mirror horizontal", (55, 170, 95, 130))

    def test_rotate_180(self):
        self.assert_box("Rotate 180", (5, 170, 45, 130))

    def test_mirror_vertical(self):
        self.assert_box("Mirror vertical", (5, 70, 45, 30))

    def test_mirror_horizontal_and_rotate_270_cw(self):
        self.assert_box("Mirror horizontal and rotate 270 CW", (15, 90, 35, 10))

    def test_mirror_horizontal_and_rotate_90_cw(self):
        self.assert_box("Mirror horizontal and rotate 90 CW", (65, 190, 85, 110))

    def test_rotate_270_cw(self):
        self.assert_box("Rotate 270 CW", (65, 190, 85, 110))

    def test_horizontal_normal_is_untouched(self):
        self.assert_box("Horizontal (normal)", (55, 70, 95, 30))

    def test_unknown_orientation_is_untouched(self):
        self.assert_box("Some unknown orientation", (55, 70, 95, 30))

    def test_orientation_none_is_untouched(self):
        self.assert_box(None, (55, 70, 95, 30))


class ExtractIntegrationTest(ExtractFromExifBaseTest):
    """``extract`` falls through to the face service when exif yields nothing."""

    @patch("api.face_extractor.extract_from_face_service")
    def test_empty_exif_list_falls_back_to_face_service(self, mock_service):
        # ``[]`` is falsy, so an exif result of "no faces found" is treated the
        # same as "no region info at all".
        mock_service.return_value = [(1, 2, 3, 4, None)]
        self.mock_get_metadata.return_value = ({"RegionList": []}, None)
        result = face_extractor.extract(IMAGE_PATH, THUMB_PATH, owner=None)
        self.assertEqual(result, [(1, 2, 3, 4, None)])
        mock_service.assert_called_once_with(IMAGE_PATH, THUMB_PATH)

    @patch("api.face_extractor.extract_from_face_service")
    def test_exif_faces_win(self, mock_service):
        self.mock_get_metadata.return_value = (
            {"RegionList": [face_region(area=dict(AREA))]},
            None,
        )
        result = face_extractor.extract(IMAGE_PATH, THUMB_PATH, owner=None)
        self.assertEqual(result, [(55, 70, 95, 30, "Alice")])
        mock_service.assert_not_called()
