"""A photo's rights: copyright, creator and license (#425).

The license is one of a fixed list with canonical deeds; the file's
``XMP-cc:License`` or a Creative Commons ``WebStatement`` states it. The
round trip through real ExifTool is ``RightsRoundTripTest`` in
``test_write_back_round_trip``.
"""

import datetime
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.jobs import write_photo_fields
from api.metadata.photo_writer import license_tags, rights_tags
from api.metadata.rights import (
    Keep,
    default_rights,
    replaces,
    resolved,
    rights_from_file,
    rights_summary,
    single_line,
)
from api.metadata.tags import Tags
from api.models import Photo, User
from api.models.photo_license import (
    LICENSE_URLS,
    PhotoLicense,
    license_from_url,
    license_of,
    license_url,
)
from api.models.photo_metadata import (
    MetadataEdit,
    PhotoMetadata,
    fields_edited_by_user_of,
    text_fields_of,
)
from api.tests.utils import (
    create_test_metadata_edit,
    create_test_photo,
    create_test_user,
)

TAKEN = datetime.datetime(2019, 8, 15, 7, 45, tzinfo=datetime.UTC)
SIDECAR = User.SaveMetadata.SIDECAR_FILE


class LicenseFromUrlTest(SimpleTestCase):
    def test_every_deed_maps_to_its_license(self):
        for code, url in LICENSE_URLS.items():
            with self.subTest(code=code):
                self.assertEqual(code, license_from_url(url))

    def test_the_spellings_files_carry(self):
        for url in (
            "http://creativecommons.org/licenses/by-sa/4.0/",
            "https://www.creativecommons.org/licenses/by-sa/4.0",
            "https://creativecommons.org/licenses/by-sa/4.0/deed.de",
            "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
            "https://creativecommons.org/licenses/by-sa/4.0/legalcode.zh-hans",
            " HTTPS://CreativeCommons.org/licenses/BY-SA/4.0/ ",
        ):
            with self.subTest(url=url):
                self.assertEqual(PhotoLicense.CC_BY_SA, license_from_url(url))

    def test_anything_else_is_no_license(self):
        for value in (
            None,
            42,
            "",
            "https://creativecommons.org/licenses/by/3.0/",
            "https://creativecommons.org/licenses/by/4.0/extra/",
            "https://example.com/licenses/by/4.0/",
            "javascript:alert(1)//creativecommons.org/licenses/by/4.0/",
            "https://creativecommons.org.evil.example/licenses/by/4.0/",
        ):
            with self.subTest(value=value):
                self.assertIsNone(license_from_url(value))

    def test_all_rights_reserved_has_no_deed(self):
        self.assertIsNone(license_url(PhotoLicense.ALL_RIGHTS_RESERVED))
        self.assertIsNone(license_url(None))
        self.assertEqual(
            "https://creativecommons.org/publicdomain/zero/1.0/",
            license_url(PhotoLicense.CC0),
        )


class LicenseOfTest(SimpleTestCase):
    def test_xmp_cc_license_comes_first(self):
        values = {
            "xmp_license": "https://creativecommons.org/licenses/by/4.0/",
            "xmp_web_statement": "https://creativecommons.org/licenses/by-nc/4.0/",
        }
        self.assertEqual(PhotoLicense.CC_BY, license_of(values))

    def test_a_creative_commons_web_statement(self):
        values = {
            "xmp_license": None,
            "xmp_web_statement": "https://creativecommons.org/licenses/by-nc/4.0/",
        }
        self.assertEqual(PhotoLicense.CC_BY_NC, license_of(values))

    def test_marked_without_a_license_is_all_rights_reserved(self):
        values = {"xmp_web_statement": "https://example.com/rights", "xmp_marked": True}
        self.assertEqual(PhotoLicense.ALL_RIGHTS_RESERVED, license_of(values))

    def test_nothing_states_no_license(self):
        self.assertIsNone(license_of({"xmp_marked": False}))
        self.assertIsNone(license_of({}))

    def test_text_fields_of_carries_the_license(self):
        values = {"xmp_rights": "(c) Anna", "xmp_marked": True}
        found = text_fields_of(values)
        self.assertEqual("(c) Anna", found["copyright"])
        self.assertEqual(PhotoLicense.ALL_RIGHTS_RESERVED, found["license"])


class RightsHelpersTest(SimpleTestCase):
    def test_replaces(self):
        for keep, current, edited, expected in (
            (Keep.ANY, None, False, True),
            (Keep.ANY, "", True, True),
            (Keep.ANY, "x", True, False),
            (Keep.FILE, "x", False, False),
            (Keep.FILE, "x", True, True),
            (Keep.NONE, "x", False, True),
        ):
            with self.subTest(keep=keep, current=current, edited=edited):
                self.assertEqual(expected, replaces(keep, current, edited))

    def test_resolved_puts_in_the_year(self):
        photo = Photo(exif_timestamp=TAKEN, added_on=TAKEN.replace(year=2024))
        self.assertEqual(
            "(c) 2019 Anna", resolved("copyright", "(c) {year} Anna", photo)
        )
        self.assertEqual("{year}", resolved("creator", "{year}", photo))
        self.assertIsNone(resolved("license", "", photo))
        undated = Photo(exif_timestamp=None, added_on=TAKEN.replace(year=2024))
        self.assertEqual("2024", resolved("copyright", "{year}", undated))

    def test_single_line(self):
        self.assertEqual(
            "(c) 2026 Anna Berger", single_line("(c) 2026\r\nAnna\x00Berger ")
        )
        self.assertEqual("a b", single_line("a \tb"))

    def test_default_rights_leaves_out_empty_fields(self):
        user = User(default_license="", default_creator=" Anna ", default_copyright="")
        self.assertEqual({"creator": "Anna"}, default_rights(user))


class LicenseTagsTest(SimpleTestCase):
    def test_a_creative_commons_license(self):
        tags = license_tags(PhotoLicense.CC_BY_NC, clears_web_statement=False)
        url = LICENSE_URLS[PhotoLicense.CC_BY_NC]
        self.assertEqual(
            {
                Tags.LICENSE_WRITE: url,
                Tags.WEB_STATEMENT_WRITE: url,
                Tags.USAGE_TERMS: f"CC BY-NC 4.0 ({url})",
                Tags.MARKED_WRITE: "True",
            },
            tags,
        )

    def test_public_domain_is_not_marked(self):
        for code in (PhotoLicense.CC0, PhotoLicense.PUBLIC_DOMAIN_MARK):
            with self.subTest(code=code):
                self.assertEqual("False", license_tags(code, False)[Tags.MARKED_WRITE])

    def test_all_rights_reserved_keeps_a_rights_page(self):
        tags = license_tags(
            PhotoLicense.ALL_RIGHTS_RESERVED, clears_web_statement=False
        )
        self.assertEqual("", tags[Tags.LICENSE_WRITE])
        self.assertEqual("All rights reserved", tags[Tags.USAGE_TERMS])
        self.assertEqual("True", tags[Tags.MARKED_WRITE])
        self.assertNotIn(Tags.WEB_STATEMENT_WRITE, tags)

    def test_no_license_removes_a_creative_commons_web_statement(self):
        tags = license_tags(None, clears_web_statement=True)
        self.assertEqual(
            {
                Tags.LICENSE_WRITE: "",
                Tags.WEB_STATEMENT_WRITE: "",
                Tags.USAGE_TERMS: "",
                Tags.MARKED_WRITE: "",
            },
            tags,
        )

    def test_rights_tags_flatten_line_breaks(self):
        metadata = PhotoMetadata(copyright="(c) Anna\nBerger", creator=None)
        tags = rights_tags(metadata, use_sidecar=False, clears_web_statement=False)
        self.assertEqual("(c) Anna Berger", tags[Tags.COPYRIGHT_MWG])
        self.assertEqual("", tags[Tags.CREATOR_MWG])
        sidecar = rights_tags(None, use_sidecar=True, clears_web_statement=False)
        self.assertEqual("", sidecar[Tags.RIGHTS_XMP])
        self.assertEqual("", sidecar[Tags.CREATOR_XMP])


class RightsEditTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=SIDECAR)
        self.photo = create_test_photo(owner=self.user, exif_timestamp=TAKEN, width=8)

    def metadata(self, photo=None):
        return PhotoMetadata.objects.get(photo=photo or self.photo)


class SetTextFieldLicenseTest(RightsEditTestCase):
    def test_a_license_is_set_recorded_and_written(self):
        with (
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            edits.set_text_field(self.photo, "license", "cc-by-4.0", self.user)

        self.assertEqual("cc-by-4.0", self.metadata().license)
        edit = MetadataEdit.objects.get(photo=self.photo, field_name="license")
        self.assertEqual("cc-by-4.0", edit.new_value)
        enqueue.assert_called_once_with(
            write_photo_fields, [self.photo.id], "rights", True
        )

    def test_an_unknown_license_is_refused(self):
        with self.assertRaises(edits.InvalidEditValueError):
            edits.set_text_field(self.photo, "license", "cc-by-3.0", self.user)

    def test_empty_clears_it(self):
        with patch("api.metadata.jobs.enqueue_task"):
            edits.set_text_field(self.photo, "license", "cc0-1.0", self.user)
            edits.set_text_field(self.photo, "license", "", self.user)
        self.assertIsNone(self.metadata().license)

    def test_the_title_is_not_written(self):
        with (
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            edits.set_text_field(self.photo, "title", "Harbour", self.user)
        enqueue.assert_not_called()

    def test_a_rescan_keeps_an_edited_license(self):
        with patch("api.metadata.jobs.enqueue_task"):
            edits.set_text_field(self.photo, "license", "cc-by-4.0", self.user)
        metadata = self.metadata()
        PhotoMetadata._apply_text_fields(
            metadata,
            {"xmp_license": "https://creativecommons.org/licenses/by-nd/4.0/"},
        )
        self.assertEqual("cc-by-4.0", metadata.license)


class SetRightsTest(RightsEditTestCase):
    def setUp(self):
        super().setUp()
        self.other = create_test_photo(owner=self.user, exif_timestamp=None, width=8)
        PhotoMetadata.objects.filter(photo=self.other).update(
            copyright="(c) Studio Nord", license="cc-by-sa-4.0"
        )

    def set_rights(self, values, keep=Keep.FILE):
        photos = Photo.objects.filter(id__in=[self.photo.id, self.other.id])
        with (
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            result = edits.set_rights(photos, values, keep, self.user)
        return result, enqueue

    def test_a_file_value_is_kept_by_default(self):
        result, enqueue = self.set_rights(
            {"copyright": "(c) {year} Anna", "license": "cc-by-nc-4.0"}
        )

        self.assertEqual((1, 1), (result.count, result.kept))
        self.assertEqual("(c) 2019 Anna", self.metadata().copyright)
        self.assertEqual("cc-by-nc-4.0", self.metadata().license)
        self.assertEqual("(c) Studio Nord", self.metadata(self.other).copyright)
        enqueue.assert_called_once_with(
            write_photo_fields, [self.photo.id], "rights", True
        )

    def test_keep_none_replaces_every_value(self):
        result, _ = self.set_rights({"license": "cc0-1.0"}, keep=Keep.NONE)

        self.assertEqual((2, 0), (result.count, result.kept))
        self.assertEqual("cc0-1.0", self.metadata(self.other).license)
        self.assertEqual(2, MetadataEdit.objects.filter(field_name="license").count())

    def test_keep_file_replaces_a_value_set_in_librephotos(self):
        create_test_metadata_edit(self.other, "license")
        result, _ = self.set_rights({"license": "cc-by-4.0"})

        self.assertEqual(0, result.kept)
        self.assertEqual("cc-by-4.0", self.metadata(self.other).license)

    def test_keep_any_only_fills_empty_fields(self):
        create_test_metadata_edit(self.other, "license")
        result, _ = self.set_rights(
            {"license": "cc-by-4.0", "creator": "Anna"}, keep=Keep.ANY
        )

        self.assertEqual((2, 1), (result.count, result.kept))
        other = self.metadata(self.other)
        self.assertEqual(("cc-by-sa-4.0", "Anna"), (other.license, other.creator))

    def test_the_year_of_a_photo_without_a_date_is_when_it_was_added(self):
        self.set_rights({"copyright": "{year}"}, keep=Keep.NONE)
        self.assertEqual(
            str(self.other.added_on.year), self.metadata(self.other).copyright
        )

    def test_null_clears(self):
        self.set_rights({"copyright": None}, keep=Keep.NONE)
        self.assertIsNone(self.metadata(self.other).copyright)

    def test_nothing_changed_writes_nothing(self):
        self.set_rights({"license": "cc-by-4.0"}, keep=Keep.NONE)
        result, enqueue = self.set_rights({"license": "cc-by-4.0"}, keep=Keep.NONE)
        self.assertEqual(0, result.count)
        enqueue.assert_not_called()

    def test_a_photo_without_metadata_gets_a_row(self):
        PhotoMetadata.objects.filter(photo=self.photo).delete()
        self.set_rights({"license": "cc-by-4.0"})
        self.assertEqual("cc-by-4.0", self.metadata().license)

    def test_unknown_values_are_refused(self):
        photos = Photo.objects.filter(id=self.photo.id)
        with self.assertRaises(ValueError):
            edits.set_rights(photos, {"license": "mit"}, Keep.FILE, self.user)
        with self.assertRaises(ValueError):
            edits.set_rights(photos, {"title": "x"}, Keep.FILE, self.user)


class RightsDefaultTest(RightsEditTestCase):
    def setUp(self):
        super().setUp()
        self.user.default_license = "cc-by-4.0"
        self.user.default_copyright = "(c) {year} Anna"
        self.user.save()

    def test_apply_fills_what_is_missing(self):
        PhotoMetadata.objects.filter(photo=self.photo).update(copyright="(c) Mine")
        with patch("api.metadata.jobs.enqueue_task"):
            result = edits.apply_rights_default(
                Photo.objects.filter(id=self.photo.id), Keep.ANY, self.user
            )
        self.assertEqual((1, 1), (result.count, result.kept))
        metadata = self.metadata()
        self.assertEqual(
            ("(c) Mine", "cc-by-4.0"), (metadata.copyright, metadata.license)
        )

    def test_apply_without_a_default_does_nothing(self):
        user = create_test_user()
        result = edits.apply_rights_default(Photo.objects.all(), Keep.NONE, user)
        self.assertEqual((0, 0), (result.count, result.kept))

    def test_a_scanned_photo_gets_the_default_without_a_write(self):
        with patch("api.metadata.jobs.enqueue_task") as enqueue:
            edits.apply_rights_default_on_scan(self.photo)
        metadata = self.metadata()
        self.assertEqual("(c) 2019 Anna", metadata.copyright)
        self.assertEqual("cc-by-4.0", metadata.license)
        self.assertEqual(
            {"copyright", "license"},
            fields_edited_by_user_of([self.photo.id], ["copyright", "license"])[
                self.photo.id
            ],
        )
        enqueue.assert_not_called()

    def test_a_scanned_photo_of_an_owner_without_a_default(self):
        photo = create_test_photo(owner=create_test_user())
        edits.apply_rights_default_on_scan(photo)
        self.assertFalse(MetadataEdit.objects.filter(photo=photo).exists())


class RightsSummaryTest(RightsEditTestCase):
    def test_common_and_mixed_values(self):
        other = create_test_photo(owner=self.user, width=8)
        PhotoMetadata.objects.filter(photo=self.photo).update(
            license="cc-by-4.0", creator="Anna", copyright=""
        )
        PhotoMetadata.objects.filter(photo=other).update(
            license="cc-by-4.0", creator="Ben", copyright=None
        )
        create_test_metadata_edit(other, "creator")
        third = create_test_photo(owner=self.user)
        PhotoMetadata.objects.filter(photo=third).delete()

        summary = rights_summary(Photo.objects.owned_by(self.user))

        self.assertEqual(3, summary["count"])
        self.assertEqual({"value": None, "mixed": False}, summary["copyright"])
        self.assertEqual({"value": None, "mixed": True}, summary["creator"])
        self.assertEqual({"value": None, "mixed": True}, summary["license"])
        # The first photo's values are its file's; the second's license too.
        self.assertEqual(2, summary["from_file"])

    def test_rights_from_file_leaves_out_edited_fields(self):
        PhotoMetadata.objects.filter(photo=self.photo).update(
            license="cc-by-4.0", creator="Anna"
        )
        create_test_metadata_edit(self.photo, "creator")
        self.assertEqual(["license"], rights_from_file(self.metadata()))

    def test_a_revert_all_makes_the_values_the_files_again(self):
        old = datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC)
        create_test_metadata_edit(self.photo, "license", created_at=old)
        create_test_metadata_edit(
            self.photo, "_all", created_at=old + datetime.timedelta(days=1)
        )
        self.assertEqual({}, fields_edited_by_user_of([self.photo.id], ["license"]))


class RightsApiTest(RightsEditTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def post(self, url, body):
        with patch("api.metadata.jobs.enqueue_task"):
            return self.client.post(url, body, format="json")

    def test_the_metadata_shows_the_license_and_its_deed(self):
        PhotoMetadata.objects.filter(photo=self.photo).update(license="cc-by-sa-4.0")
        response = self.client.get(f"/api/photos/{self.photo.pk}/metadata/")
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual("cc-by-sa-4.0", body["license"])
        self.assertEqual(LICENSE_URLS[PhotoLicense.CC_BY_SA], body["license_url"])
        self.assertEqual(["license"], body["rights_from_file"])

    def test_patching_a_license(self):
        with patch("api.metadata.jobs.enqueue_task"):
            response = self.client.patch(
                f"/api/photos/{self.photo.pk}/metadata/",
                {"license": "cc0-1.0", "creator": "Anna"},
                format="json",
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual("cc0-1.0", response.json()["license"])
        self.assertEqual([], response.json()["rights_from_file"])

    def test_patching_an_unknown_license_is_a_400(self):
        response = self.client.patch(
            f"/api/photos/{self.photo.pk}/metadata/",
            {"license": "https://evil.example/"},
            format="json",
        )
        self.assertEqual(400, response.status_code)

    def test_set_rights(self):
        response = self.post(
            "/api/photos/rights/",
            {"image_hashes": [self.photo.image_hash], "license": "cc-by-4.0"},
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual({"count": 1, "kept": 0}, response.json())
        self.assertEqual("cc-by-4.0", self.metadata().license)

    def test_set_rights_needs_a_field(self):
        response = self.post(
            "/api/photos/rights/", {"image_hashes": [self.photo.image_hash]}
        )
        self.assertEqual(400, response.status_code)

    def test_set_rights_refuses_an_unknown_keep(self):
        response = self.post(
            "/api/photos/rights/",
            {"image_hashes": [self.photo.image_hash], "creator": "A", "keep": "x"},
        )
        self.assertEqual(400, response.status_code)

    def test_the_summary(self):
        response = self.post(
            "/api/photos/rights-summary/", {"image_hashes": [self.photo.image_hash]}
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, response.json()["count"])

    def test_apply_the_default(self):
        self.client.patch(
            f"/api/user/{self.user.pk}/",
            {"default_license": "cc-by-nc-4.0", "default_creator": "Anna"},
            format="json",
        )
        self.user.refresh_from_db()
        self.assertEqual("cc-by-nc-4.0", self.user.default_license)

        counts = self.client.get("/api/photos/rights/apply-default/").json()
        self.assertEqual({"total": 1, "missing": 1}, counts)

        response = self.post("/api/photos/rights/apply-default/", {})
        self.assertEqual({"count": 1, "kept": 0}, response.json())
        self.assertEqual("cc-by-nc-4.0", self.metadata().license)
        counts = self.client.get("/api/photos/rights/apply-default/").json()
        self.assertEqual({"total": 1, "missing": 0}, counts)

    def test_without_a_default_nothing_is_missing(self):
        counts = self.client.get("/api/photos/rights/apply-default/").json()
        self.assertEqual({"total": 1, "missing": 0}, counts)

    def test_an_unknown_default_license_is_a_400(self):
        response = self.client.patch(
            f"/api/user/{self.user.pk}/", {"default_license": "mit"}, format="json"
        )
        self.assertEqual(400, response.status_code)
