"""Moving a selection into folders by capture date: plan, preview, move, job, API (#2774)."""

import datetime
import os
from typing import Any
from unittest.mock import patch

from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.photos import moves
from api.tests.openapi_responses import openapi_mismatches
from api.tests.photos.move_fixtures import LibraryTestCase
from api.tests.utils import create_test_job

MOVE = "/api/photos/move/"
PREVIEW = "/api/photos/move/preview/"
JUNE = datetime.datetime(2025, 6, 1, 23, 30, 0)
JULY = datetime.datetime(2025, 7, 2, 8, 0, 0)


def skips_june(path: str, skip_list: list[str] | None = None) -> bool:
    """A ``SKIP_PATTERNS`` that matches the June folder."""
    return path.endswith(os.path.join("2025", "06"))


class DatedMoveTestCase(LibraryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.sorted = self.folder("sorted")
        self.june = os.path.join(self.sorted, "2025", "06")
        self.july = os.path.join(self.sorted, "2025", "07")


class PlanMoveTest(DatedMoveTestCase):
    def test_without_a_pattern_one_folder(self) -> None:
        photo = self.photo()
        plan = moves.plan_move(self.user, self.target, [photo])
        self.assertEqual({self.target: [photo]}, plan.targets)

    def test_photos_are_grouped_by_their_date(self) -> None:
        june = self.photo(taken=JUNE)
        july = self.photo("IMG_2.jpg", taken=JULY)
        undated = self.photo("IMG_3.jpg")

        plan = moves.plan_move(
            self.user, self.sorted, [july, june, undated], "{year}/{month}"
        )

        self.assertEqual({self.june: [june], self.july: [july]}, plan.targets)
        self.assertEqual((1, 2), (plan.undated, plan.photo_count))

    def test_a_pattern_into_a_folder_the_scan_skips(self) -> None:
        photo = self.photo(taken=JUNE)
        with (
            patch("api.photos.moves.should_skip", side_effect=skips_june),
            self.assertRaises(moves.InvalidTargetError) as caught,
        ):
            moves.plan_move(self.user, self.sorted, [photo], "{year}/{month}")
        self.assertEqual("hidden_folder", caught.exception.code)


class DatedPreviewAndMoveTest(DatedMoveTestCase):
    def test_the_preview_lists_each_folder(self) -> None:
        june = self.photo(taken=JUNE)
        june_too = self.photo("IMG_2.jpg", folder=self.folder("c"), taken=JUNE)
        already = self.photo(
            "IMG_3.jpg", folder=self.folder("sorted", "2025", "07"), taken=JULY
        )
        undated = self.photo("IMG_4.jpg")
        plan = moves.plan_move(
            self.user, self.sorted, [june, june_too, already, undated], "{year}/{month}"
        )

        preview = moves.preview_move(plan, dated=True)

        self.assertEqual(
            (2, 1, 1), (preview.photos, preview.unchanged, preview.undated)
        )
        self.assertEqual(
            [
                moves.FolderCount(self.june, 2, 0, 0, True),
                moves.FolderCount(self.july, 0, 1, 0, False),
            ],
            preview.folders,
        )
        self.assertFalse(os.path.exists(self.june))

    def test_a_clash_is_counted_in_its_folder(self) -> None:
        june = self.photo(taken=JUNE)
        self.write(os.path.join(self.folder("sorted", "2025", "06"), "IMG_1.jpg"))
        plan = moves.plan_move(self.user, self.sorted, [june], "{year}/{month}")
        preview = moves.preview_move(plan, dated=True)
        self.assertEqual(1, preview.folders[0].clashes)
        self.assertEqual("IMG_1 (1).jpg", preview.clashes[0].renamed_to)

    def test_the_move_makes_the_folders(self) -> None:
        june = self.photo(taken=JUNE)
        july = self.photo("IMG_2.jpg", taken=JULY)
        undated = self.photo("IMG_3.jpg")
        plan = moves.plan_move(
            self.user, self.sorted, [june, july, undated], "{year}/{month}"
        )

        result = moves.move_photos(plan, "skip")

        self.assertEqual((2, 1), (result.moved, result.undated))
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.june))
        self.assertEqual(["IMG_2.jpg"], os.listdir(self.july))
        self.assertEqual(["IMG_3.jpg"], os.listdir(self.source))


class DatedMoveJobTest(DatedMoveTestCase):
    def test_the_job_sorts_and_counts_the_undated(self) -> None:
        june = self.photo(taken=JUNE)
        undated = self.photo("IMG_3.jpg")
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)

        moves.move_photos_job(
            self.user,
            [june.pk, undated.pk],
            moves.Destination(self.sorted, "{year}/{month}"),
            "skip",
            job.job_id,
        )

        job.refresh_from_db()
        self.assertEqual((1, 1), (job.result["moved"], job.result["undated"]))
        self.assertEqual(1, job.progress_target)
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.june))

    def test_an_invalid_pattern_fails_the_job(self) -> None:
        photo = self.photo(taken=JUNE)
        job = create_test_job(self.user, LongRunningJob.JOB_MOVE_PHOTOS)
        moves.move_photos_job(
            self.user,
            [photo.pk],
            moves.Destination(self.sorted, "../{year}"),
            "skip",
            job.job_id,
        )
        job.refresh_from_db()
        self.assertTrue(job.failed)
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))


class DatedMoveViewTest(DatedMoveTestCase):
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

    def data(self, *photos: Any, pattern: str = "{year}/{month}") -> dict[str, Any]:
        return {
            "image_hashes": [photo.image_hash for photo in photos],
            "target_folder": self.sorted,
            "folder_pattern": pattern,
        }

    def test_the_preview_lists_the_folders(self) -> None:
        june = self.photo(taken=JUNE)
        undated = self.photo("IMG_3.jpg")
        body = self.call(PREVIEW, 200, self.data(june, undated))
        self.assertEqual(1, body["undated"])
        self.assertEqual([undated.image_hash], body["undated_hashes"])
        self.assertEqual(
            [
                {
                    "path": self.june,
                    "photos": 1,
                    "unchanged": 0,
                    "clashes": 0,
                    "new": True,
                }
            ],
            body["folders"],
        )

    def test_without_a_pattern_no_folders(self) -> None:
        photo = self.photo(taken=JUNE)
        body = self.call(
            PREVIEW,
            200,
            {"image_hashes": [photo.image_hash], "target_folder": self.target},
        )
        self.assertEqual(([], 0), (body["folders"], body["undated"]))

    def test_an_empty_pattern_is_one_folder(self) -> None:
        photo = self.photo(taken=JUNE)
        body = self.call(MOVE, 200, self.data(photo, pattern=""))
        self.assertEqual(1, body["moved"])
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.sorted))

    def test_the_move(self) -> None:
        june = self.photo(taken=JUNE)
        july = self.photo("IMG_2.jpg", taken=JULY)
        body = self.call(MOVE, 200, self.data(june, july))
        self.assertEqual((2, 0), (body["moved"], body["undated"]))
        self.assertEqual(["IMG_2.jpg"], os.listdir(self.july))

    def test_an_invalid_pattern_is_a_400(self) -> None:
        photo = self.photo(taken=JUNE)
        for pattern in ("../{year}", "/{year}", "{year}/..", "{name}", "{year}\\x"):
            with self.subTest(pattern=pattern):
                body = self.call(MOVE, 400, self.data(photo, pattern=pattern))
                error = body["errors"][0]
                self.assertEqual(
                    ("folder_pattern", "invalid_pattern"),
                    (error["field"], error["code"]),
                )
        self.assertEqual(["IMG_1.jpg"], os.listdir(self.source))

    def test_a_skipped_folder_is_a_400(self) -> None:
        photo = self.photo(taken=JUNE)
        with patch("api.photos.moves.should_skip", side_effect=skips_june):
            body = self.call(PREVIEW, 400, self.data(photo))
        error = body["errors"][0]
        self.assertEqual(
            ("folder_pattern", "hidden_folder"), (error["field"], error["code"])
        )

    def test_a_large_selection_goes_to_a_job_with_the_pattern(self) -> None:
        photos = [self.photo(taken=JUNE), self.photo("IMG_2.jpg", taken=JULY)]
        with (
            patch("api.photos.moves.SYNC_MOVE_LIMIT", 1),
            patch("api.jobs.queue.AsyncTask") as task,
            patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
            self.captureOnCommitCallbacks(execute=True),
        ):
            body = self.call(MOVE, 202, self.data(*photos))
        job = LongRunningJob.objects.get(job_id=body["job_id"])
        self.assertEqual(LongRunningJob.JOB_MOVE_PHOTOS, job.job_type)
        self.assertIn("{year}/{month}", str(task.call_args_list))
        self.assertEqual(["IMG_1.jpg", "IMG_2.jpg"], sorted(os.listdir(self.source)))
