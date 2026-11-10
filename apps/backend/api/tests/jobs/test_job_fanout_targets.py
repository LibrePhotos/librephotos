"""A fan-out job's target is exactly the work it queues or walks.

The jobs used to count their selection with one query and then queue (or
walk) it with another. The selections are need-based (no things yet, not
scanned for faces, not probed), and other writers change them in between:
a job short of its target stayed running until the stuck-job cleanup failed
it a day later, blocking the user's next start; a job past it finished, and
fired its follow-ups, before its work was done. Each test plays the other
writer at the moment between the two reads (``db.connections.close_all``,
which every one of these jobs calls there).
"""

import uuid
from collections.abc import Callable
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import processing_jobs
from api.models import LongRunningJob, Photo
from api.models.photo_caption import PhotoCaption
from api.search.semantic import OPENCLIP
from api.tests.utils import create_test_photo, create_test_user
from api.video import color, transcode_cache


def meanwhile(writer: Callable[[], None]) -> object:
    """Run ``writer`` once, where the job closes its connections before the work."""
    calls = []

    def close_all() -> None:
        if not calls:
            calls.append(True)
            writer()

    return patch.object(processing_jobs.db.connections, "close_all", close_all)


def tag(photo: Photo) -> None:
    PhotoCaption.objects.update_or_create(
        photo=photo, defaults={"captions_json": {OPENCLIP: {"tags": []}}}
    )


class QueuedFanOutTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())

    def job(self) -> LongRunningJob:
        return LongRunningJob.objects.get(job_id=self.job_id)

    def run_generate_tags(self, writer: Callable[[], None]) -> list[object]:
        with (
            meanwhile(writer),
            patch.object(processing_jobs, "enqueue_task") as enqueue,
        ):
            processing_jobs.generate_tags(self.user, self.job_id)
        return [call.args[1] for call in enqueue.call_args_list]

    def test_a_photo_tagged_meanwhile_is_still_queued_and_counted(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(3)]

        queued = self.run_generate_tags(lambda: tag(photos[0]))

        self.assertEqual(self.job().progress_target, len(queued))
        self.assertEqual(set(queued), {photo.pk for photo in photos})

    def test_a_photo_added_meanwhile_waits_for_the_next_run(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]

        queued = self.run_generate_tags(lambda: create_test_photo(owner=self.user))

        self.assertEqual(self.job().progress_target, 2)
        self.assertEqual(set(queued), {photo.pk for photo in photos})

    def test_the_job_finishes_with_its_last_queued_photo(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        queued = self.run_generate_tags(lambda: tag(photos[0]))

        with patch.object(processing_jobs.semantic, "generate_photo_tags"):
            for photo_id in queued:
                self.assertFalse(self.job().finished)
                processing_jobs.generate_tag_job(photo_id, self.job_id)

        job = self.job()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_current, job.progress_target)


class WalkedFanOutTest(TestCase):
    """The jobs that walk their selection in their own task."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())

    def job(self) -> LongRunningJob:
        return LongRunningJob.objects.get(job_id=self.job_id)

    def assert_finished_at_target(self, target: int) -> None:
        job = self.job()
        self.assertEqual(job.progress_target, target)
        self.assertEqual(job.progress_current, target)
        self.assertTrue(job.finished)

    def test_scan_faces_counts_a_photo_another_scan_took(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]

        def scanned_elsewhere() -> None:
            Photo.objects.filter(pk=photos[1].pk).update(
                faces_scanned_at=timezone.now()
            )

        with (
            meanwhile(scanned_elsewhere),
            patch.object(processing_jobs, "extract_faces") as extract,
            patch.object(processing_jobs, "_encode_and_cluster"),
        ):
            processing_jobs.scan_faces(self.user, self.job_id)

        self.assertEqual(
            [call.args[0].pk for call in extract.call_args_list], [photos[0].pk]
        )
        self.assert_finished_at_target(2)

    def test_scan_faces_counts_a_photo_deleted_meanwhile(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]

        with (
            meanwhile(lambda: Photo.objects.filter(pk=photos[0].pk).delete()),
            patch.object(processing_jobs, "extract_faces"),
            patch.object(processing_jobs, "_encode_and_cluster"),
        ):
            processing_jobs.scan_faces(self.user, self.job_id)

        self.assert_finished_at_target(2)

    def test_scan_faces_leaves_a_photo_added_meanwhile_to_the_next_run(self) -> None:
        create_test_photo(owner=self.user)

        with (
            meanwhile(lambda: create_test_photo(owner=self.user)),
            patch.object(processing_jobs, "extract_faces") as extract,
            patch.object(processing_jobs, "_encode_and_cluster"),
        ):
            processing_jobs.scan_faces(self.user, self.job_id)

        self.assertEqual(extract.call_count, 1)
        self.assert_finished_at_target(1)

    def test_probe_videos_counts_a_video_probed_meanwhile(self) -> None:
        videos = [create_test_photo(owner=self.user, video=True) for _ in range(2)]

        def probed_elsewhere() -> None:
            Photo.objects.filter(pk=videos[1].pk).update(video_color_transfer="bt709")

        with (
            meanwhile(probed_elsewhere),
            patch.object(color, "apply_probe", return_value=None) as probe,
            patch.object(transcode_cache, "discard"),
        ):
            processing_jobs.probe_videos(self.user, self.job_id)

        self.assertEqual(probe.call_count, 1)
        self.assert_finished_at_target(2)

    def test_classify_media_counts_a_photo_the_user_classified_meanwhile(
        self,
    ) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]

        def classified_by_hand() -> None:
            Photo.objects.filter(pk=photos[1].pk).update(category_source="user")

        with meanwhile(classified_by_hand):
            processing_jobs.classify_media(self.user, self.job_id)

        self.assert_finished_at_target(2)
