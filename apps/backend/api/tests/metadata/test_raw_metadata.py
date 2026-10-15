"""``GET /api/photos/<photo_id>/metadata/raw/``: every tag, for the owner only (#2277).

``RawMetadataViewTest`` reads real files with real ExifTool through the exif
service's route; the reader and path-label tests need neither.
"""

import os
from types import SimpleNamespace
from unittest.mock import patch

import requests
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata import reader
from api.metadata.reader import MetadataFileMissingError, MetadataReadError, all_tags
from api.photos.paths import path_label
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_photo, create_test_user


def url_of(photo_id: object) -> str:
    return f"/api/photos/{photo_id}/metadata/raw/"


class RawMetadataViewTest(RealExifToolTestCase):
    def setUp(self):
        super().setUp()
        self.owner = create_test_user(scan_directory=self.library)
        self.path = self.make_image(name="IMG_1")
        self.tag(self.path, "-IFD0:Make=Fujifilm")
        self.photo = self.photo_for(self.path, self.owner)
        self.folder = os.path.basename(self.directory)

    def get(self, user, photo_id=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        return client.get(url_of(photo_id or self.photo.id))

    def add_sidecar(self, name: str, *tags: str) -> str:
        sidecar = os.path.join(self.directory, name)
        self.tag(sidecar, *tags)
        return sidecar

    def test_the_owner_gets_the_media_file_and_each_sidecar_grouped(self):
        self.add_sidecar("IMG_1.jpg.xmp", "-XMP-xmp:Rating=4")

        response = self.get(self.owner)

        self.assertEqual(response.status_code, 200, response.content[:300])
        media, sidecar = response.json()["files"]
        self.assertEqual(media["kind"], "media")
        self.assertEqual(media["path_label"], f"{self.folder}/IMG_1.jpg")
        media_groups = {group["name"]: group for group in media["groups"]}
        self.assertEqual(media_groups["IFD0"]["family"], "EXIF")
        self.assertEqual(media_groups["IFD0"]["tags"]["Make"], "Fujifilm")
        self.assertEqual(sidecar["kind"], "sidecar")
        self.assertEqual(sidecar["path_label"], f"{self.folder}/IMG_1.jpg.xmp")
        sidecar_groups = {group["name"]: group for group in sidecar["groups"]}
        self.assertEqual(sidecar_groups["XMP-xmp"]["tags"]["Rating"], "4")
        # No absolute server path anywhere in the answer.
        self.assertNotIn(self.library, response.content.decode())
        self.assertNotIn("System", media_groups)

    def test_sidecars_come_highest_priority_first(self):
        # IMG_1.xmp is read first, so its values win; it is listed first.
        self.add_sidecar("IMG_1.jpg.xmp", "-XMP-xmp:Rating=2")
        self.add_sidecar("IMG_1.xmp", "-XMP-xmp:Rating=5")

        files = self.get(self.owner).json()["files"]

        self.assertEqual(
            [file["path_label"] for file in files],
            [
                f"{self.folder}/IMG_1.jpg",
                f"{self.folder}/IMG_1.xmp",
                f"{self.folder}/IMG_1.jpg.xmp",
            ],
        )

    def test_a_file_outside_the_library_folder_shows_its_name_only(self):
        self.owner.scan_directory = os.path.join(self.library, "elsewhere")
        self.owner.save()

        files = self.get(self.owner).json()["files"]

        self.assertEqual(files[0]["path_label"], "IMG_1.jpg")

    def test_another_user_gets_a_404(self):
        response = self.get(create_test_user())
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("Fujifilm", response.content.decode())

    def test_an_admin_who_does_not_own_the_photo_gets_a_404(self):
        response = self.get(create_test_user(is_admin=True))
        self.assertEqual(response.status_code, 404)

    def test_someone_the_photo_is_shared_with_gets_a_404(self):
        friend = create_test_user()
        self.photo.shared_to.add(friend)
        self.assertEqual(self.get(friend).status_code, 404)

    def test_an_anonymous_request_gets_a_401(self):
        self.assertEqual(self.get(None).status_code, 401)

    def test_an_unknown_photo_is_a_404(self):
        response = self.get(self.owner, "00000000-0000-4000-8000-000000000000")
        self.assertEqual(response.status_code, 404)

    def test_a_missing_file_is_a_404_with_a_message(self):
        os.remove(self.path)

        response = self.get(self.owner)

        self.assertEqual(response.status_code, 404)
        (error,) = response.json()["errors"]
        self.assertEqual(error["code"], "file_missing")
        self.assertIn("not on disk", error["message"])

    def test_a_photo_without_a_main_file_is_a_404(self):
        photo = create_test_photo(owner=self.owner)
        photo.main_file = None
        photo.save()
        response = self.get(self.owner, photo.id)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["errors"][0]["code"], "file_missing")

    def test_a_sidecar_that_vanishes_before_the_read_is_left_out(self):
        sidecar = self.add_sidecar("IMG_1.jpg.xmp", "-XMP-xmp:Rating=4")
        listed = [sidecar]
        os.remove(sidecar)

        with patch("api.metadata.raw.sidecar_files_for_photo", return_value=listed):
            files = self.get(self.owner).json()["files"]

        self.assertEqual([file["kind"] for file in files], ["media"])

    def test_a_file_that_vanishes_during_the_read_is_a_404(self):
        with patch(
            "api.metadata.raw.all_tags", side_effect=MetadataFileMissingError("gone")
        ):
            response = self.get(self.owner)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["errors"][0]["code"], "file_missing")

    def test_an_exiftool_failure_is_a_502(self):
        with patch("api.metadata.raw.all_tags", side_effect=MetadataReadError("boom")):
            response = self.get(self.owner)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["errors"][0]["code"], "exiftool_failed")


class PhotoDetailTest(TestCase):
    def test_the_photo_detail_no_longer_carries_exif_json(self):
        owner = create_test_user()
        photo = create_test_photo(owner=owner)
        client = APIClient()
        client.force_authenticate(user=owner)
        response = client.get(f"/api/photos/{photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("exif_json", response.json())


def _http_error(status: int, body: bytes = b"") -> requests.HTTPError:
    answer = requests.Response()
    answer.status_code = status
    answer._content = body
    return requests.HTTPError(f"{status}", response=answer)


class AllTagsClientTest(SimpleTestCase):
    def call(self, post):
        transport = SimpleNamespace(
            post=post, error_detail=reader.sidecars.error_detail
        )
        with patch("api.metadata.reader.sidecars", transport):
            return all_tags("/library/IMG_1.jpg")

    def test_returns_the_groups(self):
        groups = [{"name": "IFD0", "family": "EXIF", "tags": {"Make": "Canon"}}]
        calls = []

        def post(service, path, *, json, timeout):
            calls.append((service, path, json))
            return SimpleNamespace(json=lambda: {"groups": groups})

        self.assertEqual(self.call(post), groups)
        self.assertEqual(calls, [("exif", "/all-tags", {"path": "/library/IMG_1.jpg"})])

    def test_a_404_means_the_file_is_missing(self):
        def post(*args, **kwargs):
            raise _http_error(404, b'{"error": "file not found"}')

        with self.assertRaises(MetadataFileMissingError):
            self.call(post)

    def test_another_failure_carries_the_services_reason(self):
        def post(*args, **kwargs):
            raise _http_error(500, b'{"error": "ExifTool died"}')

        with self.assertRaises(MetadataReadError) as raised:
            self.call(post)
        self.assertNotIsInstance(raised.exception, MetadataFileMissingError)
        self.assertIn("ExifTool died", str(raised.exception))

    def test_an_unreachable_service_is_a_read_error(self):
        def post(*args, **kwargs):
            raise requests.ConnectionError("refused")

        with self.assertRaises(MetadataReadError):
            self.call(post)

    def test_an_answer_without_groups_is_a_read_error(self):
        for body in ({}, {"groups": "x"}, {"groups": [1]}):
            with self.subTest(body=body), self.assertRaises(MetadataReadError):
                self.call(lambda *a, body=body, **k: SimpleNamespace(json=lambda: body))


class PathLabelTest(SimpleTestCase):
    def test_a_file_inside_the_root_is_shown_below_it(self):
        root = os.path.abspath(os.path.join(os.sep, "data", "alice"))
        path = os.path.join(root, "2024", "IMG_1.jpg")
        self.assertEqual(path_label(path, root), "2024/IMG_1.jpg")

    def test_a_file_outside_the_root_or_without_one_shows_its_name(self):
        root = os.path.abspath(os.path.join(os.sep, "data", "alice"))
        sibling = os.path.abspath(os.path.join(os.sep, "data", "alice2", "IMG_1.jpg"))
        self.assertEqual(path_label(sibling, root), "IMG_1.jpg")
        self.assertEqual(path_label(sibling, None), "IMG_1.jpg")
        self.assertEqual(path_label(sibling, ""), "IMG_1.jpg")

    def test_the_root_itself_shows_its_name(self):
        root = os.path.abspath(os.path.join(os.sep, "data", "alice"))
        self.assertEqual(path_label(root, root), "alice")
