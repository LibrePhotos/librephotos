"""Renaming a selection after the capture date: preview, batch, job, API (#2773)."""

import datetime
import os
import uuid
from typing import Any
from unittest.mock import patch

from rest_framework.test import APIClient

from api.models import File, LongRunningJob
from api.photos import renames
from api.photos.files import MoveError
from api.photos.moves import photos_to_move
from api.tests.infra.test_declared_action_responses import queue_stub
from api.tests.openapi_responses import openapi_mismatches
from api.tests.photos.move_fixtures import LibraryTestCase
from api.tests.utils import create_test_job, create_test_photo, create_test_user

RENAME = "/api/photos/rename/"
PREVIEW = "/api/photos/rename/preview/"
PATTERN = "{year}{month}{day}_{hour}{minute}{second}"
JUNE = datetime.datetime(2025, 6, 1, 23, 30, 0)
JULY = datetime.datetime(2025, 7, 2, 8, 0, 0)


class PreviewRenameTest(LibraryTestCase):
    def test_the_preview_counts_and_lists_without_renaming(self) -> None:
        raw = self.file(self.source, "IMG_1.CR2", File.RAW_FILE)
        first = self.photo(variants=(raw,), taken=JUNE)
        same_second = self.photo("IMG_2.jpg", taken=JUNE)
        named = self.photo("20250702_080000.jpg", taken=JULY)
        undated = self.photo("scan_1.png")
        photos = photos_to_move(
            self.user, [first.pk, same_second.pk, named.pk, undated.pk]
        )

        preview = renames.preview_rename(photos, PATTERN)

        self.assertEqual(
            (2, 3, 1, 1, 1),
            (
                preview.photos,
                preview.files,
                preview.unchanged,
                preview.undated,
                preview.numbered,
            ),
        )
        rows = {row.name: row for row in preview.rows}
        self.assertEqual(
            ("20250601_233000.jpg", 1, 0),
            (
                rows["IMG_1.jpg"].new_name,
                rows["IMG_1.jpg"].other_files,
                rows["IMG_1.jpg"].number,
            ),
        )
        self.assertEqual(
            ("20250601_233000 (1).jpg", 1),
            (rows["IMG_2.jpg"].new_name, rows["IMG_2.jpg"].number),
        )
        self.assertEqual("unchanged", rows["20250702_080000.jpg"].status)
        self.assertEqual("undated", rows["scan_1.png"].status)
        self.assertEqual([undated.image_hash], preview.undated_hashes)
        self.assertCountEqual(
            [
                "IMG_1.jpg",
                "IMG_1.CR2",
                "IMG_2.jpg",
                "20250702_080000.jpg",
                "scan_1.png",
            ],
            os.listdir(self.source),
        )

    def test_refused_photos_are_counted_by_reason(self) -> None:
        photo = self.photo(taken=JUNE)
        assert photo.main_file is not None
        os.remove(photo.main_file.path)
        preview = renames.preview_rename([photo], PATTERN)
        self.assertEqual({"not_on_disk": 1}, preview.refused)
        self.assertEqual(
            ("refused", "not_on_disk"), (preview.rows[0].status, preview.rows[0].reason)
        )

    def test_no_free_name_is_counted(self) -> None:
        photo = self.photo(taken=JUNE)
        with patch("api.photos.renames.plan_rename", side_effect=MoveError("full")):
            preview = renames.preview_rename([photo], PATTERN)
        self.assertEqual(1, preview.no_free_name)
        self.assertEqual("no_free_name", preview.rows[0].status)

    def test_only_the_first_rows_are_listed(self) -> None:
        photos = [self.photo(f"IMG_{n}.jpg", taken=JUNE) for n in range(3)]
        with patch("api.photos.renames.PREVIEW_ROWS", 2):
            preview = renames.preview_rename(photos, PATTERN)
        self.assertEqual((3, 2), (preview.photos, len(preview.rows)))


class RenamePhotosTest(LibraryTestCase):
    def test_two_photos_of_one_second(self) -> None:
        first = self.photo(taken=JUNE)
        second = self.photo("IMG_2.jpg", taken=JUNE)
        undated = self.photo("scan_1.png")
        photos = photos_to_move(self.user, [first.pk, second.pk, undated.pk])

        result = renames.rename_photos(photos, PATTERN)

        self.assertEqual(
            {"renamed": 2, "unchanged": 0, "undated": 1, "refused": 0, "failed": 0},
            result.as_dict(),
        )
        self.assertCountEqual(
            ["20250601_233000.jpg", "20250601_233000 (1).jpg", "scan_1.png"],
            os.listdir(self.source),
        )

    def test_each_outcome_is_counted(self) -> None:
        unchanged = self.photo("20250601_233000.jpg", taken=JUNE)
        refused = self.photo("IMG_3.jpg", taken=JUNE)
        assert refused.main_file is not None
        os.remove(refused.main_file.path)
        failing = self.photo("IMG_4.jpg", taken=JULY)
        real = renames.rename_photo_files

        def fail_july(photo: Any, new_stem: str) -> Any:
            if new_stem.startswith("202507"):
                raise MoveError("locked")
            return real(photo, new_stem)

        with patch("api.photos.renames.rename_photo_files", side_effect=fail_july):
            result = renames.rename_photos([unchanged, refused, failing], PATTERN)
        self.assertEqual(
            {"renamed": 0, "unchanged": 1, "undated": 0, "refused": 1, "failed": 1},
            result.as_dict(),
        )
        self.assertIn("IMG_4.jpg", os.listdir(self.source))


class RenameJobTest(LibraryTestCase):
    def test_the_job_renames_and_reports(self) -> None:
        photo = self.photo(taken=JUNE)
        job = create_test_job(self.user, LongRunningJob.JOB_RENAME_PHOTOS)

        renames.rename_photos_job(self.user, [photo.pk], PATTERN, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertEqual(1, job.result["renamed"])
        self.assertEqual((1, 1), (job.progress_current, job.progress_target))
        self.assertEqual(["20250601_233000.jpg"], os.listdir(self.source))

    def test_an_invalid_pattern_fails_the_job(self) -> None:
        job = create_test_job(self.user, LongRunningJob.JOB_RENAME_PHOTOS)
        renames.rename_photos_job(self.user, [uuid.uuid4()], "../x", job.job_id)
        job.refresh_from_db()
        self.assertTrue(job.failed)

    def test_a_cancel_stops_after_the_current_photo(self) -> None:
        first = self.photo(taken=JUNE)
        second = self.photo("IMG_2.jpg", taken=JULY)
        job = create_test_job(self.user, LongRunningJob.JOB_RENAME_PHOTOS)

        def cancel(self_job: LongRunningJob) -> None:
            raise renames.JobCancelledError(self_job.job_id)

        with patch.object(LongRunningJob, "stop_if_cancelled", cancel):
            renames.rename_photos_job(
                self.user, [first.pk, second.pk], PATTERN, job.job_id
            )
        self.assertCountEqual(
            ["20250601_233000.jpg", "IMG_2.jpg"], os.listdir(self.source)
        )

    def test_a_job_cancelled_while_queued_does_nothing(self) -> None:
        photo = self.photo(taken=JUNE)
        job = create_test_job(self.user, LongRunningJob.JOB_RENAME_PHOTOS)
        job.cancel()
        renames.rename_photos_job(self.user, [photo.pk], PATTERN, job.job_id)
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))


class RenameViewTest(LibraryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def call(self, url: str, status: int, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(url, data, format="json")
        self.assertEqual(status, response.status_code, response.content[:400])
        body = response.json()
        if status < 400:
            self.assertEqual([], openapi_mismatches(url, "post", status, body))
        return body

    def test_the_preview(self) -> None:
        photo = self.photo(taken=JUNE)
        body = self.call(
            PREVIEW, 200, {"image_hashes": [photo.image_hash], "pattern": PATTERN}
        )
        self.assertEqual(1, body["photos"])
        self.assertEqual(
            {
                "photo_id": str(photo.pk),
                "image_hash": photo.image_hash,
                "name": "IMG_1.jpg",
                "new_name": "20250601_233000.jpg",
                "other_files": 0,
                "status": "rename",
                "number": 0,
                "reason": None,
            },
            body["rows"][0],
        )
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))

    def test_renames_in_the_request(self) -> None:
        photo = self.photo(taken=JUNE)
        body = self.call(
            RENAME, 200, {"image_hashes": [photo.image_hash], "pattern": PATTERN}
        )
        self.assertEqual(1, body["renamed"])
        self.assertEqual(["20250601_233000.jpg"], os.listdir(self.source))

    def test_an_invalid_pattern_is_a_400(self) -> None:
        photo = self.photo(taken=JUNE)
        for pattern in ("../x", "a/b", "con:", "{nope}"):
            for url in (PREVIEW, RENAME):
                with self.subTest(pattern=pattern, url=url):
                    body = self.call(
                        url,
                        400,
                        {"image_hashes": [photo.image_hash], "pattern": pattern},
                    )
                    error = body["errors"][0]
                    self.assertEqual(
                        ("pattern", "invalid_pattern"), (error["field"], error["code"])
                    )
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))

    def test_a_large_selection_goes_to_a_job(self) -> None:
        photos = [self.photo(taken=JUNE), self.photo("IMG_2.jpg", taken=JUNE)]
        with patch("api.photos.moves.SYNC_MOVE_LIMIT", 1), queue_stub():
            body = self.call(
                RENAME,
                202,
                {"image_hashes": [p.image_hash for p in photos], "pattern": PATTERN},
            )
        job = LongRunningJob.objects.get(job_id=body["job_id"])
        self.assertEqual(LongRunningJob.JOB_RENAME_PHOTOS, job.job_type)
        self.assertCountEqual(["IMG_1.jpg", "IMG_2.jpg"], os.listdir(self.source))

    def test_a_running_scan_blocks_the_rename(self) -> None:
        photo = self.photo(taken=JUNE)
        create_test_job(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        body = self.call(
            RENAME, 409, {"image_hashes": [photo.image_hash], "pattern": PATTERN}
        )
        self.assertEqual("scan_running", body["errors"][0]["code"])

    def test_another_users_photo_is_not_renamed(self) -> None:
        theirs = create_test_photo(
            owner=create_test_user(),
            exif_timestamp=JUNE.replace(tzinfo=datetime.UTC),
        )
        assert theirs.main_file is not None
        body = self.call(
            RENAME, 200, {"image_hashes": [theirs.image_hash], "pattern": PATTERN}
        )
        self.assertEqual(0, body["renamed"])
        self.assertTrue(os.path.isfile(theirs.main_file.path))
        preview = self.call(
            PREVIEW, 200, {"image_hashes": [theirs.image_hash], "pattern": PATTERN}
        )
        self.assertEqual([], preview["rows"])
