from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.metadata.face_regions import (
    build_face_region_exiftool_args,
    get_face_region_tags,
    reverse_orientation_transform,
    thumbnail_coords_to_normalized,
)
from api.models.person import Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class TestThumbnailCoordsToNormalized(TestCase):
    def test_basic_conversion(self):
        """Known pixel coords should produce expected normalized values."""
        # Face at center of a 1000x800 thumbnail
        # top=300, right=600, bottom=500, left=400
        x, y, w, h = thumbnail_coords_to_normalized(
            top=300,
            right=600,
            bottom=500,
            left=400,
            thumb_width=1000,
            thumb_height=800,
        )
        self.assertAlmostEqual(x, 0.5)  # center_x = (400+600)/2/1000
        self.assertAlmostEqual(y, 0.5)  # center_y = (300+500)/2/800
        self.assertAlmostEqual(w, 0.2)  # w = (600-400)/1000
        self.assertAlmostEqual(h, 0.25)  # h = (500-300)/800

    def test_corner_face(self):
        """Face in top-left corner."""
        x, y, w, h = thumbnail_coords_to_normalized(
            top=0,
            right=100,
            bottom=100,
            left=0,
            thumb_width=1000,
            thumb_height=1000,
        )
        self.assertAlmostEqual(x, 0.05)
        self.assertAlmostEqual(y, 0.05)
        self.assertAlmostEqual(w, 0.1)
        self.assertAlmostEqual(h, 0.1)


class TestReverseOrientationTransform(TestCase):
    def test_identity_for_normal_orientation(self):
        """Normal orientation should be a no-op."""
        x, y, w, h = reverse_orientation_transform(
            0.5, 0.3, 0.2, 0.1, "Horizontal (normal)"
        )
        self.assertAlmostEqual(x, 0.5)
        self.assertAlmostEqual(y, 0.3)
        self.assertAlmostEqual(w, 0.2)
        self.assertAlmostEqual(h, 0.1)

    def test_identity_for_none_orientation(self):
        """None orientation should be a no-op."""
        x, y, w, h = reverse_orientation_transform(0.5, 0.3, 0.2, 0.1, None)
        self.assertAlmostEqual(x, 0.5)
        self.assertAlmostEqual(y, 0.3)
        self.assertAlmostEqual(w, 0.2)
        self.assertAlmostEqual(h, 0.1)

    def test_round_trip_rotate_90_cw(self):
        """Forward then reverse for Rotate 90 CW should return original coords."""
        self._test_round_trip("Rotate 90 CW")

    def test_round_trip_mirror_horizontal(self):
        self._test_round_trip("Mirror horizontal")

    def test_round_trip_rotate_180(self):
        self._test_round_trip("Rotate 180")

    def test_round_trip_mirror_vertical(self):
        self._test_round_trip("Mirror vertical")

    def test_round_trip_rotate_270_cw(self):
        self._test_round_trip("Rotate 270 CW")

    def test_round_trip_mirror_horizontal_rotate_90_cw(self):
        self._test_round_trip("Mirror horizontal and rotate 90 CW")

    def _test_round_trip(self, orientation):
        """Apply forward transform (from face_extractor) then reverse, verify identity."""
        orig_x, orig_y, orig_w, orig_h = 0.4, 0.3, 0.2, 0.15

        # Apply forward transform (same logic as face_extractor.py lines 54-80)
        correct_x, correct_y = orig_x, orig_y
        correct_w, correct_h = orig_w, orig_h
        if orientation == "Rotate 90 CW":
            temp_x = correct_x
            correct_x = 1 - correct_y
            correct_y = temp_x
            correct_w, correct_h = correct_h, correct_w
        elif orientation == "Mirror horizontal":
            correct_x = 1 - correct_x
        elif orientation == "Rotate 180":
            correct_x = 1 - correct_x
            correct_y = 1 - correct_y
        elif orientation == "Mirror vertical":
            correct_y = 1 - correct_y
        elif orientation == "Mirror horizontal and rotate 270 CW":
            temp_x = correct_x
            correct_x = 1 - correct_y
            correct_y = temp_x
            correct_w, correct_h = correct_h, correct_w
        elif orientation == "Mirror horizontal and rotate 90 CW":
            temp_x = correct_x
            correct_x = correct_y
            correct_y = 1 - temp_x
            correct_w, correct_h = correct_h, correct_w
        elif orientation == "Rotate 270 CW":
            temp_x = correct_x
            correct_x = correct_y
            correct_y = 1 - temp_x
            correct_w, correct_h = correct_h, correct_w

        # Now reverse
        rx, ry, rw, rh = reverse_orientation_transform(
            correct_x, correct_y, correct_w, correct_h, orientation
        )
        self.assertAlmostEqual(
            rx, orig_x, places=10, msg=f"x mismatch for {orientation}"
        )
        self.assertAlmostEqual(
            ry, orig_y, places=10, msg=f"y mismatch for {orientation}"
        )
        self.assertAlmostEqual(
            rw, orig_w, places=10, msg=f"w mismatch for {orientation}"
        )
        self.assertAlmostEqual(
            rh, orig_h, places=10, msg=f"h mismatch for {orientation}"
        )


class TestBuildFaceRegionExiftoolArgs(TestCase):
    def test_single_face(self):
        """Single face region should produce correct structured tag."""
        regions = [{"name": "Alice", "x": 0.5, "y": 0.3, "w": 0.2, "h": 0.15}]
        result = build_face_region_exiftool_args(regions)
        self.assertIn("XMP-mwg-rs:RegionInfo", result)
        value = result["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Alice", value)
        self.assertIn("Type=Face", value)
        self.assertIn("Unit=normalized", value)
        self.assertIn("RegionList=", value)

    def test_multiple_faces(self):
        """Multiple face regions should all appear in RegionList."""
        regions = [
            {"name": "Alice", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1},
            {"name": "Bob", "x": 0.7, "y": 0.5, "w": 0.15, "h": 0.2},
            {"name": "Charlie", "x": 0.5, "y": 0.8, "w": 0.12, "h": 0.1},
        ]
        result = build_face_region_exiftool_args(regions)
        value = result["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Alice", value)
        self.assertIn("Bob", value)
        self.assertIn("Charlie", value)

    def test_special_characters_in_name(self):
        """Person names with commas, braces, equals should be escaped."""
        regions = [{"name": "O'Brien, Jr.", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}]
        result = build_face_region_exiftool_args(regions)
        value = result["XMP-mwg-rs:RegionInfo"]
        # Comma should be escaped
        self.assertIn("O'Brien\\, Jr.", value)

    def test_escape_braces_and_equals(self):
        """Braces and equals in names should be escaped."""
        regions = [{"name": "Test{=}", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}]
        result = build_face_region_exiftool_args(regions)
        value = result["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Test\\{\\=\\}", value)


class TestRoundTripCoordinates(TestCase):
    def test_round_trip_no_orientation(self):
        """Pixel coords -> normalize -> (simulate XMP read-back) -> verify ~= original."""
        thumb_width = 1000
        thumb_height = 800
        orig_top, orig_right, orig_bottom, orig_left = 200, 600, 400, 400

        # Step 1: Convert pixel -> normalized (writeback path)
        x, y, w, h = thumbnail_coords_to_normalized(
            orig_top,
            orig_right,
            orig_bottom,
            orig_left,
            thumb_width,
            thumb_height,
        )

        # Step 2: Simulate read-back (face_extractor.py lines 82-90)
        half_width = (w * thumb_width) / 2
        half_height = (h * thumb_height) / 2
        read_top = int((y * thumb_height) - half_height)
        read_right = int((x * thumb_width) + half_width)
        read_bottom = int((y * thumb_height) + half_height)
        read_left = int((x * thumb_width) - half_width)

        # Verify within 1px tolerance (int rounding)
        self.assertAlmostEqual(read_top, orig_top, delta=1)
        self.assertAlmostEqual(read_right, orig_right, delta=1)
        self.assertAlmostEqual(read_bottom, orig_bottom, delta=1)
        self.assertAlmostEqual(read_left, orig_left, delta=1)


class TestGetFaceRegionTags(TestCase):
    def setUp(self):
        self.user = create_test_user()

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_returns_tags_for_labeled_faces(self, mock_pil_open, mock_get_metadata):
        """get_face_region_tags should return a dict with RegionInfo for labeled faces."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Alice", tags["XMP-mwg-rs:RegionInfo"])

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_returns_all_faces(self, mock_pil_open, mock_get_metadata):
        """Photo with 3 labeled faces should have all 3 in the returned tags."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        for name in ["Alice", "Bob", "Charlie"]:
            person = create_test_person(
                name=name, kind=Person.KIND_USER, cluster_owner=self.user
            )
            create_test_face(
                photo=photo,
                person=person,
                location_top=100,
                location_right=300,
                location_bottom=300,
                location_left=100,
            )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Alice", value)
        self.assertIn("Bob", value)
        self.assertIn("Charlie", value)

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_unlabeled_faces_written_with_empty_name(
        self, mock_pil_open, mock_get_metadata
    ):
        """Faces without a KIND_USER person should be written with an empty name."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        cluster_person = create_test_person(
            name="cluster_0001", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=cluster_person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        value = tags["XMP-mwg-rs:RegionInfo"]
        # Should have the face region but with empty name
        self.assertIn("Name=,Type=Face", value)
        self.assertNotIn("cluster_0001", value)

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_faces_with_no_person_written_with_empty_name(
        self, mock_pil_open, mock_get_metadata
    ):
        """Faces with person=None should be written with an empty name."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        create_test_face(
            photo=photo,
            person=None,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Name=,Type=Face", value)

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_mixed_labeled_and_unlabeled_faces(
        self, mock_pil_open, mock_get_metadata
    ):
        """Photo with both labeled and unlabeled faces should include all."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        labeled_person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=labeled_person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )
        cluster_person = create_test_person(
            name="cluster_0001", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=cluster_person,
            location_top=400,
            location_right=600,
            location_bottom=600,
            location_left=400,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Alice", value)
        self.assertNotIn("cluster_0001", value)
        # Should have 2 face regions
        self.assertEqual(value.count("Type=Face"), 2)

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_skips_deleted_faces(self, mock_pil_open, mock_get_metadata):
        """Deleted faces should not be included in the tags."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        person = create_test_person(
            name="Active", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )
        deleted_person = create_test_person(
            name="Deleted", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=deleted_person,
            deleted=True,
            location_top=400,
            location_right=600,
            location_bottom=600,
            location_left=400,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        tags = get_face_region_tags(photo)

        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Active", value)
        self.assertNotIn("Deleted", value)


class TestSaveMetadataIntegration(TestCase):
    def setUp(self):
        self.user = create_test_user()

    @patch("api.models.photo.write_metadata")
    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_save_metadata_with_face_tags(
        self, mock_pil_open, mock_get_metadata, mock_write_metadata
    ):
        """_save_metadata(metadata_types=["face_tags"]) should write face regions."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        person = create_test_person(
            name="Test Person", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        photo._save_metadata(use_sidecar=True, metadata_types=["face_tags"])

        mock_write_metadata.assert_called_once()
        tags = mock_write_metadata.call_args[0][1]
        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Test Person", tags["XMP-mwg-rs:RegionInfo"])

    @patch("api.models.photo.write_metadata")
    def test_save_metadata_default_does_not_write_face_tags(self, mock_write_metadata):
        """_save_metadata() with default args should NOT write face tags."""
        photo = create_test_photo(owner=self.user)
        person = create_test_person(
            name="Test Person", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        # Default call (no metadata_types) — should only consider ratings
        photo._save_metadata()

        # Rating is 0 by default and there are no modified_fields=None,
        # so it will write the rating tag
        if mock_write_metadata.called:
            tags = mock_write_metadata.call_args[0][1]
            self.assertNotIn("XMP-mwg-rs:RegionInfo", tags)

    @patch("api.models.photo.write_metadata")
    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_save_metadata_combined_types(
        self, mock_pil_open, mock_get_metadata, mock_write_metadata
    ):
        """_save_metadata with both types should write ratings AND face tags together."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        photo.rating = 5
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=photo,
            person=person,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )

        mock_img = MagicMock()
        mock_img.size = (1000, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.return_value = (None,)

        photo._save_metadata(use_sidecar=True, metadata_types=["ratings", "face_tags"])

        mock_write_metadata.assert_called_once()
        tags = mock_write_metadata.call_args[0][1]
        self.assertIn("Rating", tags)
        self.assertEqual(tags["Rating"], 5)
        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Alice", tags["XMP-mwg-rs:RegionInfo"])
