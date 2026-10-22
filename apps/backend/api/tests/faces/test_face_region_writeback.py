import datetime
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.labels import write_face_tags_later
from api.metadata.face_regions import (
    NO_REGIONS,
    build_face_region_exiftool_args,
    get_face_region_tags,
    thumbnail_coords_to_normalized,
)
from api.metadata.photo_writer import write_photo_metadata
from api.metadata.tags import Tags
from api.metadata.writer import add_to, remove_from
from api.models.person import Person
from api.models.user import User
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)

# What the mocked get_metadata finds: no orientation, a 4000 x 3000 original,
# no face regions or keywords yet.
FILE_METADATA = {Tags.IMAGE_WIDTH: 4000, Tags.IMAGE_HEIGHT: 3000}


def _file_metadata(media_file, tags, **kwargs):
    return [FILE_METADATA.get(tag) for tag in tags]


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

    def test_applied_to_dimensions(self):
        """AppliedToDimensions should be included when image dimensions are provided."""
        regions = [{"name": "Alice", "x": 0.5, "y": 0.3, "w": 0.2, "h": 0.15}]
        result = build_face_region_exiftool_args(
            regions, image_width=4000, image_height=3000
        )
        value = result["XMP-mwg-rs:RegionInfo"]
        self.assertIn("AppliedToDimensions={W=4000,H=3000,Unit=pixel}", value)

    def test_no_applied_to_dimensions_when_missing(self):
        """AppliedToDimensions should be omitted when image dimensions are not available."""
        regions = [{"name": "Alice", "x": 0.5, "y": 0.3, "w": 0.2, "h": 0.15}]
        result = build_face_region_exiftool_args(regions)
        value = result["XMP-mwg-rs:RegionInfo"]
        self.assertNotIn("AppliedToDimensions", value)

    def test_subject_keywords_for_named_faces(self):
        """Named faces are added to XMP:Subject, never assigned to it (#2291)."""
        regions = [
            {"name": "Alice", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1},
            {"name": "Bob", "x": 0.7, "y": 0.5, "w": 0.15, "h": 0.2},
            {"name": "", "x": 0.5, "y": 0.8, "w": 0.12, "h": 0.1},
            {"name": "Alice", "x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1},
        ]
        result = build_face_region_exiftool_args(regions)
        self.assertNotIn("XMP:Subject", result)
        # Removed and added again: ExifTool adds each name once.
        self.assertEqual(result["XMP:Subject-"], ["Alice", "Bob"])
        self.assertEqual(result["XMP:Subject+"], ["Alice", "Bob"])
        self.assertEqual(["XMP:Subject-", "XMP:Subject+"], list(result)[1:])

    def test_a_relabelled_face_removes_the_previous_name(self):
        regions = [{"name": "Bob", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1}]
        result = build_face_region_exiftool_args(
            regions, previous_names=["Alice", "Bob", "Alice"]
        )
        self.assertEqual(result["XMP:Subject-"], ["Alice", "Bob"])
        self.assertEqual(result["XMP:Subject+"], ["Bob"])

    def test_a_new_keyword_list_starts_from_the_photos_keywords(self):
        """A sidecar without keywords gets the photo's own plus the names."""
        regions = [{"name": "Bob", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1}]
        result = build_face_region_exiftool_args(
            regions,
            previous_names=["Alice"],
            keywords=["Alice", "Beach", "Bob", "Holiday"],
        )
        self.assertEqual(result["XMP:Subject"], ["Beach", "Bob", "Holiday"])
        self.assertNotIn("XMP:Subject-", result)
        self.assertNotIn("XMP:Subject+", result)

    def test_no_subject_keywords_when_all_unnamed(self):
        """No XMP:Subject change when all faces are unnamed."""
        regions = [
            {"name": "", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1},
        ]
        result = build_face_region_exiftool_args(regions)
        self.assertEqual(["XMP-mwg-rs:RegionInfo"], list(result))
        result = build_face_region_exiftool_args(regions, keywords=[])
        self.assertEqual(["XMP-mwg-rs:RegionInfo"], list(result))


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

        # Step 2: Simulate read-back (to_face_box in api/faces/extractor.py)
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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Alice", tags["XMP-mwg-rs:RegionInfo"])
        # AppliedToDimensions should be present
        self.assertIn(
            "AppliedToDimensions={W=4000,H=3000,Unit=pixel}",
            tags["XMP-mwg-rs:RegionInfo"],
        )
        # The person name is added to XMP:Subject
        self.assertEqual(tags["XMP:Subject+"], ["Alice"])

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_rotated_photo_is_written_in_stored_coordinates(
        self, mock_pil_open, mock_get_metadata
    ):
        """The orientation arrives as a number, as the exif service returns it (#2292)."""
        photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        # Display (thumbnail) box: centre (0.3125, 0.375), 0.125 x 0.125.
        create_test_face(
            photo=photo,
            person=person,
            location_top=250,
            location_right=300,
            location_bottom=350,
            location_left=200,
        )

        mock_img = MagicMock()
        mock_img.size = (800, 800)
        mock_pil_open.return_value = mock_img
        mock_get_metadata.side_effect = lambda media_file, tags, **kwargs: [
            {**FILE_METADATA, Tags.ORIENTATION: 6}.get(tag) for tag in tags
        ]

        tags = get_face_region_tags(photo, use_sidecar=False)

        # Orientation 6 shows stored (x, y) at (1 - y, x): stored is (y', 1 - x').
        self.assertIn(
            "Area={X=0.375000,Y=0.687500,W=0.125000,H=0.125000,Unit=normalized}",
            tags["XMP-mwg-rs:RegionInfo"],
        )

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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Name=,Type=Face", value)

    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_mixed_labeled_and_unlabeled_faces(self, mock_pil_open, mock_get_metadata):
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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

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
        mock_get_metadata.side_effect = _file_metadata

        tags = get_face_region_tags(photo, use_sidecar=False)

        value = tags["XMP-mwg-rs:RegionInfo"]
        self.assertIn("Active", value)
        self.assertNotIn("Deleted", value)


class TestSaveMetadataIntegration(TestCase):
    def setUp(self):
        self.user = create_test_user()

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_save_metadata_with_face_tags(
        self, mock_pil_open, mock_get_metadata, mock_write_metadata
    ):
        """write_photo_metadata(metadata_types=["face_tags"]) should write face regions."""
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
        mock_get_metadata.side_effect = _file_metadata

        write_photo_metadata(photo, use_sidecar=True, metadata_types=["face_tags"])

        mock_write_metadata.assert_called_once()
        tags = mock_write_metadata.call_args[0][1]
        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Test Person", tags["XMP-mwg-rs:RegionInfo"])

    @patch("api.metadata.photo_writer.write_metadata")
    def test_save_metadata_default_does_not_write_face_tags(self, mock_write_metadata):
        """write_photo_metadata() with default args should NOT write face tags."""
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
        write_photo_metadata(photo)

        # Rating is 0 by default and there are no modified_fields=None,
        # so it will write the rating tag
        if mock_write_metadata.called:
            tags = mock_write_metadata.call_args[0][1]
            self.assertNotIn("XMP-mwg-rs:RegionInfo", tags)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.metadata.face_regions.get_metadata")
    @patch("api.metadata.face_regions.PIL.Image.open")
    def test_save_metadata_combined_types(
        self, mock_pil_open, mock_get_metadata, mock_write_metadata
    ):
        """write_photo_metadata with both types should write ratings AND face tags together."""
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
        mock_get_metadata.side_effect = _file_metadata

        write_photo_metadata(
            photo, use_sidecar=True, metadata_types=["ratings", "face_tags"]
        )

        mock_write_metadata.assert_called_once()
        tags = mock_write_metadata.call_args[0][1]
        self.assertIn("Rating", tags)
        self.assertEqual(tags["Rating"], 5)
        self.assertIn("XMP-mwg-rs:RegionInfo", tags)
        self.assertIn("Alice", tags["XMP-mwg-rs:RegionInfo"])

    @patch("api.metadata.photo_writer.write_metadata")
    def test_save_metadata_timestamp_writes_date_created(self, mock_write_metadata):
        """A timestamp edit is persisted as XMP:DateCreated, not an EXIF date.

        ``Tags.DATE_TIME`` used to be written here. It was not a valid ExifTool
        tag, and even the correct EXIF name cannot be written into a sidecar.
        """
        photo = create_test_photo(owner=self.user)
        photo.timestamp = datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=datetime.UTC)

        write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=True)

        mock_write_metadata.assert_called_once()
        tags = mock_write_metadata.call_args[0][1]
        self.assertEqual("XMP:DateCreated", Tags.DATE_CREATED)
        self.assertIn(Tags.DATE_CREATED, tags)
        # exiftool's canonical form, without the misleading "+00:00" that
        # str(datetime) would append to what is really a local time.
        self.assertEqual("2019:08:15 07:45:00", tags[Tags.DATE_CREATED])
        self.assertNotIn(Tags.DATE_TIME, tags)
        self.assertNotIn("EXIF:DateTime", tags)

    @patch("api.metadata.photo_writer.write_metadata")
    def test_save_metadata_clears_date_created_when_timestamp_is_removed(
        self, mock_write_metadata
    ):
        """An empty value tells exiftool to delete the tag, rather than crashing."""
        photo = create_test_photo(owner=self.user)
        photo.timestamp = None

        write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=True)

        tags = mock_write_metadata.call_args[0][1]
        self.assertEqual("", tags[Tags.DATE_CREATED])


# A face region as a struct read of XMP:RegionInfo gives it.
ALICE_REGION = {
    "RegionList": [
        {
            "Area": {"X": 0.5, "Y": 0.5, "W": 0.2, "H": 0.2, "Unit": "normalized"},
            "Name": "Alice",
            "Type": "Face",
        }
    ]
}


class TestClearedFaceRegionTags(TestCase):
    """A photo whose faces were all deleted has its regions cleared (#1531)."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/test.jpg"
        )
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(photo=self.photo, person=person, deleted=True)

    def _tags(self, region_info, use_sidecar=False, photo=None, **on_disk):
        found = {**FILE_METADATA, Tags.REGION_INFO: region_info, **on_disk}

        def get_metadata(media_file, tags, **kwargs):
            return [found.get(tag) for tag in tags]

        with patch("api.metadata.face_regions.get_metadata", side_effect=get_metadata):
            return get_face_region_tags(photo or self.photo, use_sidecar=use_sidecar)

    def test_the_media_file_loses_its_regions_and_their_names(self):
        tags = self._tags(ALICE_REGION)

        self.assertEqual(
            {Tags.REGION_INFO_WRITE: "", remove_from(Tags.SUBJECT): ["Alice"]}, tags
        )

    def test_a_new_sidecar_says_there_are_none(self):
        tags = self._tags(
            ALICE_REGION, use_sidecar=True, **{Tags.SUBJECT: ["Alice", "Holiday"]}
        )

        self.assertEqual(
            {Tags.REGION_INFO_WRITE: NO_REGIONS, Tags.SUBJECT: ["Holiday"]}, tags
        )

    def test_a_file_without_face_regions_is_left_alone(self):
        not_a_face = {"RegionList": [{"Name": "Rex", "Type": "Pet"}]}
        for region_info in (None, "", {"AppliedToDimensions": {}}, not_a_face):
            with self.subTest(region_info=region_info):
                self.assertEqual({}, self._tags(region_info))

    def test_a_photo_without_faces_keeps_the_regions_of_its_file(self):
        photo = create_test_photo(owner=self.user)

        self.assertEqual({}, self._tags(ALICE_REGION, photo=photo))

    def test_a_name_the_photo_has_as_a_tag_stays_a_keyword(self):
        create_test_tag(self.user, "Alice").photos.add(self.photo)

        self.assertEqual({Tags.REGION_INFO_WRITE: ""}, self._tags(ALICE_REGION))

    def test_unnamed_regions_change_no_keywords(self):
        unnamed = {"RegionList": [{"Type": "Face", "Name": ""}]}

        self.assertEqual({Tags.REGION_INFO_WRITE: ""}, self._tags(unnamed))

    def test_a_relabel_keeps_a_name_the_photo_has_as_a_tag(self):
        create_test_tag(self.user, "Alice").photos.add(self.photo)
        bob = create_test_person(
            name="Bob", kind=Person.KIND_USER, cluster_owner=self.user
        )
        create_test_face(
            photo=self.photo,
            person=bob,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )
        mock_img = MagicMock()
        mock_img.size = (1000, 800)

        with patch("api.metadata.face_regions.PIL.Image.open", return_value=mock_img):
            tags = self._tags(ALICE_REGION)

        self.assertEqual(["Bob"], tags[remove_from(Tags.SUBJECT)])
        self.assertEqual(["Bob"], tags[add_to(Tags.SUBJECT)])


class DeleteFacesWriteBackTest(TestCase):
    """Deleting faces queues one write of the regions of every photo (#1531)."""

    def setUp(self):
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.MEDIA_FILE,
            save_face_tags_to_disk=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        person = create_test_person(cluster_owner=self.user)
        self.photos = [create_test_photo(owner=self.user) for _ in range(2)]
        # A labelled face on one photo, an unknown one on the other.
        self.faces = [
            create_test_face(photo=self.photos[0], person=person),
            create_test_face(photo=self.photos[1]),
        ]

    def _delete(self):
        with (
            patch("api.faces.labels.enqueue_task") as enqueue,
            patch("api.faces.labels.write_photo_metadata") as write,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(
                "/api/deletefaces/",
                {"face_ids": [face.pk for face in self.faces]},
                format="json",
            )
        self.assertEqual(200, response.status_code, response.content)
        write.assert_not_called()  # not in the request
        return enqueue

    def test_one_job_writes_every_photo(self):
        enqueue = self._delete()

        enqueue.assert_called_once()
        func, user_id, photo_ids = enqueue.call_args.args
        self.assertEqual((write_face_tags_later, self.user.pk), (func, user_id))
        self.assertCountEqual([photo.pk for photo in self.photos], photo_ids)

    def test_nothing_is_queued_when_off(self):
        for mode, face_tags in (
            (User.SaveMetadata.OFF, True),
            (User.SaveMetadata.MEDIA_FILE, False),
        ):
            with self.subTest(mode=mode, face_tags=face_tags):
                User.objects.filter(pk=self.user.pk).update(
                    save_metadata_to_disk=mode, save_face_tags_to_disk=face_tags
                )
                self.user.refresh_from_db()

                self._delete().assert_not_called()

    def test_the_job_writes_each_photo_once(self):
        self._delete()

        with patch("api.faces.labels.write_photo_metadata") as write:
            error = write_face_tags_later(
                self.user.pk, [photo.pk for photo in self.photos]
            )

        self.assertIsNone(error)
        self.assertCountEqual(
            [photo.pk for photo in self.photos],
            [call.args[0].pk for call in write.call_args_list],
        )
