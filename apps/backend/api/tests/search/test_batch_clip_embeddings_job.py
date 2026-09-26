"""Tests for ``api.batch_jobs.batch_calculate_clip_embedding``.

Everything heavy is mocked: the CLIP sidecar call (``create_clip_embeddings``)
and the FAISS index rebuild (``build_image_similarity_index``) are patched
out, and ``os.path.exists`` is patched so no thumbnail files need to exist on
disk. The job has no ML runtime of its own any more; the sidecar owns the
model and its threading.
"""

from unittest.mock import patch

import numpy as np
from django.test import TestCase

from api import batch_jobs
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.tests.utils import create_test_photos, create_test_user


def fake_embeddings(imgs):
    """Deterministic stand-in for ``create_clip_embeddings``."""
    imgs_emb = [np.array([float(i), float(i) + 1.0]) for i in range(len(imgs))]
    magnitudes = [float(i) + 0.5 for i in range(len(imgs))]
    return imgs_emb, magnitudes


class BatchCalculateClipEmbeddingTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()

    def run_job(self, embeddings_side_effect=None, path_exists=True):
        """Run the job with everything heavy mocked out.

        Returns ``(mock_create_embeddings, mock_build_index)``.
        """
        with (
            patch.object(
                batch_jobs,
                "create_clip_embeddings",
                side_effect=embeddings_side_effect or fake_embeddings,
            ) as m_embed,
            patch.object(batch_jobs, "build_image_similarity_index") as m_index,
            patch.object(
                batch_jobs.os.path,
                "exists",
                **(
                    {"side_effect": path_exists}
                    if callable(path_exists)
                    else {"return_value": path_exists}
                ),
            ),
        ):
            batch_jobs.batch_calculate_clip_embedding(self.user)
        return m_embed, m_index

    def latest_job(self):
        return LongRunningJob.objects.filter(started_by=self.user).latest("queued_at")

    # ------------------------------------------------------------------
    # happy path
    # ------------------------------------------------------------------

    def test_happy_path_writes_embeddings_and_completes_job(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user)

        m_embed, m_index = self.run_job()

        for photo in photos:
            photo.refresh_from_db()
            self.assertIsNotNone(photo.clip_embeddings)
            self.assertEqual(len(photo.clip_embeddings), 2)
            self.assertIsNotNone(photo.clip_embeddings_magnitude)

        refreshed = Photo.objects.filter(owner=self.user, clip_embeddings__isnull=False)
        self.assertEqual(refreshed.count(), 3)
        magnitudes = sorted(p.clip_embeddings_magnitude for p in refreshed)
        self.assertEqual(magnitudes, [0.5, 1.5, 2.5])

        # sidecar called once (single batch, BATCH_SIZE == 64), with thumbnail paths
        self.assertEqual(m_embed.call_count, 1)
        called_imgs = m_embed.call_args[0][0]
        self.assertEqual(len(called_imgs), 3)
        self.assertTrue(all(isinstance(p, str) for p in called_imgs))

        m_index.assert_called_once_with(self.user)

        job = self.latest_job()
        self.assertEqual(job.job_type, LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 3)
        self.assertEqual(job.progress_current, 3)

    def test_job_created_started_and_typed_correctly(self):
        create_test_photos(number_of_photos=1, owner=self.user)
        self.assertEqual(LongRunningJob.objects.count(), 0)

        self.run_job()

        self.assertEqual(LongRunningJob.objects.count(), 1)
        job = self.latest_job()
        self.assertEqual(job.started_by, self.user)
        self.assertTrue(job.job_id)

    # ------------------------------------------------------------------
    # scoping / selection
    # ------------------------------------------------------------------

    def test_only_photos_of_the_requesting_user_are_processed(self):
        mine = create_test_photos(number_of_photos=1, owner=self.user)[0]
        theirs = create_test_photos(number_of_photos=1, owner=self.other_user)[0]

        m_embed, _ = self.run_job()

        mine.refresh_from_db()
        theirs.refresh_from_db()
        self.assertIsNotNone(mine.clip_embeddings)
        self.assertIsNone(theirs.clip_embeddings)
        self.assertEqual(len(m_embed.call_args[0][0]), 1)
        self.assertEqual(self.latest_job().progress_target, 1)

    def test_photos_with_existing_embeddings_are_skipped(self):
        done = create_test_photos(number_of_photos=1, owner=self.user)[0]
        done.clip_embeddings = [9.0, 9.0]
        done.clip_embeddings_magnitude = 42.0
        done.save()
        create_test_photos(number_of_photos=2, owner=self.user)

        m_embed, _ = self.run_job()

        done.refresh_from_db()
        self.assertEqual(done.clip_embeddings, [9.0, 9.0])
        self.assertEqual(done.clip_embeddings_magnitude, 42.0)
        self.assertEqual(len(m_embed.call_args[0][0]), 2)
        self.assertEqual(self.latest_job().progress_target, 2)

    def test_no_photos_skips_loop_but_still_rebuilds_index_and_completes(self):
        m_embed, m_index = self.run_job()

        m_embed.assert_not_called()
        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)
        self.assertEqual(job.progress_current, 0)

    # ------------------------------------------------------------------
    # error / edge branches
    # ------------------------------------------------------------------

    def test_missing_thumbnail_files_skip_the_batch_entirely(self):
        """When no thumbnail exists on disk the sidecar is not called at all.

        The photos were still attempted, so they count towards the progress.
        """
        photos = create_test_photos(number_of_photos=2, owner=self.user)

        m_embed, m_index = self.run_job(path_exists=False)

        m_embed.assert_not_called()
        for photo in photos:
            photo.refresh_from_db()
            self.assertIsNone(photo.clip_embeddings)

        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 2)
        self.assertEqual(job.progress_current, 2)

    # ------------------------------------------------------------------
    # photos that get no embedding must not starve the rest (a later run
    # retries them; this one moves on)
    # ------------------------------------------------------------------

    def test_photos_without_thumbnail_file_do_not_starve_later_photos(self):
        """More failures than a batch holds, all ahead of a good photo.

        Taking the first BATCH_SIZE photos still missing an embedding again
        and again handed the failures every batch, and the good photo, last
        in line, was never sent to the sidecar.
        """
        broken = create_test_photos(number_of_photos=65, owner=self.user)
        good = create_test_photos(number_of_photos=1, owner=self.user)[0]
        good_path = good.thumbnail.thumbnail_big.path

        m_embed, m_index = self.run_job(path_exists=lambda path: path == good_path)

        good.refresh_from_db()
        self.assertIsNotNone(good.clip_embeddings)
        m_embed.assert_called_once_with([good_path])
        self.assertFalse(
            Photo.objects.filter(
                pk__in=[p.pk for p in broken], clip_embeddings__isnull=False
            ).exists()
        )
        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 66)
        self.assertEqual(job.progress_current, 66)

    def test_photos_the_sidecar_cannot_read_do_not_starve_later_photos(self):
        """The same for a ``None`` slot: every photo is sent exactly once."""
        photos = create_test_photos(number_of_photos=130, owner=self.user)
        unreadable = {
            p.thumbnail.thumbnail_big.path
            for p in Photo.objects.filter(owner=self.user).order_by("pk")[:64]
        }

        def skip_unreadable(imgs):
            embeddings = [
                None if img in unreadable else np.array([1.0, 2.0]) for img in imgs
            ]
            return embeddings, [None if e is None else 3.0 for e in embeddings]

        m_embed, _ = self.run_job(embeddings_side_effect=skip_unreadable)

        sent = [img for call in m_embed.call_args_list for img in call.args[0]]
        self.assertEqual(len(sent), 130)
        self.assertEqual(len(set(sent)), 130)
        self.assertEqual(
            Photo.objects.filter(
                owner=self.user, clip_embeddings__isnull=False
            ).count(),
            130 - 64,
        )
        self.assertEqual(len(photos), 130)
        self.assertEqual(self.latest_job().progress_current, 130)

    def test_photo_without_thumbnail_row_does_not_sink_its_batch(self):
        """A missing Thumbnail row used to raise and skip the whole batch."""
        photos = create_test_photos(number_of_photos=3, owner=self.user)
        photos[0].thumbnail.delete()

        m_embed, _ = self.run_job()

        self.assertEqual(len(m_embed.call_args[0][0]), 2)
        self.assertEqual(
            Photo.objects.filter(
                owner=self.user, clip_embeddings__isnull=False
            ).count(),
            2,
        )

    def test_embedding_error_is_swallowed_and_job_still_completes(self):
        """A sidecar failure is logged, not raised; the job completes as success."""
        photos = create_test_photos(number_of_photos=2, owner=self.user)

        with patch.object(batch_jobs.util.logger, "error") as m_error:
            m_embed, m_index = self.run_job(
                embeddings_side_effect=RuntimeError("clip sidecar down")
            )

        m_embed.assert_called_once()
        self.assertTrue(m_error.called)
        self.assertIn("Error calculating clip embeddings", m_error.call_args[0][0])

        for photo in photos:
            photo.refresh_from_db()
            self.assertIsNone(photo.clip_embeddings)

        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 2)
        self.assertEqual(job.progress_current, 2)

    def test_index_build_failure_propagates(self):
        """``build_image_similarity_index`` is outside the try/except."""
        create_test_photos(number_of_photos=1, owner=self.user)

        with (
            patch.object(
                batch_jobs, "create_clip_embeddings", side_effect=fake_embeddings
            ),
            patch.object(
                batch_jobs,
                "build_image_similarity_index",
                side_effect=RuntimeError("index down"),
            ),
            patch.object(batch_jobs.os.path, "exists", return_value=True),
        ):
            with self.assertRaises(RuntimeError):
                batch_jobs.batch_calculate_clip_embedding(self.user)

        job = self.latest_job()
        self.assertFalse(job.finished)

    def test_unreadable_image_slot_is_skipped_and_neighbours_keep_their_own(self):
        """A ``None`` slot from the sidecar leaves that photo for a later run.

        The slot keeps positions aligned, so the photo after it still gets
        its own embedding rather than a shifted one.
        """
        photos = create_test_photos(number_of_photos=3, owner=self.user)

        def with_gap(imgs):
            return (
                [np.array([1.0, 0.0]), None, np.array([3.0, 0.0])],
                [1.0, None, 3.0],
            )

        _, m_index = self.run_job(embeddings_side_effect=with_gap)

        by_magnitude = sorted(
            (p.clip_embeddings_magnitude, p.clip_embeddings)
            for p in Photo.objects.filter(
                owner=self.user, clip_embeddings__isnull=False
            )
        )
        self.assertEqual(by_magnitude, [(1.0, [1.0, 0.0]), (3.0, [3.0, 0.0])])
        self.assertEqual(
            Photo.objects.filter(owner=self.user, clip_embeddings__isnull=True).count(),
            1,
        )
        self.assertEqual(len(photos), 3)
        m_index.assert_called_once_with(self.user)
        self.assertTrue(self.latest_job().finished)

    def test_shorter_embedding_list_than_batch_leaves_extras_untouched(self):
        """``zip`` truncates: a short sidecar response silently skips photos."""
        create_test_photos(number_of_photos=3, owner=self.user)

        def short_response(imgs):
            return [np.array([1.0, 2.0])], [7.0]

        _, m_index = self.run_job(embeddings_side_effect=short_response)

        written = Photo.objects.filter(
            owner=self.user, clip_embeddings__isnull=False
        ).count()
        self.assertEqual(written, 1)
        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_current, 3)
