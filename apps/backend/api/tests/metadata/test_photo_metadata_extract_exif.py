"""
Characterization tests for ``PhotoMetadata.extract_exif_data`` (unit 24).

These pin the *current* behaviour of the classmethod before refactoring:
the tag list passed to ``get_metadata``, the positional unpacking of its
18-element result, the per-field truthiness/type guards, the keyword merge,
and the ``commit`` semantics.

``get_metadata`` is always mocked, so no exiftool binary or sidecar service
is required.
"""

from unittest.mock import patch

from django.test import TestCase

from api.metadata.tags import Tags
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user

# Index of each value inside the tuple returned by get_metadata(), in the
# order extract_exif_data unpacks it.
IDX = {
    "size": 0,
    "fstop": 1,
    "focal_length": 2,
    "iso": 3,
    "shutter_speed": 4,
    "camera": 5,
    "lens": 6,
    "width": 7,
    "height": 8,
    "focal_length_35": 9,
    "subject_distance": 10,
    "digital_zoom_ratio": 11,
    "video_length": 12,
    "rating": 13,
    "subsec_time_original": 14,
    "image_number": 15,
    "xmp_subject": 16,
    "iptc_keywords": 17,
}


def metadata_tuple(**overrides):
    """Build an 18-element get_metadata() result with named overrides."""
    values = [None] * 18
    for name, value in overrides.items():
        values[IDX[name]] = value
    return tuple(values)


class ExtractExifDataBaseTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def extract(self, commit=True, **overrides):
        """Run extract_exif_data with a mocked get_metadata result."""
        with patch(
            "api.models.photo_metadata.get_metadata",
            return_value=metadata_tuple(**overrides),
        ) as mocked:
            result = PhotoMetadata.extract_exif_data(self.photo, commit=commit)
        self.mocked_get_metadata = mocked
        return result


class ExtractExifDataGuardTestCase(ExtractExifDataBaseTestCase):
    def test_returns_none_when_photo_has_no_main_file(self):
        """No main_file short-circuits before get_metadata is ever called."""
        self.photo.main_file = None
        self.photo.save()

        with patch("api.models.photo_metadata.get_metadata") as mocked:
            result = PhotoMetadata.extract_exif_data(self.photo, commit=True)

        self.assertIsNone(result)
        mocked.assert_not_called()
        self.assertFalse(PhotoMetadata.objects.filter(photo=self.photo).exists())

    def test_get_metadata_called_with_full_tag_list_and_sidecar(self):
        """The exact tag list / try_sidecar contract must survive refactoring."""
        self.extract()

        self.mocked_get_metadata.assert_called_once()
        args, kwargs = self.mocked_get_metadata.call_args
        self.assertEqual(args[0], self.photo.main_file.path)
        self.assertTrue(kwargs["try_sidecar"])
        self.assertEqual(
            kwargs["tags"],
            [
                Tags.FILE_SIZE,
                Tags.FSTOP,
                Tags.FOCAL_LENGTH,
                Tags.ISO,
                Tags.EXPOSURE_TIME,
                Tags.CAMERA,
                Tags.LENS,
                Tags.IMAGE_WIDTH,
                Tags.IMAGE_HEIGHT,
                Tags.FOCAL_LENGTH_35MM,
                Tags.SUBJECT_DISTANCE,
                Tags.DIGITAL_ZOOM_RATIO,
                Tags.QUICKTIME_DURATION,
                Tags.RATING,
                Tags.SUBSEC_TIME_ORIGINAL,
                Tags.IMAGE_NUMBER,
                Tags.SUBJECT,
                Tags.IPTC_KEYWORDS,
            ],
        )


class ExtractExifDataHappyPathTestCase(ExtractExifDataBaseTestCase):
    def test_populates_photo_and_metadata_fields(self):
        metadata = self.extract(
            size=123456,
            fstop=2.8,
            focal_length=35.0,
            iso=400,
            shutter_speed=0.004,
            camera="Canon EOS R5",
            lens="RF 24-70mm",
            width=6000,
            height=4000,
            focal_length_35=50,
            video_length=12.5,
            rating=4,
            subsec_time_original=123,
            image_number=7,
        )

        # Photo-level fields
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.size, 123456)
        # Photo.video_length is a TextField, so the float is coerced to str
        # on refresh_from_db.
        self.assertEqual(self.photo.video_length, "12.5")
        self.assertEqual(self.photo.rating, 4)
        self.assertEqual(self.photo.exif_timestamp_subsec, "123")
        self.assertEqual(self.photo.image_sequence_number, 7)

        # PhotoMetadata fields
        metadata.refresh_from_db()
        self.assertEqual(metadata.aperture, 2.8)
        self.assertEqual(metadata.focal_length, 35.0)
        self.assertEqual(metadata.iso, 400)
        self.assertEqual(metadata.shutter_speed, "1/250")
        self.assertEqual(metadata.camera_model, "Canon EOS R5")
        self.assertEqual(metadata.lens_model, "RF 24-70mm")
        self.assertEqual(metadata.width, 6000)
        self.assertEqual(metadata.height, 4000)
        self.assertEqual(metadata.focal_length_35mm, 50)
        self.assertEqual(metadata.rating, 4)
        self.assertEqual(metadata.date_taken_subsec, "123")
        self.assertEqual(metadata.source, PhotoMetadata.Source.EMBEDDED)

    def test_created_metadata_defaults_to_embedded_source(self):
        metadata = self.extract(fstop=1.8)
        self.assertEqual(metadata.source, PhotoMetadata.Source.EMBEDDED)
        self.assertEqual(PhotoMetadata.objects.filter(photo=self.photo).count(), 1)

    def test_existing_metadata_row_is_reused_and_source_preserved(self):
        existing = PhotoMetadata.objects.create(
            photo=self.photo,
            source=PhotoMetadata.Source.USER_EDIT,
            camera_model="Old Camera",
        )

        metadata = self.extract(fstop=5.6)

        self.assertEqual(metadata.pk, existing.pk)
        # camera was None in the result, so the old value survives.
        self.assertEqual(metadata.camera_model, "Old Camera")
        self.assertEqual(metadata.source, PhotoMetadata.Source.USER_EDIT)
        self.assertEqual(metadata.aperture, 5.6)

    def test_shutter_speed_faster_than_1_over_1000_collapses_to_zero(self):
        """KNOWN QUIRK: limit_denominator(1000) turns 1/8000s into the string
        "0" rather than clamping to "1/1000". Pinned as current behaviour."""
        metadata = self.extract(shutter_speed=1 / 8000)
        self.assertEqual(metadata.shutter_speed, "0")

    def test_subsec_time_original_truncated_to_ten_characters(self):
        metadata = self.extract(subsec_time_original="12345678901234")
        self.photo.refresh_from_db()
        self.assertEqual(metadata.date_taken_subsec, "1234567890")
        self.assertEqual(self.photo.exif_timestamp_subsec, "1234567890")

    def test_image_number_coerced_to_int(self):
        self.extract(image_number=9.0)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.image_sequence_number, 9)
        self.assertIsInstance(self.photo.image_sequence_number, int)


class ExtractExifDataTypeGuardTestCase(ExtractExifDataBaseTestCase):
    def test_non_numeric_values_are_ignored(self):
        """Strings where numbers are expected are silently dropped."""
        metadata = self.extract(
            size="not-a-number",
            fstop="f/2.8",
            focal_length="35mm",
            iso="ISO400",
            width="6000",
            height="4000",
            focal_length_35="50",
            video_length="12s",
            rating="four",
        )

        self.photo.refresh_from_db()
        # Photo.size / Photo.rating default to 0, so "untouched" means 0.
        self.assertEqual(self.photo.size, 0)
        self.assertIsNone(self.photo.video_length)
        self.assertEqual(self.photo.rating, 0)

        self.assertIsNone(metadata.aperture)
        self.assertIsNone(metadata.focal_length)
        self.assertIsNone(metadata.iso)
        self.assertIsNone(metadata.width)
        self.assertIsNone(metadata.height)
        self.assertIsNone(metadata.focal_length_35mm)
        self.assertIsNone(metadata.rating)

    def test_non_string_camera_and_lens_are_ignored(self):
        metadata = self.extract(camera=12345, lens=["a", "b"])
        self.assertIsNone(metadata.camera_model)
        self.assertIsNone(metadata.lens_model)

    def test_zero_valued_numbers_are_dropped_except_rating(self):
        """Truthiness guards drop 0 everywhere; rating uses `is not None`."""
        metadata = self.extract(
            size=0,
            fstop=0,
            focal_length=0,
            iso=0,
            width=0,
            height=0,
            focal_length_35=0,
            video_length=0,
            rating=0,
            image_number=0,
        )

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.size, 0)
        self.assertIsNone(self.photo.video_length)
        # rating and image_number are guarded with `is not None`
        self.assertEqual(self.photo.rating, 0)
        self.assertEqual(self.photo.image_sequence_number, 0)

        self.assertIsNone(metadata.aperture)
        self.assertIsNone(metadata.focal_length)
        self.assertIsNone(metadata.iso)
        self.assertIsNone(metadata.width)
        self.assertIsNone(metadata.height)
        self.assertIsNone(metadata.focal_length_35mm)
        self.assertEqual(metadata.rating, 0)

    def test_zero_shutter_speed_is_dropped(self):
        metadata = self.extract(shutter_speed=0)
        self.assertIsNone(metadata.shutter_speed)

    def test_booleans_count_as_numbers(self):
        """bool is a numbers.Number subclass, so True passes the guard."""
        metadata = self.extract(iso=True)
        self.assertEqual(metadata.iso, True)

    def test_empty_subsec_string_leaves_fields_untouched(self):
        metadata = self.extract(subsec_time_original="")
        self.photo.refresh_from_db()
        self.assertIsNone(metadata.date_taken_subsec)
        self.assertIsNone(self.photo.exif_timestamp_subsec)


class ExtractExifDataKeywordsTestCase(ExtractExifDataBaseTestCase):
    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_merges_and_sorts_xmp_and_iptc_lists(self, link_tags):
        metadata = self.extract(
            xmp_subject=["vacation", "beach"],
            iptc_keywords=["beach", "sunset"],
        )
        self.assertEqual(metadata.keywords, ["beach", "sunset", "vacation"])
        link_tags.assert_called_once_with(self.photo, metadata.keywords)

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_scalar_strings_are_accepted(self, _link_tags):
        metadata = self.extract(xmp_subject="solo", iptc_keywords="duo")
        self.assertEqual(metadata.keywords, ["duo", "solo"])

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_only_xmp_present(self, _link_tags):
        metadata = self.extract(xmp_subject=["a", "b"])
        self.assertEqual(metadata.keywords, ["a", "b"])

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_only_iptc_present(self, _link_tags):
        metadata = self.extract(iptc_keywords=["z"])
        self.assertEqual(metadata.keywords, ["z"])

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_non_list_non_string_keywords_are_ignored(self, _link_tags):
        metadata = self.extract(xmp_subject={"a": 1}, iptc_keywords=42)
        self.assertIsNone(metadata.keywords)

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_empty_keyword_containers_leave_existing_keywords_intact(self, link_tags):
        """No keywords found -> the existing keywords column is not cleared."""
        PhotoMetadata.objects.create(
            photo=self.photo, keywords=["previously", "stored"]
        )

        metadata = self.extract(xmp_subject=[], iptc_keywords=[])

        self.assertEqual(metadata.keywords, ["previously", "stored"])
        link_tags.assert_called_once_with(self.photo, ["previously", "stored"])

    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_link_tags_called_with_none_when_no_keywords_ever_seen(self, link_tags):
        metadata = self.extract(fstop=2.0)
        self.assertIsNone(metadata.keywords)
        link_tags.assert_called_once_with(self.photo, None)

    def test_keywords_create_tag_rows_when_committing(self):
        """The real link_tags_from_keywords runs on commit."""
        metadata = self.extract(iptc_keywords=["holiday"])
        self.assertEqual(metadata.keywords, ["holiday"])
        self.assertTrue(
            self.photo.tags.filter(name__iexact="holiday").exists(),
            "expected a Tag row linked from the extracted keyword",
        )


class ExtractExifDataCommitTestCase(ExtractExifDataBaseTestCase):
    @patch("api.models.photo_metadata.link_tags_from_keywords")
    def test_commit_false_skips_saves_and_tag_linking(self, link_tags):
        metadata = self.extract(
            commit=False,
            size=999,
            fstop=4.0,
            iptc_keywords=["nosave"],
        )

        link_tags.assert_not_called()

        # In-memory values are set...
        self.assertEqual(self.photo.size, 999)
        self.assertEqual(metadata.aperture, 4.0)
        self.assertEqual(metadata.keywords, ["nosave"])

        # ...but nothing was persisted.
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.size, 0)
        metadata.refresh_from_db()
        self.assertIsNone(metadata.aperture)
        self.assertIsNone(metadata.keywords)

    def test_commit_false_still_creates_the_metadata_row(self):
        """get_or_create writes to the DB regardless of `commit`."""
        self.assertFalse(PhotoMetadata.objects.filter(photo=self.photo).exists())

        self.extract(commit=False, fstop=1.4)

        self.assertTrue(PhotoMetadata.objects.filter(photo=self.photo).exists())

    def test_commit_true_persists_metadata(self):
        metadata = self.extract(commit=True, camera="Nikon Z9")
        metadata.refresh_from_db()
        self.assertEqual(metadata.camera_model, "Nikon Z9")


class ExtractExifDataAllNoneTestCase(ExtractExifDataBaseTestCase):
    def test_all_none_result_produces_empty_metadata_row(self):
        metadata = self.extract()

        self.assertIsNotNone(metadata)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.size, 0)
        self.assertEqual(self.photo.rating, 0)
        self.assertIsNone(self.photo.exif_timestamp_subsec)
        self.assertIsNone(self.photo.image_sequence_number)
        for field in (
            "aperture",
            "focal_length",
            "iso",
            "shutter_speed",
            "camera_model",
            "lens_model",
            "width",
            "height",
            "focal_length_35mm",
            "rating",
            "date_taken_subsec",
            "keywords",
        ):
            self.assertIsNone(getattr(metadata, field), field)
