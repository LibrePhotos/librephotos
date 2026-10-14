"""The last views that built their answers as dicts answer what openapi.json
declares: event album jobs, folders, geocoding, memories, bulk metadata,
search examples, services, serving diagnostics, upload checks and zip
downloads, plus the file routes (``/media/``), which are binary.

Each test calls a view through every branch of its answer and validates the
body against the committed schema (``api/tests/openapi_responses.py``).
Issue #485.
"""

import datetime
import os
import shutil
import tempfile
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from constance.test import override_config
from django.test import override_settings
from rest_framework.test import APIClient

from api.models import File, LongRunningJob, User
from api.models.album_date import get_or_create_album_date
from api.serving import permissions
from api.tests.infra.test_declared_action_responses import queue_stub
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.openapi_responses import declared_body, declared_schema
from api.tests.utils import (
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_user,
)

UTC = datetime.timezone.utc
BINARY = {"type": "string", "format": "binary"}
NAS_MOUNT: permissions.MountSummary = {
    "point": "/photos",
    "type": "nfs4",
    "options": ["ro", "vers=4.2"],
    "read_only": True,
    "permissions_from_mount": False,
    "network": True,
}


class EventAlbumJobResponsesTest(DeclaredResponseTestCase):
    """Generating event albums and their titles starts a job."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def test_both_jobs_by_post_and_get(self) -> None:
        for path in ("/api/autoalbumgen/", "/api/autoalbumtitlegen/"):
            for method in ("post", "get"):
                with self.subTest(path=path, method=method), queue_stub():
                    data = {} if method == "post" else None
                    body = self.assert_declared(path, path, method=method, data=data)
                    self.assertEqual(body["job_ids"][-1], body["job_id"])
                LongRunningJob.objects.update(finished=True)


class FolderResponsesTest(DeclaredResponseTestCase):
    path = "/api/folders/subfolders/"

    def setUp(self) -> None:
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        settings = override_settings(DATA_ROOT=self.root)
        settings.enable()
        self.addCleanup(settings.disable)
        self.client = APIClient()

    def test_a_user_without_a_scan_directory(self) -> None:
        self.client.force_authenticate(user=create_test_user(scan_directory=""))
        body = self.assert_declared(self.path, self.path)
        self.assertIsNone(body["current_path"])

    def test_a_folder_with_photos(self) -> None:
        library = os.path.join(self.root, "library")
        trips = os.path.join(library, "trips")
        os.makedirs(os.path.join(trips, "2024"))
        os.makedirs(os.path.join(library, "empty"))
        user = create_test_user(scan_directory=library)
        photo = create_test_photo(owner=user)
        photo.files.add(
            create_test_file(
                os.path.join(trips, "2024", "a.jpg"), user, file_type=File.IMAGE
            )
        )
        self.client.force_authenticate(user=user)
        top = self.assert_declared(self.path, self.path)
        nested = self.assert_declared(self.path, f"{self.path}?path={trips}")
        self.assertEqual(["trips"], [entry["name"] for entry in top["results"]])
        self.assertIsNone(top["parent_path"])
        self.assertEqual(library, nested["parent_path"])


class FakeGeocoder:
    def __init__(self, **config: object) -> None:
        pass

    def geocode(self, query: str, exactly_one: bool, limit: int) -> list[Any]:
        return [
            SimpleNamespace(address="Berlin, Germany", latitude=52.52, longitude=13.4)
        ]


class GeocodeResponsesTest(DeclaredResponseTestCase):
    path = "/api/geocode/search/"

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    @override_config(MAP_API_PROVIDER="nominatim")
    def test_places_and_none(self) -> None:
        with (
            patch("api.geocode.geocode.wait_for_provider"),
            patch(
                "api.geocode.geocode.geopy.get_geocoder_for_service",
                return_value=FakeGeocoder,
            ),
        ):
            found = self.assert_declared(self.path, f"{self.path}?q=Berlin")
        empty = self.assert_declared(self.path, self.path)
        self.assertEqual("Berlin, Germany", found[0]["display_name"])
        self.assertEqual([], empty)


class MemoriesResponsesTest(DeclaredResponseTestCase):
    path = "/api/memories/"

    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def add_photo_on(self, day: datetime.date, place: str | None = None) -> None:
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=datetime.datetime(
                day.year, day.month, day.day, 12, tzinfo=UTC
            ),
        )
        album = get_or_create_album_date(date=day, owner=self.user)
        album.photos.add(photo)
        if place is not None:
            album.location = {"places": [place]}
            album.save()

    def test_none_a_day_and_a_month(self) -> None:
        empty = self.assert_declared(self.path, f"{self.path}?date=2026-08-24")
        self.add_photo_on(datetime.date(2024, 8, 23), place="Berlin")
        self.add_photo_on(datetime.date(2023, 8, 24))
        self.add_photo_on(datetime.date(2022, 3, 2))
        days = self.assert_declared(self.path, f"{self.path}?date=2026-08-24")
        month = self.assert_declared(self.path, f"{self.path}?date=2026-03-20")
        self.assertEqual([], empty["results"])
        self.assertEqual(
            ["years_ago", "years_ago"], [m["type"] for m in days["results"]]
        )
        self.assertEqual(["Berlin", ""], [m["location"] for m in days["results"]])
        self.assertEqual(["month_years_ago"], [m["type"] for m in month["results"]])


class BulkMetadataResponsesTest(DeclaredResponseTestCase):
    path = "/api/photos/metadata/bulk/"

    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.described = create_test_photo(
            owner=self.user,
            camera="X100V",
            lens="23mm",
            exif_timestamp=datetime.datetime(2024, 1, 2, tzinfo=UTC),
            exif_gps_lat=1.0,
            exif_gps_lon=2.0,
        )
        self.bare = create_test_photo(owner=self.user)
        self.foreign = create_test_photo(owner=create_test_user())

    def test_summaries_by_id_and_hash(self) -> None:
        ids = f"{self.described.id},{self.bare.image_hash},{self.foreign.id}"
        body = self.assert_declared(self.path, f"{self.path}?photo_ids={ids}")
        self.assertEqual({str(self.described.id), str(self.bare.id)}, set(body))
        self.assertTrue(body[str(self.described.id)]["has_location"])
        self.assertIsNone(body[str(self.bare.id)]["camera"])

    def test_bulk_update(self) -> None:
        body = self.assert_declared(
            self.path,
            self.path,
            method="patch",
            data={"photo_ids": [str(self.bare.id)], "updates": {"rating": 3}},
        )
        self.assertEqual(1, body["updated_count"])


class SearchExamplesResponsesTest(DeclaredResponseTestCase):
    path = "/api/searchtermexamples/"

    def test_an_empty_and_a_filled_library(self) -> None:
        for filled in (False, True):
            user = create_test_user()
            if filled:
                create_test_photo(
                    owner=user,
                    search_location="Berlin",
                    captions_json={"im2txt": "a dog"},
                    exif_timestamp=datetime.datetime(2024, 1, 2, tzinfo=UTC),
                )
            self.client = APIClient()
            self.client.force_authenticate(user=user)
            with self.subTest(filled=filled):
                self.assertTrue(self.assert_declared(self.path, self.path)["results"])


class ServiceResponsesTest(DeclaredResponseTestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    def test_list(self) -> None:
        body = self.assert_declared("/api/services/", "/api/services/")
        self.assertIn("exif", body["services"])

    def test_an_enabled_service_down_and_a_disabled_one(self) -> None:
        path = "/api/services/{id}/"
        with (
            patch("api.views.services.is_healthy", return_value=False),
            patch(
                "api.views.services.port_conflict",
                return_value="port 8010 is used by python (process ID 4)",
            ),
            patch("api.views.services.is_service_enabled", return_value=True),
        ):
            down = self.assert_declared(path, "/api/services/exif/")
        with patch("api.views.services.is_service_enabled", return_value=False):
            off = self.assert_declared(path, "/api/services/image_captioning/")
        self.assertTrue(down["port_conflict"])
        self.assertIsNone(off["port_conflict"])

    def test_start_and_stop(self) -> None:
        with (
            patch("api.views.services.is_service_enabled", return_value=True),
            patch("api.views.services.start_service", return_value=True),
            patch("api.views.services.stop_service", return_value=True),
        ):
            for action in ("start", "stop"):
                with self.subTest(action=action):
                    self.assert_declared(
                        f"/api/services/{{id}}/{action}/",
                        f"/api/services/exif/{action}/",
                        method="post",
                        data={},
                    )


class ServingDiagnosticsResponsesTest(DeclaredResponseTestCase):
    path = "/api/media/diagnostics/{fname}/"

    def setUp(self) -> None:
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        # A NAS mount, whatever the machine running the test has.
        mount = patch.object(permissions, "describe_mount", return_value=NAS_MOUNT)
        mount.start()
        self.addCleanup(mount.stop)

    def diagnose(self, photo: Any) -> Any:
        return self.assert_declared(
            self.path, f"/api/media/diagnostics/{photo.image_hash}/"
        )

    def test_a_photo_without_a_file(self) -> None:
        photo = create_test_photo(owner=self.admin)
        photo.main_file = None
        photo.save()
        self.assertEqual("missing", self.diagnose(photo)["cause"])

    def test_a_missing_file(self) -> None:
        photo = create_test_photo(owner=self.admin)
        photo.main_file.path = os.path.join(self.folder, "gone.jpg")
        photo.main_file.save()
        body = self.diagnose(photo)
        self.assertEqual("missing", body["cause"])
        self.assertEqual({"path", "kind"}, set(body["blocking"]))
        # No mount matches the path.
        with patch.object(permissions, "describe_mount", return_value=None):
            self.assertIsNone(self.diagnose(photo)["mount"])

    def test_a_file_the_mode_bits_close(self) -> None:
        photo = create_test_photo(owner=self.admin)
        stat_result = os.stat(photo.main_file.path)

        def stopped_at(
            path: str, kind: str, uid: int, gid: int, bits: Any
        ) -> tuple[str, Any] | None:
            if kind != "file":
                return None
            return permissions.CAUSE_MODE_BITS, permissions._describe_component(
                path, stat_result, kind
            )

        with patch.object(permissions, "_stopped_at", stopped_at):
            body = self.diagnose(photo)
        self.assertEqual("mode_bits", body["cause"])
        self.assertEqual("nfs4", body["mount"]["type"])


class UploadExistsResponsesTest(DeclaredResponseTestCase):
    def test_a_known_and_an_unknown_hash(self) -> None:
        user = create_test_user()
        photo = create_test_photo(owner=user)
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        for image_hash, exists in ((photo.image_hash, True), ("0" * 33, False)):
            with self.subTest(exists=exists):
                body = self.assert_declared(
                    "/api/exists/{id}/", f"/api/exists/{image_hash}/"
                )
                self.assertEqual(exists, body["exists"])


class ZipDownloadResponsesTest(DeclaredResponseTestCase):
    path = "/api/photos/download/"
    # Without the slash: /api/photos/download/ is a photo's detail route.
    url = "/api/photos/download"

    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_start(self) -> None:
        photo = create_test_photo(owner=self.user)
        with queue_stub():
            body = self.assert_declared(
                self.path,
                self.url,
                method="post",
                data={"image_hashes": [photo.image_hash]},
            )
        self.assertTrue(LongRunningJob.objects.filter(job_id=body["job_id"]).exists())

    def test_every_state_of_the_job(self) -> None:
        states: tuple[tuple[dict[str, Any], int, str], ...] = (
            ({"result": None}, 202, "PENDING"),
            ({"result": {"progress": {"current": 1, "target": 3}}}, 202, "PENDING"),
            ({"finished": True}, 200, "SUCCESS"),
            (
                {"finished": True, "failed": True, "result": {"error": "x"}},
                200,
                "FAILURE",
            ),
            ({"finished": True, "cancelled": True}, 200, "FAILURE"),
        )
        for fields, status, expected in states:
            job = create_test_job(
                self.user, job_type=LongRunningJob.JOB_DOWNLOAD_PHOTOS, **fields
            )
            with self.subTest(expected=expected, fields=fields):
                body = self.assert_declared(
                    self.path, f"{self.url}?job_id={job.job_id}", status=status
                )
                self.assertEqual(expected, body["status"])

    def test_delete_answers_no_body(self) -> None:
        with patch("api.views.zip_downloads.delete_zip_file"):
            response = self.client.delete(
                "/api/delete/zip/0c8a6ffd-5f3a-4c2a-8a42-6a5f3f0b8a1e/"
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual(b"", response.content)
        self.assertFalse(declared_body("/api/delete/zip/{fname}/", "delete", 200))


class MediaFileResponsesTest(DeclaredResponseTestCase):
    def test_media_is_a_file(self) -> None:
        user = create_test_user()
        photo = create_test_photo(owner=user)
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        response = self.client.get(f"/media/thumbnails_big/{photo.image_hash}")
        self.assertEqual(200, response.status_code)
        for status in (200, 206):
            with self.subTest(status=status):
                self.assertEqual(
                    BINARY,
                    declared_schema("/media/{path}/{fname}", "get", status, "*/*"),
                )


class PhotoDateResponsesTest(DeclaredResponseTestCase):
    """Shifting or setting the date of selected photos, and its preview (#2278)."""

    def setUp(self) -> None:
        self.user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        taken = datetime.datetime(2024, 5, 1, 9, tzinfo=UTC)
        self.dated = create_test_photo(owner=self.user, exif_timestamp=taken)
        self.undated = create_test_photo(owner=self.user, exif_timestamp=None)

    def hashes(self, *photos: Any) -> list[str]:
        return [photo.image_hash for photo in photos]

    def test_the_summary_with_and_without_dates(self) -> None:
        path = "/api/photos/date-summary/"
        for photos in ((self.undated,), (self.dated, self.undated)):
            with self.subTest(dated=len(photos) - 1):
                body = self.assert_declared(
                    path,
                    path,
                    method="post",
                    data={"image_hashes": self.hashes(*photos)},
                )
                self.assertEqual(len(photos) == 1, body["oldest"] is None)

    def test_shift_and_set(self) -> None:
        path = "/api/photosedit/datetime/"
        changes = (
            {"mode": "shift", "seconds": -3600},
            {"mode": "set", "datetime": "2025-10-11T10:18:00"},
        )
        for change in changes:
            with self.subTest(mode=change["mode"]):
                body = self.assert_declared(
                    path,
                    path,
                    method="post",
                    data={
                        "image_hashes": self.hashes(self.dated, self.undated),
                        **change,
                    },
                )
                self.assertGreaterEqual(body["count"], 1)
