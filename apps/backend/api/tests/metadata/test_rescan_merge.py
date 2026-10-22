"""How a rescan merges what the file says with edits made in LibrePhotos.

One rule for every value the user can edit: the file's value is taken only
where the file changed since the last read. Tags take a keyword the file
did not give before (#2770), the rating takes the file's rating when it
differs from the one last read (#2771), whether or not edits are written to
files. A sidecar's keyword list replaces the media file's own keywords
(#2772); the real ExifTool side of that is in
``test_rescan_merge_real``.

``get_metadata`` is replaced by ``FileStandIn``; restore from file
(``revert_all``) goes through the API as the lightbox calls it.
"""

import datetime
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.photo_reader import (
    EXIF_FIELDS,
    extract_exif_data,
    with_sidecar_keywords_only,
)
from api.metadata.reader import MEDIA_FILE_ORIGIN, TagValues
from api.models import Photo
from api.models.photo_metadata import REVERT_ALL, PhotoMetadata
from api.models.tag import Tag
from api.tests.utils import create_test_photo, create_test_user

NAME_OF = {tag: name for name, tag in EXIF_FIELDS}
WHEN_RATED = datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC)
SIDECAR = 1


class FileStandIn:
    """``get_metadata`` for a file whose values are ``self.values`` by value
    name, each from the file ``self.origins`` names (the media file unless
    said otherwise)."""

    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.origins: dict[str, int] = {}

    def __call__(self, path, tags, **kwargs):
        names = [NAME_OF.get(tag) for tag in tags]
        return TagValues(
            [self.values.get(name) for name in names],
            [
                self.origins.get(name, MEDIA_FILE_ORIGIN)
                if name in self.values
                else None
                for name in names
            ],
        )


class RescanTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.file = FileStandIn()

    def scan(self):
        photo = Photo.objects.get(pk=self.photo.pk)
        with patch("api.metadata.photo_reader.get_metadata", side_effect=self.file):
            extract_exif_data(photo, commit=True)
        return Photo.objects.get(pk=self.photo.pk)

    def restore_from_file(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        no_values = FileStandIn()
        with (
            patch("api.metadata.photo_reader.get_metadata", side_effect=self.file),
            patch("api.metadata.edits.get_metadata", side_effect=no_values),
            patch("api.metadata.photo_datetime.get_metadata", side_effect=no_values),
        ):
            response = client.post(f"/api/photos/{self.photo.pk}/metadata/revert-all/")
        self.assertEqual(200, response.status_code, response.content)
        return Photo.objects.get(pk=self.photo.pk)

    def metadata(self):
        return PhotoMetadata.objects.get(photo=self.photo)

    def tags(self):
        return sorted(
            Tag.objects.owned_by(self.user)
            .filter(photos=self.photo)
            .values_list("name", flat=True)
        )

    def remove_tag(self, name):
        Tag.objects.owned_by(self.user).get(name=name).photos.remove(self.photo)

    def rate(self, rating):
        edits.set_rating(Photo.objects.filter(pk=self.photo.pk), rating, self.user)


class KeywordRescanTest(RescanTestCase):
    """#2770, with "Write edits to files" Off (the test user's default)."""

    def test_a_first_scan_links_every_keyword(self):
        self.file.values = {"xmp_subject": ["Beach", "Holiday"]}

        self.scan()

        self.assertEqual(["Beach", "Holiday"], self.tags())

    def test_a_removed_tag_stays_removed(self):
        self.file.values = {"xmp_subject": ["Beach", "Holiday"]}
        self.scan()

        self.remove_tag("Beach")
        self.scan()
        self.scan()

        self.assertEqual(["Holiday"], self.tags())
        self.assertEqual(["Beach", "Holiday"], self.metadata().keywords)

    def test_a_keyword_another_app_adds_becomes_a_tag(self):
        self.file.values = {"xmp_subject": ["Beach", "Holiday"]}
        self.scan()
        self.remove_tag("Beach")

        self.file.values = {"xmp_subject": ["Beach", "Holiday", "Lighthouse"]}
        self.scan()

        self.assertEqual(["Holiday", "Lighthouse"], self.tags())

    def test_a_keyword_the_file_lost_and_got_back_is_new_again(self):
        self.file.values = {"xmp_subject": ["Beach"]}
        self.scan()
        self.remove_tag("Beach")

        self.file.values = {}
        self.scan()
        self.assertIsNone(self.metadata().keywords)
        self.file.values = {"xmp_subject": ["Beach"]}
        self.scan()

        self.assertEqual(["Beach"], self.tags())

    def test_restore_from_file_brings_the_removed_tag_back(self):
        self.file.values = {"xmp_subject": ["Beach", "Holiday"]}
        self.scan()
        self.remove_tag("Beach")

        self.restore_from_file()

        self.assertEqual(["Beach", "Holiday"], self.tags())


class RatingRescanTest(RescanTestCase):
    """#2771, with "Write edits to files" Off."""

    def test_a_first_scan_takes_the_files_rating_also_0(self):
        for rating in (0, 3):
            with self.subTest(rating=rating):
                PhotoMetadata.objects.filter(photo=self.photo).delete()
                Photo.objects.filter(pk=self.photo.pk).update(rating=5)
                self.file.values = {"rating": rating}

                self.assertEqual(rating, self.scan().rating)
                self.assertEqual(rating, self.metadata().file_rating)

    def test_a_favorite_survives_a_rescan_while_the_file_says_0(self):
        self.file.values = {"rating": 0}
        self.scan()

        self.rate(5)
        photo = self.scan()

        self.assertEqual(5, photo.rating)
        self.assertEqual(0, self.metadata().file_rating)

    def test_a_rating_changed_in_the_file_wins(self):
        self.file.values = {"rating": 0}
        self.scan()
        self.rate(5)

        self.file.values = {"rating": 3}
        photo = self.scan()

        self.assertEqual(3, photo.rating)
        self.assertEqual(3, self.metadata().file_rating)

    def test_a_file_without_a_rating_changes_nothing(self):
        self.file.values = {"rating": 2}
        self.scan()
        self.rate(4)

        self.file.values = {}
        photo = self.scan()

        self.assertEqual(4, photo.rating)
        self.assertEqual(2, self.metadata().file_rating)

    def test_a_rating_that_is_not_a_number_is_no_rating(self):
        for value in ("four", True):
            with self.subTest(value=value):
                self.file.values = {"rating": value}
                self.assertEqual(0, self.scan().rating)
                self.assertIsNone(self.metadata().file_rating)

    def test_upgrade_keeps_a_rating_set_in_librephotos(self):
        # A row from before #2771: no file_rating, a rating edit on record.
        self.file.values = {"rating": 0}
        self.scan()
        self.rate(4)
        PhotoMetadata.objects.filter(photo=self.photo).update(file_rating=None)

        photo = self.scan()

        self.assertEqual(4, photo.rating)
        self.assertEqual(0, self.metadata().file_rating)

    def test_upgrade_without_a_rating_edit_takes_the_files(self):
        self.file.values = {"rating": 2}
        self.scan()
        PhotoMetadata.objects.filter(photo=self.photo).update(file_rating=None)
        Photo.objects.filter(pk=self.photo.pk).update(rating=5)

        self.assertEqual(2, self.scan().rating)

    def test_upgrade_ignores_a_rating_edit_before_a_restore(self):
        self.file.values = {"rating": 2}
        self.scan()
        self.rate(4)
        self.restore_from_file()
        # Before the restore for sure, not just within the same clock tick.
        self.photo.metadata_edits.filter(field_name="rating").update(
            created_at=WHEN_RATED
        )
        PhotoMetadata.objects.filter(photo=self.photo).update(
            file_rating=None, source=PhotoMetadata.Source.USER_EDIT
        )
        Photo.objects.filter(pk=self.photo.pk).update(rating=5)

        self.assertEqual(2, self.scan().rating)

    def test_restore_from_file_takes_the_files_rating(self):
        self.file.values = {"rating": 2}
        self.scan()
        self.rate(5)

        photo = self.restore_from_file()

        self.assertEqual(2, photo.rating)
        self.assertEqual(2, self.metadata().file_rating)
        self.assertTrue(
            self.photo.metadata_edits.filter(field_name=REVERT_ALL).exists()
        )

    def test_restore_from_a_file_without_a_rating_sets_0(self):
        self.file.values = {"rating": 2}
        self.scan()
        self.rate(5)

        self.file.values = {}
        photo = self.restore_from_file()

        self.assertEqual(0, photo.rating)
        self.assertIsNone(self.metadata().file_rating)


class SidecarKeywordRescanTest(RescanTestCase):
    """#2772 through the scan: the sidecar's keyword list is the photo's."""

    def test_the_sidecar_list_replaces_the_media_files(self):
        self.file.values = {
            "xmp_subject": ["holiday"],
            "iptc_keywords": ["family"],
            "hierarchical_subject": ["Places|Lisbon"],
            "camera": "Cam",
        }
        self.file.origins = {"xmp_subject": SIDECAR}

        self.scan()

        self.assertEqual(["holiday"], self.metadata().keywords)
        self.assertEqual(["holiday"], self.tags())
        self.assertEqual("Cam", self.metadata().camera_model)


class WithSidecarKeywordsOnlyTest(SimpleTestCase):
    VALUES = {
        "xmp_subject": ["holiday"],
        "iptc_keywords": ["family"],
        "person_in_image": ["Ann"],
        "hierarchical_subject": ["Places|Lisbon"],
        "camera": "Cam",
    }

    def kept(self, origins):
        values = with_sidecar_keywords_only(dict(self.VALUES), origins)
        return {name for name, value in values.items() if value is not None}

    def test_all_from_the_media_file_stay(self):
        origins = dict.fromkeys(self.VALUES, 0)
        self.assertEqual(set(self.VALUES), self.kept(origins))

    def test_without_origins_everything_stays(self):
        self.assertEqual(set(self.VALUES), self.kept({}))

    def test_a_sidecar_keyword_source_drops_the_media_files(self):
        for sidecar_name in ("xmp_subject", "person_in_image", "hierarchical_subject"):
            with self.subTest(sidecar_name=sidecar_name):
                origins = {**dict.fromkeys(self.VALUES, 0), sidecar_name: 2}
                self.assertEqual({sidecar_name, "camera"}, self.kept(origins))

    def test_several_sidecar_sources_all_stay(self):
        origins = {
            **dict.fromkeys(self.VALUES, 0),
            "xmp_subject": 1,
            "hierarchical_subject": 2,
        }
        self.assertEqual(
            {"xmp_subject", "hierarchical_subject", "camera"}, self.kept(origins)
        )

    def test_a_sidecar_without_keywords_keeps_the_media_files(self):
        origins = {**dict.fromkeys(self.VALUES, 0), "camera": 1}
        self.assertEqual(set(self.VALUES), self.kept(origins))
