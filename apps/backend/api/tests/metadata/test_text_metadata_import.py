"""Captions, title, creator, copyright and extra keywords read from the file.

#2266: the caption falls back from XMP to ``IPTC:Caption-Abstract`` and
``EXIF:ImageDescription`` (camera placeholders skipped), and title, creator
and copyright are read from XMP, IPTC and EXIF. A value the user edited
survives a rescan; revert-all brings the file's back.

#2267: ``XMP-iptcExt:PersonInImage`` names and the leaf of each
``XMP-lr:HierarchicalSubject`` path become keywords, and so tags.

The ``RealExifToolTestCase`` classes write the tags with the real ExifTool
and read them through the scan's own code, so a wrong tag name fails here.
"""

from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.photo_reader import EXIF_FIELDS, EXIF_VALUE_NAMES, extract_exif_data
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    CAMERA_PLACEHOLDER_DESCRIPTIONS,
    CREATOR_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    PhotoMetadata,
    _fields_edited_by_user,
    description_of,
    merged_keywords_of,
    text_fields_of,
)
from api.models.tag import Tag
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_photo, create_test_user


class ReadTagsTest(SimpleTestCase):
    def test_every_value_name_is_read_once(self):
        self.assertEqual(len(EXIF_VALUE_NAMES), len(set(EXIF_VALUE_NAMES)))
        tags = [tag for _, tag in EXIF_FIELDS]
        self.assertEqual(len(tags), len(set(tags)))

    def test_no_two_groups_share_a_tag_name(self):
        """The exif sidecar's -struct reads come back without groups, so two
        tags of one name (IPTC:Headline and XMP:Headline) would answer as one.
        QuickTime and Matroska durations never meet in one file."""
        names = [
            tag.rpartition(":")[2].lower()
            for _, tag in EXIF_FIELDS
            if tag.rpartition(":")[2] != "Duration"
        ]
        self.assertEqual(len(names), len(set(names)), names)


class DescriptionOfTest(SimpleTestCase):
    def test_sources_in_order(self):
        values = {
            "xmp_description": "xmp",
            "xmp_description_any_language": "language",
            "iptc_caption": "iptc",
            "image_description": "exif",
        }
        for name in (
            "xmp_description",
            "xmp_description_any_language",
            "iptc_caption",
            "image_description",
        ):
            with self.subTest(winner=name):
                self.assertEqual(description_of(values), values[name])
                values[name] = None
        self.assertIsNone(description_of(values))

    def test_camera_placeholders_are_skipped(self):
        for placeholder in sorted(CAMERA_PLACEHOLDER_DESCRIPTIONS):
            with self.subTest(placeholder=placeholder):
                self.assertIsNone(
                    description_of({"image_description": placeholder.upper()})
                )

    def test_placeholder_match_ignores_case_and_spacing(self):
        self.assertIsNone(
            description_of({"image_description": "  olympus   DIGITAL camera "})
        )

    def test_a_placeholder_gives_way_to_the_next_source(self):
        values = {
            "xmp_description": "OLYMPUS DIGITAL CAMERA",
            "image_description": "OLYMPUS DIGITAL CAMERA",
            "iptc_caption": "Sunset at the pier",
        }
        self.assertEqual(description_of(values), "Sunset at the pier")

    def test_a_description_that_only_names_the_camera_is_skipped(self):
        values = {"image_description": "Canon EOS 5D", "camera": "Canon EOS 5D"}
        self.assertIsNone(description_of(values))

    def test_a_text_containing_a_placeholder_is_kept(self):
        text = "My OLYMPUS DIGITAL CAMERA on the beach"
        self.assertEqual(description_of({"image_description": text}), text)


class TextFieldsOfTest(SimpleTestCase):
    SOURCES = {
        "title": ("xmp_title", "xmp_headline", "iptc_object_name"),
        "creator": ("xmp_creator", "iptc_byline", "exif_artist"),
        "copyright": ("xmp_rights", "iptc_copyright", "exif_copyright"),
    }

    def test_sources_in_order(self):
        for field, names in self.SOURCES.items():
            values: dict[str, object] = {name: name for name in names}
            for name in names:
                with self.subTest(field=field, winner=name):
                    self.assertEqual(text_fields_of(values)[field], name)
                    values[name] = "   "
            self.assertIsNone(text_fields_of(values)[field])

    def test_the_first_of_several_creators(self):
        values = {"xmp_creator": ["Jane Doe", "John Roe"], "exif_artist": "Other"}
        self.assertEqual(text_fields_of(values)["creator"], "Jane Doe")

    def test_a_numeric_title_is_text(self):
        self.assertEqual(text_fields_of({"xmp_title": 2024})["title"], "2024")

    def test_long_values_fit_their_column(self):
        found = text_fields_of({"xmp_title": "t" * 900, "xmp_creator": "c" * 900})
        self.assertEqual(len(found["title"] or ""), TITLE_MAX_LENGTH)
        self.assertEqual(len(found["creator"] or ""), CREATOR_MAX_LENGTH)


class MergedKeywordsOfTest(SimpleTestCase):
    def test_people_and_hierarchy_leaves(self):
        values = {
            "person_in_image": "Alice",
            "hierarchical_subject": "Places|USA|San Francisco",
        }
        self.assertEqual(merged_keywords_of(values), ["Alice", "San Francisco"])

    def test_several_people_and_paths_merge_with_subject_once(self):
        values = {
            "xmp_subject": ["Alice", "beach"],
            "person_in_image": ["Alice", "Bob"],
            "hierarchical_subject": ["Places|USA|San Francisco", "Activities|beach"],
        }
        self.assertEqual(
            merged_keywords_of(values), ["Alice", "Bob", "San Francisco", "beach"]
        )

    def test_numeric_entries_do_not_break_sorting(self):
        values = {
            "person_in_image": [2024, "Alice"],
            "hierarchical_subject": ["Years|2023", 7],
        }
        self.assertEqual(merged_keywords_of(values), ["2023", "2024", "7", "Alice"])

    def test_a_path_with_an_empty_leaf_adds_nothing(self):
        self.assertEqual(merged_keywords_of({"hierarchical_subject": "Places|"}), [])


class RescanKeepsUserTextTest(TestCase):
    """The scan fills title, creator and copyright but never over a user's."""

    FILE = {
        "xmp_title": "file title",
        "iptc_byline": "file creator",
        "exif_copyright": "file copyright",
    }

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def scan(self, values=None):
        named = values if values is not None else self.FILE
        mock_values = [named.get(name) for name in EXIF_VALUE_NAMES]
        with patch("api.metadata.photo_reader.get_metadata", return_value=mock_values):
            extract_exif_data(self.photo, commit=True)
        return PhotoMetadata.objects.get(photo=self.photo)

    def test_the_file_fills_the_fields(self):
        metadata = self.scan()

        self.assertEqual(metadata.title, "file title")
        self.assertEqual(metadata.creator, "file creator")
        self.assertEqual(metadata.copyright, "file copyright")

    def test_a_never_edited_photo_costs_no_edit_query(self):
        metadata = self.scan()

        with self.assertNumQueries(0):
            self.assertEqual(_fields_edited_by_user(metadata, ["title"]), set())

    def test_a_user_edit_survives_a_rescan(self):
        self.scan()
        edits.set_text_field(self.photo, "title", "my title", self.user)
        edits.set_text_field(self.photo, "creator", None, self.user)

        metadata = self.scan()

        self.assertEqual(metadata.title, "my title")
        self.assertIsNone(metadata.creator)
        # The field the user left alone still follows the file.
        self.assertEqual(metadata.copyright, "file copyright")

    def test_an_edit_of_another_field_does_not_lock_the_text(self):
        self.scan({"xmp_title": "first"})
        edits.set_text_field(self.photo, "copyright", "mine", self.user)

        metadata = self.scan({"xmp_title": "second"})

        self.assertEqual(metadata.title, "second")
        self.assertEqual(metadata.copyright, "mine")

    def test_after_revert_all_the_file_wins_again(self):
        self.scan()
        edits.set_text_field(self.photo, "title", "my title", self.user)
        mock_values = [self.FILE.get(name) for name in EXIF_VALUE_NAMES]
        with (
            patch("api.metadata.photo_reader.get_metadata", return_value=mock_values),
            patch("api.metadata.edits.get_metadata", return_value=[None, None]),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=lambda path, tags, **kwargs: [None] * len(tags),
            ),
        ):
            metadata = edits.revert_all(self.photo, self.user)
        self.assertEqual(metadata.title, "file title")

        metadata = self.scan({"xmp_title": "edited elsewhere"})

        self.assertEqual(metadata.title, "edited elsewhere")


class TextMetadataFromRealFilesTest(RealExifToolTestCase):
    """Each source written with the real ExifTool, read by the scan's code."""

    def setUp(self):
        super().setUp()
        self.user = create_test_user()
        self.images = 0

    def new_image(self):
        self.images += 1
        return self.make_image(name=f"photo{self.images}")

    def scan(self, *tags):
        path = self.new_image()
        if tags:
            self.tag(path, *tags)
        photo = self.photo_for(path, self.user)
        extract_exif_data(photo, commit=True)
        return photo, PhotoMetadata.objects.get(photo=photo)

    def caption(self, photo):
        caption = PhotoCaption.objects.filter(photo=photo).first()
        return (caption.captions_json or {}).get("user_caption") if caption else None

    # ---- captions -------------------------------------------------------

    def test_iptc_caption_alone(self):
        photo, _ = self.scan("-IPTC:Caption-Abstract=Sunset at the pier")
        self.assertEqual(self.caption(photo), "Sunset at the pier")

    def test_exif_image_description_alone(self):
        photo, _ = self.scan("-EXIF:ImageDescription=Sunset at the pier")
        self.assertEqual(self.caption(photo), "Sunset at the pier")

    def test_xmp_description_wins_over_iptc_and_exif(self):
        photo, _ = self.scan(
            "-XMP-dc:Description=from xmp",
            "-IPTC:Caption-Abstract=from iptc",
            "-EXIF:ImageDescription=from exif",
        )
        self.assertEqual(self.caption(photo), "from xmp")

    def test_iptc_caption_wins_over_exif(self):
        photo, _ = self.scan(
            "-IPTC:Caption-Abstract=from iptc", "-EXIF:ImageDescription=from exif"
        )
        self.assertEqual(self.caption(photo), "from iptc")

    def test_camera_placeholder_is_not_imported(self):
        photo, _ = self.scan("-EXIF:ImageDescription=OLYMPUS DIGITAL CAMERA")
        self.assertIsNone(self.caption(photo))

    def test_a_typed_caption_is_kept_when_the_file_gains_an_iptc_caption(self):
        path = self.new_image()
        photo = self.photo_for(path, self.user)
        extract_exif_data(photo, commit=True)
        edits.set_caption(photo, "typed by the user", self.user)

        self.tag(path, "-IPTC:Caption-Abstract=from iptc")
        extract_exif_data(photo, commit=True)

        self.assertEqual(self.caption(photo), "typed by the user")

    # ---- title, creator, copyright ------------------------------------

    def test_each_title_source(self):
        cases = [
            ("-XMP-dc:Title=xmp title", "xmp title"),
            ("-XMP-photoshop:Headline=xmp headline", "xmp headline"),
            ("-IPTC:ObjectName=iptc object", "iptc object"),
        ]
        for argument, expected in cases:
            with self.subTest(argument=argument):
                _, metadata = self.scan(argument)
                self.assertEqual(metadata.title, expected)

    def test_title_order(self):
        _, metadata = self.scan(
            "-XMP-photoshop:Headline=xmp headline",
            "-IPTC:ObjectName=iptc object",
            "-IPTC:Headline=iptc headline",
        )
        self.assertEqual(metadata.title, "xmp headline")
        _, metadata = self.scan(
            "-XMP-dc:Title=xmp title", "-XMP-photoshop:Headline=xmp headline"
        )
        self.assertEqual(metadata.title, "xmp title")
        _, metadata = self.scan(
            "-IPTC:ObjectName=iptc object", "-IPTC:Headline=iptc headline"
        )
        self.assertEqual(metadata.title, "iptc object")

    def test_each_creator_source(self):
        cases = [
            (("-XMP-dc:Creator=Jane Doe", "-XMP-dc:Creator=John Roe"), "Jane Doe"),
            (("-IPTC:By-line=Iptc Author",), "Iptc Author"),
            (("-EXIF:Artist=Exif Artist",), "Exif Artist"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                _, metadata = self.scan(*arguments)
                self.assertEqual(metadata.creator, expected)

    def test_creator_order(self):
        _, metadata = self.scan(
            "-XMP-dc:Creator=xmp", "-IPTC:By-line=iptc", "-EXIF:Artist=exif"
        )
        self.assertEqual(metadata.creator, "xmp")
        _, metadata = self.scan("-IPTC:By-line=iptc", "-EXIF:Artist=exif")
        self.assertEqual(metadata.creator, "iptc")

    def test_each_copyright_source(self):
        cases = [
            ("-XMP-dc:Rights=(c) xmp", "(c) xmp"),
            ("-IPTC:CopyrightNotice=(c) iptc", "(c) iptc"),
            ("-EXIF:Copyright=(c) exif", "(c) exif"),
        ]
        for argument, expected in cases:
            with self.subTest(argument=argument):
                _, metadata = self.scan(argument)
                self.assertEqual(metadata.copyright, expected)

    def test_copyright_order(self):
        _, metadata = self.scan(
            "-XMP-dc:Rights=xmp", "-IPTC:CopyrightNotice=iptc", "-EXIF:Copyright=exif"
        )
        self.assertEqual(metadata.copyright, "xmp")
        _, metadata = self.scan("-IPTC:CopyrightNotice=iptc", "-EXIF:Copyright=exif")
        self.assertEqual(metadata.copyright, "iptc")

    def test_a_metadata_api_edit_survives_a_rescan(self):
        path = self.new_image()
        self.tag(path, "-XMP-dc:Title=file title", "-EXIF:Artist=file artist")
        photo = self.photo_for(path, self.user)
        extract_exif_data(photo, commit=True)
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.patch(
            f"/api/photos/{photo.id}/metadata/", {"title": "my title"}, format="json"
        )
        self.assertEqual(response.status_code, 200)

        extract_exif_data(photo, commit=True)

        metadata = PhotoMetadata.objects.get(photo=photo)
        self.assertEqual(metadata.title, "my title")
        self.assertEqual(metadata.creator, "file artist")

    # ---- keywords (#2267) ----------------------------------------------

    def test_person_in_image_and_hierarchy_leaf_become_tags(self):
        photo, metadata = self.scan(
            "-XMP-iptcExt:PersonInImage=Alice",
            "-XMP-lr:HierarchicalSubject=Places|USA|San Francisco",
        )
        self.assertEqual(metadata.keywords, ["Alice", "San Francisco"])
        self.assertEqual(
            set(Tag.objects.filter(photos=photo).values_list("name", flat=True)),
            {"Alice", "San Francisco"},
        )

    def test_two_people_and_a_subject_duplicate(self):
        _, metadata = self.scan(
            "-XMP-iptcExt:PersonInImage=Alice",
            "-XMP-iptcExt:PersonInImage=Bob",
            "-XMP-dc:Subject=Alice",
        )
        self.assertEqual(metadata.keywords, ["Alice", "Bob"])
