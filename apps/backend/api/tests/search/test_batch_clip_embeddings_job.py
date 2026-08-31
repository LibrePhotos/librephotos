"""Characterization tests for ``api.batch_jobs.batch_calculate_clip_embedding``.

These tests pin the CURRENT behavior of the batch CLIP-embedding job so a later
refactor can be verified against them.  They intentionally assert what the code
does today, including a couple of quirks that are called out in comments.

Everything heavy is mocked: ``torch`` is replaced in ``sys.modules`` before the
function performs its lazy ``import torch``, the CLIP sidecar call
(``create_clip_embeddings``) and the FAISS index rebuild
(``build_image_similarity_index``) are patched out, and ``os.path.exists`` is
patched so no thumbnail files need to exist on disk.
"""

import os
import sys
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase

from api import batch_jobs
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.tests.utils import create_test_photos, create_test_user


def make_fake_torch(cuda_available=False):
    """A stand-in for the ``torch`` module used inside the job."""
    fake = MagicMock(name="torch")
    fake.cuda.is_available.return_value = cuda_available
    fake.get_num_threads.return_value = 1
    return fake


def fake_embeddings(imgs):
    """Deterministic stand-in for ``create_clip_embeddings``."""
    imgs_emb = [np.array([float(i), float(i) + 1.0]) for i in range(len(imgs))]
    magnitudes = [float(i) + 0.5 for i in range(len(imgs))]
    return imgs_emb, magnitudes


class BatchCalculateClipEmbeddingTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()
        self._omp_before = os.environ.get("OMP_NUM_THREADS")

    def tearDown(self):
        if self._omp_before is None:
            os.environ.pop("OMP_NUM_THREADS", None)
        else:
            os.environ["OMP_NUM_THREADS"] = self._omp_before

    def run_job(
        self,
        cuda_available=False,
        embeddings_side_effect=None,
        path_exists=True,
    ):
        """Run the job with everything heavy mocked out.

        Returns ``(fake_torch, mock_create_embeddings, mock_build_index)``.
        """
        fake_torch = make_fake_torch(cuda_available=cuda_available)
        with (
            patch.dict(sys.modules, {"torch": fake_torch}),
            patch.object(
                batch_jobs,
                "create_clip_embeddings",
                side_effect=embeddings_side_effect or fake_embeddings,
            ) as m_embed,
            patch.object(batch_jobs, "build_image_similarity_index") as m_index,
            patch.object(batch_jobs.os.path, "exists", return_value=path_exists),
        ):
            batch_jobs.batch_calculate_clip_embedding(self.user)
        return fake_torch, m_embed, m_index

    def latest_job(self):
        return LongRunningJob.objects.filter(started_by=self.user).latest("queued_at")

    # ------------------------------------------------------------------
    # happy path
    # ------------------------------------------------------------------

    def test_happy_path_writes_embeddings_and_completes_job(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user)

        _, m_embed, m_index = self.run_job()

        # every photo got an embedding + magnitude persisted
        for photo in photos:
            photo.refresh_from_db()
            self.assertIsNotNone(photo.clip_embeddings)
            self.assertEqual(len(photo.clip_embeddings), 2)
            self.assertIsNotNone(photo.clip_embeddings_magnitude)

        # embeddings are assigned positionally from the batch
        refreshed = {
            p.pk: p
            for p in Photo.objects.filter(
                owner=self.user, clip_embeddings__isnull=False
            )
        }
        self.assertEqual(len(refreshed), 3)
        magnitudes = sorted(p.clip_embeddings_magnitude for p in refreshed.values())
        self.assertEqual(magnitudes, [0.5, 1.5, 2.5])

        # sidecar called once (single batch, BATCH_SIZE == 64), with thumbnail paths
        self.assertEqual(m_embed.call_count, 1)
        called_imgs = m_embed.call_args[0][0]
        self.assertEqual(len(called_imgs), 3)
        self.assertTrue(all(isinstance(p, str) for p in called_imgs))

        # similarity index rebuilt for the user, exactly once, after the loop
        m_index.assert_called_once_with(self.user)

        job = self.latest_job()
        self.assertEqual(job.job_type, LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertIsNotNone(job.started_at)
        self.assertIsNotNone(job.finished_at)
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
    # torch / threading branches
    # ------------------------------------------------------------------

    def test_cpu_branch_pins_single_thread(self):
        create_test_photos(number_of_photos=1, owner=self.user)

        fake_torch, _, _ = self.run_job(cuda_available=False)

        fake_torch.set_num_threads.assert_called_once_with(1)
        fake_torch.multiprocessing.set_start_method.assert_not_called()
        self.assertEqual(os.environ["OMP_NUM_THREADS"], "1")

    def test_cuda_branch_sets_spawn_start_method(self):
        create_test_photos(number_of_photos=1, owner=self.user)

        fake_torch, _, _ = self.run_job(cuda_available=True)

        fake_torch.multiprocessing.set_start_method.assert_called_once_with(
            "spawn", force=True
        )
        fake_torch.set_num_threads.assert_not_called()

    # ------------------------------------------------------------------
    # scoping / selection
    # ------------------------------------------------------------------

    def test_only_photos_of_the_requesting_user_are_processed(self):
        mine = create_test_photos(number_of_photos=1, owner=self.user)[0]
        theirs = create_test_photos(number_of_photos=1, owner=self.other_user)[0]

        _, m_embed, _ = self.run_job()

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

        _, m_embed, _ = self.run_job()

        done.refresh_from_db()
        self.assertEqual(done.clip_embeddings, [9.0, 9.0])
        self.assertEqual(done.clip_embeddings_magnitude, 42.0)
        self.assertEqual(len(m_embed.call_args[0][0]), 2)
        self.assertEqual(self.latest_job().progress_target, 2)

    def test_no_photos_skips_loop_but_still_rebuilds_index_and_completes(self):
        _, m_embed, m_index = self.run_job()

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
        """When no thumbnail exists on disk the batch is skipped via ``continue``.

        Quirk pinned here: the ``continue`` also skips the trailing
        ``lrj.update_progress`` call, so progress_current stays at 0 even though
        the loop has consumed every photo and terminates.
        """
        photos = create_test_photos(number_of_photos=2, owner=self.user)

        _, m_embed, m_index = self.run_job(path_exists=False)

        m_embed.assert_not_called()
        for photo in photos:
            photo.refresh_from_db()
            self.assertIsNone(photo.clip_embeddings)

        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 2)
        self.assertEqual(job.progress_current, 0)

    def test_embedding_error_is_swallowed_and_job_still_completes(self):
        """A sidecar failure is logged, not raised; the job completes as success.

        Quirk pinned here: the job is marked finished (not failed) even though
        nothing was embedded, and progress reaches the target.
        """
        photos = create_test_photos(number_of_photos=2, owner=self.user)

        with patch.object(batch_jobs.util.logger, "error") as m_error:
            _, m_embed, m_index = self.run_job(
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

        fake_torch = make_fake_torch()
        with (
            patch.dict(sys.modules, {"torch": fake_torch}),
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

        # job is left unfinished when the index rebuild explodes
        job = self.latest_job()
        self.assertFalse(job.finished)

    def test_shorter_embedding_list_than_batch_leaves_extras_untouched(self):
        """``zip`` truncates: a short sidecar response silently skips photos."""
        create_test_photos(number_of_photos=3, owner=self.user)

        def short_response(imgs):
            return [np.array([1.0, 2.0])], [7.0]

        _, _, m_index = self.run_job(embeddings_side_effect=short_response)

        written = Photo.objects.filter(
            owner=self.user, clip_embeddings__isnull=False
        ).count()
        self.assertEqual(written, 1)
        m_index.assert_called_once_with(self.user)
        job = self.latest_job()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_current, 3)
