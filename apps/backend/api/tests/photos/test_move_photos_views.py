"""``POST /api/photos/move/``, its preview and the folder listing (#352)."""

import os
from typing import Any
from unittest.mock import patch
from urllib.parse import urlencode

from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.infra.test_declared_action_responses import queue_stub
from api.tests.openapi_responses import openapi_mismatches
from api.tests.photos.move_fixtures import LibraryTestCase
from api.tests.utils import create_test_job, create_test_photo, create_test_user

MOVE = "/api/photos/move/"
PREVIEW = "/api/photos/move/preview/"
FOLDERS = "/api/photos/move/folders/"


class MoveViewTestCase(LibraryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def call(
        self, url: str, status: int, data: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """POST ``data`` (GET without it) and check the answer against the schema."""
        if data is None:
            response = self.client.get(url)
        else:
            response = self.client.post(url, data, format="json")
        self.assertEqual(status, response.status_code, response.content[:400])
        body = response.json()
        if status < 400:
            path, _, _ = url.partition("?")
            method = "get" if data is None else "post"
            self.assertEqual([], openapi_mismatches(path, method, status, body))
        return body

    def code(self, body: dict[str, Any]) -> str:
        return body["errors"][0]["code"]


class MovePhotosViewTest(MoveViewTestCase):
    def test_moves_the_photos_in_the_request(self) -> None:
        photo = self.photo()
        body = self.call(
            MOVE,
            200,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        self.assertEqual(
            {
                "target_folder": self.target,
                "moved": 1,
                "skipped": 0,
                "unchanged": 0,
                "refused": 0,
                "failed": 0,
            },
            body,
        )
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.target))

    def test_the_folder_views_follow_the_move(self) -> None:
        photo = self.photo()
        self.call(
            MOVE,
            200,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        listing = self.client.get(
            f"/api/folders/subfolders/?{urlencode({'path': self.root})}"
        ).json()
        self.assertEqual(
            [("b", 1)], [(f["name"], f["photo_count"]) for f in listing["results"]]
        )

    def test_a_taken_name_is_a_409_until_the_client_chooses(self) -> None:
        photo = self.photo()
        self.write(os.path.join(self.target, "IMG_1.jpg"))
        data = {"image_hashes": [photo.image_hash], "target_folder": self.target}

        conflict = self.call(MOVE, 409, data)
        self.assertEqual("name_conflict", self.code(conflict))
        self.assertIn("IMG_1.jpg", conflict["errors"][0]["message"])
        self.assertEqual("1", conflict["errors"][0]["count"])
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))

        skipped = self.call(MOVE, 200, {**data, "on_conflict": "skip"})
        self.assertEqual(1, skipped["skipped"])
        renamed = self.call(MOVE, 200, {**data, "on_conflict": "rename"})
        self.assertEqual(1, renamed["moved"])
        self.assertIn("IMG_1 (1).jpg", os.listdir(self.target))

    def test_the_409_lists_the_first_names(self) -> None:
        photos = [self.photo(f"IMG_{n}.jpg") for n in range(12)]
        for n in range(12):
            self.write(os.path.join(self.target, f"IMG_{n}.jpg"))
        body = self.call(
            MOVE,
            409,
            {
                "image_hashes": [p.image_hash for p in photos],
                "target_folder": self.target,
            },
        )
        self.assertIn("and 2 more", body["errors"][0]["message"])

    def test_a_large_selection_goes_to_a_job(self) -> None:
        photos = [self.photo(), self.photo("IMG_2.jpg")]
        with patch("api.photos.moves.SYNC_MOVE_LIMIT", 1), queue_stub():
            body = self.call(
                MOVE,
                202,
                {
                    "image_hashes": [p.image_hash for p in photos],
                    "target_folder": self.target,
                },
            )
        job = LongRunningJob.objects.get(job_id=body["job_id"])
        self.assertEqual(LongRunningJob.JOB_MOVE_PHOTOS, job.job_type)
        self.assertEqual(2, len(os.listdir(self.source)))

    def test_too_many_photos(self) -> None:
        photos = [self.photo(), self.photo("IMG_2.jpg")]
        with patch("api.photos.moves.MOVE_LIMIT", 1):
            body = self.call(
                MOVE,
                400,
                {"select_all": True, "query": {}, "target_folder": self.target},
            )
        self.assertEqual("too_many_photos", self.code(body))
        self.assertEqual(2, len(photos))

    def test_a_target_outside_the_library(self) -> None:
        photo = self.photo()
        body = self.call(
            MOVE,
            400,
            {
                "image_hashes": [photo.image_hash],
                "target_folder": os.path.join(self.root, "..", "x"),
            },
        )
        self.assertEqual("outside_library", self.code(body))
        self.assertEqual("target_folder", body["errors"][0]["field"])

    def test_a_running_scan_blocks_the_move(self) -> None:
        photo = self.photo()
        create_test_job(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        body = self.call(
            MOVE,
            409,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        self.assertEqual("scan_running", self.code(body))

    def test_another_users_photo_does_not_move(self) -> None:
        theirs = create_test_photo(owner=create_test_user())
        assert theirs.main_file is not None
        body = self.call(
            MOVE,
            200,
            {"image_hashes": [theirs.image_hash], "target_folder": self.target},
        )
        self.assertEqual(0, body["moved"])
        self.assertTrue(os.path.isfile(theirs.main_file.path))

    def test_bad_input(self) -> None:
        for data in (
            {"image_hashes": []},
            {
                "image_hashes": [],
                "target_folder": self.target,
                "on_conflict": "overwrite",
            },
        ):
            with self.subTest(data=data):
                self.call(MOVE, 400, data)


class MovePreviewViewTest(MoveViewTestCase):
    def test_the_preview_changes_nothing(self) -> None:
        photo = self.photo()
        self.write(os.path.join(self.target, "IMG_1.jpg"))
        body = self.call(
            PREVIEW,
            200,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        self.assertEqual((1, 1), (body["photos"], body["files"]))
        self.assertEqual(
            [
                {
                    "photo_id": str(photo.pk),
                    "name": "IMG_1.jpg",
                    "renamed_to": "IMG_1 (1).jpg",
                }
            ],
            body["clashes"],
        )
        self.assertEqual([], body["refused"])
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))

    def test_refused_photos_are_counted_by_reason(self) -> None:
        photo = self.photo()
        assert photo.main_file is not None
        os.remove(photo.main_file.path)
        body = self.call(
            PREVIEW,
            200,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        self.assertEqual([{"reason": "not_on_disk", "photos": 1}], body["refused"])


class MoveFoldersViewTest(MoveViewTestCase):
    def test_the_roots_and_a_folder(self) -> None:
        roots = self.call(FOLDERS, 200)
        self.assertEqual([self.root], [f["path"] for f in roots["folders"]])
        listing = self.call(f"{FOLDERS}?{urlencode({'path': self.root})}", 200)
        self.assertEqual(["a", "b"], [f["name"] for f in listing["folders"]])

    def test_a_path_outside_is_a_400(self) -> None:
        body = self.call(
            f"{FOLDERS}?{urlencode({'path': os.path.dirname(self.root)})}", 400
        )
        self.assertEqual(
            ("path", "outside_library"), (body["errors"][0]["field"], self.code(body))
        )
