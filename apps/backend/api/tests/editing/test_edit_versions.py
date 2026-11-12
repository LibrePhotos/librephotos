"""A version names one picture of a photo forever, and a stale render writes nothing.

Reverting resets the edit row instead of deleting it, so "save A, revert,
save B" gives B a new version and A's render, still running, cannot pass
for B's. The task marks the row ready with one update conditional on its
version, before it puts the file in place.
"""

from __future__ import annotations

import os
from typing import Any
from unittest import mock

import numpy as np

from api.editing import files, renditions
from api.models import Photo, PhotoEdit
from api.tests.editing.edited_photo import (
    CROP,
    EXPOSURE,
    HEIGHT,
    WIDTH,
    EditedPhotoTestCase,
    read_pixels,
)


class VersionNeverRepeatsTest(EditedPhotoTestCase):
    def test_a_revert_keeps_the_row_and_raises_the_version(self):
        self.save(CROP)
        self.save(EXPOSURE)

        self.delete_edit()

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual(
            (edit.version, edit.rendition, edit.settings, edit.history),
            (3, "none", {"version": 1}, []),
        )
        self.assertEqual(edit.history_cursor, -1)
        self.assertEqual(edit.face_boxes, {})
        self.assertEqual(os.listdir(os.path.join(self.media, files.EDITS_DIR)), [])
        self.assertEqual(self.big_thumbnail().shape, (HEIGHT, WIDTH, 3))
        self.assertEqual(self.save(CROP)["version"], 4)

    def test_a_second_revert_goes_on_counting(self):
        self.save(CROP)
        self.delete_edit()
        self.delete_edit()
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).version, 3)


class StaleRenderTest(EditedPhotoTestCase):
    """Both orders of the race between a render and a newer save or revert."""

    def _render_while(self, action: Any) -> None:
        """Run the first queued render, doing ``action`` while it renders."""
        task = self.queued.pop(0)
        real = renditions._render_full

        def render_then_act(*args: object) -> np.ndarray:
            pixels = real(*args)
            action()
            return pixels

        # The action runs its own commit callbacks; a stale task registers none.
        with mock.patch.object(renditions, "_render_full", render_then_act):
            renditions.render_rendition(*task)

    def test_revert_then_save_during_a_render_keeps_the_new_edit(self):
        # The reviewer's case: A renders while the owner reverts and saves B.
        self.save(CROP)

        self._render_while(lambda: (self.delete_edit(), self.save(EXPOSURE)))

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.version, edit.rendition), (3, "pending"))
        self.assertEqual((edit.width, edit.height), (WIDTH, HEIGHT))
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        self.assertEqual(self.queued, [(self.photo.pk, 3)])
        self.run_queued()
        edit.refresh_from_db()
        self.assertEqual((edit.rendition, edit.width, edit.height), ("ready", 120, 80))
        self.assertEqual(
            read_pixels(files.rendition_path(self.photo.image_hash)).shape,
            (HEIGHT, WIDTH, 3),
        )

    def test_revert_then_save_before_the_render_starts(self):
        self.save(CROP)
        self.delete_edit()
        self.save(EXPOSURE)
        first, second = self.queued

        with self.captureOnCommitCallbacks(execute=True):
            renditions.render_rendition(*first)

        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).rendition, "pending")
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        with self.captureOnCommitCallbacks(execute=True):
            renditions.render_rendition(*second)
        self.assertEqual(
            read_pixels(files.rendition_path(self.photo.image_hash)).shape,
            (HEIGHT, WIDTH, 3),
        )

    def test_a_revert_during_a_render_leaves_nothing(self):
        self.save(CROP)

        self._render_while(self.delete_edit)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.version, edit.rendition), (2, "none"))
        self.assertEqual(os.listdir(os.path.join(self.media, files.EDITS_DIR)), [])
        self.assertEqual(self.big_thumbnail().shape, (HEIGHT, WIDTH, 3))

    def test_the_photo_deleted_during_a_render_leaves_nothing(self):
        self.save(CROP)

        def delete_photo() -> None:
            with self.captureOnCommitCallbacks(execute=True):
                Photo.objects.get(pk=self.photo.pk).delete()

        self._render_while(delete_photo)

        self.assertFalse(PhotoEdit.objects.filter(pk=self.photo.pk).exists())
        self.assertEqual(os.listdir(os.path.join(self.media, files.EDITS_DIR)), [])

    def test_the_ready_mark_is_conditional_on_the_version(self):
        """No window: the update that marks it ready names the version."""
        self.save(CROP)
        (task,) = self.queued
        # A newer save landed between the task's first read and its write.
        real_write = files.write_part

        def write_then_bump(*args: Any, **kwargs: Any) -> str:
            part = real_write(*args, **kwargs)
            PhotoEdit.objects.filter(pk=self.photo.pk).update(version=7)
            return part

        with mock.patch.object(files, "write_part", write_then_bump):
            with self.captureOnCommitCallbacks(execute=True):
                renditions.render_rendition(*task)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.version, edit.rendition), (7, "pending"))
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        leftovers = [
            name
            for name in os.listdir(os.path.join(self.media, files.EDITS_DIR))
            if name.endswith(".part")
        ]
        self.assertEqual(leftovers, [])
