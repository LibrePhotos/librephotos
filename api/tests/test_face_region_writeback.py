"""Tests for writing face regions back to photo files."""

import json
from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.util import write_face_regions_metadata


class WriteFaceRegionsMetadataTest(TestCase):
    """Test the write_face_regions_metadata utility function."""

    @patch("api.util.exiftool.ExifTool")
    def test_writes_single_face_region(self, mock_exiftool_cls):
        """Test writing a single face region to a file."""
        mock_et = MagicMock()
        mock_et.running = False
        mock_exiftool_cls.return_value = mock_et

        face_regions = [
            {"name": "John Doe", "x": 0.5, "y": 0.3, "w": 0.1, "h": 0.15}
        ]

        write_face_regions_metadata(
            "/path/to/image.jpg",
            face_regions,
            image_width=4000,
            image_height=3000,
            use_sidecar=False,
        )

        mock_et.start.assert_called_once()
        mock_et.execute.assert_called_once()
        mock_et.terminate.assert_called_once()

        # Check the params passed to execute
        call_args = mock_et.execute.call_args
        params = call_args[0]

        # First param should be -struct
        self.assertEqual(params[0], b"-struct")
        # Should contain the RegionInfo tag
        region_param = params[1].decode()
        self.assertIn("-XMP-mwg-rs:RegionInfo=", region_param)
        # Parse the JSON part
        json_str = region_param.split("=", 1)[1]
        region_info = json.loads(json_str)
        self.assertEqual(region_info["AppliedToDimensions"]["W"], "4000")
        self.assertEqual(region_info["AppliedToDimensions"]["H"], "3000")
        self.assertEqual(region_info["AppliedToDimensions"]["Unit"], "pixel")
        self.assertEqual(len(region_info["RegionList"]), 1)
        region = region_info["RegionList"][0]
        self.assertEqual(region["Name"], "John Doe")
        self.assertEqual(region["Type"], "Face")
        self.assertEqual(region["Area"]["X"], "0.5")
        self.assertEqual(region["Area"]["Y"], "0.3")
        self.assertEqual(region["Area"]["W"], "0.1")
        self.assertEqual(region["Area"]["H"], "0.15")
        self.assertEqual(region["Area"]["Unit"], "normalized")
        # Last params should be overwrite_original and file path
        self.assertEqual(params[2], b"-overwrite_original")
        self.assertEqual(params[3], b"/path/to/image.jpg")

    @patch("api.util.exiftool.ExifTool")
    def test_writes_multiple_face_regions(self, mock_exiftool_cls):
        """Test writing multiple face regions to a file."""
        mock_et = MagicMock()
        mock_et.running = False
        mock_exiftool_cls.return_value = mock_et

        face_regions = [
            {"name": "Alice", "x": 0.3, "y": 0.4, "w": 0.08, "h": 0.12},
            {"name": "Bob", "x": 0.7, "y": 0.5, "w": 0.09, "h": 0.14},
        ]

        write_face_regions_metadata(
            "/path/to/image.jpg",
            face_regions,
            image_width=1920,
            image_height=1080,
            use_sidecar=False,
        )

        call_args = mock_et.execute.call_args
        params = call_args[0]
        json_str = params[1].decode().split("=", 1)[1]
        region_info = json.loads(json_str)
        self.assertEqual(len(region_info["RegionList"]), 2)
        self.assertEqual(region_info["RegionList"][0]["Name"], "Alice")
        self.assertEqual(region_info["RegionList"][1]["Name"], "Bob")

    @patch("api.util.exiftool.ExifTool")
    def test_writes_to_sidecar_when_requested(self, mock_exiftool_cls):
        """Test that sidecar path is used when use_sidecar=True."""
        mock_et = MagicMock()
        mock_et.running = False
        mock_exiftool_cls.return_value = mock_et

        face_regions = [
            {"name": "Test", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}
        ]

        write_face_regions_metadata(
            "/path/to/image.jpg",
            face_regions,
            image_width=100,
            image_height=100,
            use_sidecar=True,
        )

        call_args = mock_et.execute.call_args
        params = call_args[0]
        # The file path should be the sidecar path (image.xmp)
        self.assertEqual(params[3], b"/path/to/image.xmp")

    @patch("api.util.exiftool.ExifTool")
    def test_reuses_running_exiftool(self, mock_exiftool_cls):
        """Test that an already-running ExifTool instance is reused."""
        mock_et = MagicMock()
        mock_et.running = True
        mock_exiftool_cls.return_value = mock_et

        face_regions = [
            {"name": "Test", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}
        ]

        write_face_regions_metadata(
            "/path/to/image.jpg",
            face_regions,
            image_width=100,
            image_height=100,
            use_sidecar=False,
        )

        mock_et.start.assert_not_called()
        mock_et.terminate.assert_not_called()
        mock_et.execute.assert_called_once()


class SaveFaceRegionsToMetadataTest(TestCase):
    """Test the Photo._save_face_regions_to_metadata method."""

    @patch("api.models.photo.util.write_face_regions_metadata")
    @patch("api.models.photo.PIL.Image.open")
    def test_save_face_regions_converts_coordinates(
        self, mock_pil_open, mock_write_regions
    ):
        """Test that pixel coordinates are correctly converted to normalised."""
        from api.tests.utils import (
            create_test_face,
            create_test_person,
            create_test_photo,
            create_test_user,
        )

        # Mock PIL Image with known dimensions
        mock_img = MagicMock()
        mock_img.size = (1920, 1080)
        mock_pil_open.return_value = mock_img

        user = create_test_user()
        photo = create_test_photo(
            owner=user,
            thumbnail_big="thumbnails_big/test.webp",
        )
        person = create_test_person(name="Jane", cluster_owner=user)
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_bottom=300,
            location_left=200,
            location_right=400,
        )

        photo._save_face_regions_to_metadata(use_sidecar=False)

        mock_write_regions.assert_called_once()
        call_args = mock_write_regions.call_args
        face_regions = call_args[0][1]
        image_width = call_args[0][2]
        image_height = call_args[0][3]

        self.assertEqual(len(face_regions), 1)
        region = face_regions[0]
        self.assertEqual(region["name"], "Jane")
        # center_x = (200 + 400) / 2 / 1920 = 0.15625
        self.assertAlmostEqual(region["x"], 0.15625, places=5)
        # center_y = (100 + 300) / 2 / 1080 ≈ 0.185185
        self.assertAlmostEqual(region["y"], 0.185185, places=5)
        # width = (400 - 200) / 1920 ≈ 0.104167
        self.assertAlmostEqual(region["w"], 0.104167, places=5)
        # height = (300 - 100) / 1080 ≈ 0.185185
        self.assertAlmostEqual(region["h"], 0.185185, places=5)
        # Should use thumbnail dimensions when no PhotoMetadata
        self.assertEqual(image_width, 1920)
        self.assertEqual(image_height, 1080)

    @patch("api.models.photo.util.write_face_regions_metadata")
    def test_save_face_regions_skips_unlabelled_faces(self, mock_write_regions):
        """Test that faces without a person are not written."""
        from api.tests.utils import (
            create_test_face,
            create_test_photo,
            create_test_user,
        )

        user = create_test_user()
        photo = create_test_photo(owner=user)
        # Create face without a person
        create_test_face(photo=photo, person=None)

        photo._save_face_regions_to_metadata(use_sidecar=False)

        # Should not write anything
        mock_write_regions.assert_not_called()

    @patch("api.models.photo.util.write_face_regions_metadata")
    def test_save_face_regions_skips_deleted_faces(self, mock_write_regions):
        """Test that deleted faces are not written."""
        from api.tests.utils import (
            create_test_face,
            create_test_person,
            create_test_photo,
            create_test_user,
        )

        user = create_test_user()
        photo = create_test_photo(owner=user)
        person = create_test_person(name="Jane", cluster_owner=user)
        create_test_face(photo=photo, person=person, deleted=True)

        photo._save_face_regions_to_metadata(use_sidecar=False)

        mock_write_regions.assert_not_called()
