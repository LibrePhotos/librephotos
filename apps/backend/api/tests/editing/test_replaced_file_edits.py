"""An edited photo whose file is replaced on disk (``rekey_replaced_file``).

The same picture saved again, or one that cannot be compared, has its
recipe rendered again from the new file (new preview and thumbnails, the
rendition queued, a new version). A new picture has its edit reset like a
revert: a crop made for another picture is not applied to it. No edit file
is left under an old hash in any branch.
"""

from __future__ import annotations

import gc
import os
from typing import Any
from unittest import mock

import numpy as np
import pyvips

from api.directory_watcher import file_handlers
from api.editing import files, renditions
from api.models import Photo, PhotoEdit
from api.photos.media_files import calculate_hash
from api.tests.editing.edited_photo import (
    CROP,
    EditedPhotoTestCase,
    close,
    colour_at,
    jpeg_bytes,
    read_pixels,
)

GREEN = (20, 200, 20)


class ReplacedEditedFileTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.save(CROP)
        self.run_queued()
        self.old_hash = self.photo.image_hash
        self.assertTrue(os.path.exists(files.rendition_path(self.old_hash)))

    def replace(self, verdict: str) -> Photo:
        """Write an all-green picture over the file and re-key it under ``verdict``."""
        path = self.photo.main_file.path
        green = np.zeros((80, 120, 3), dtype=np.uint8)
        green[:] = GREEN
        # libvips may hold the old file open (Windows).
        pyvips.cache_set_max(0)
        gc.collect()
        part = path + ".new"
        with open(part, "wb") as handle:
            handle.write(jpeg_bytes(green))
        os.replace(part, path)
        new_hash = calculate_hash(self.owner, path)
        with mock.patch.object(file_handlers, "_picture_verdict", return_value=verdict):
            with self.captureOnCommitCallbacks(execute=True):
                result = file_handlers.rekey_replaced_file(self.owner, path, new_hash)
        assert result is not None
        self.assertEqual(result.verdict, verdict)
        return Photo.objects.get(pk=self.photo.pk)

    def edit_files(self) -> list[str]:
        return sorted(os.listdir(os.path.join(self.media, files.EDITS_DIR)))

    def assert_rendered_again(self, verdict: str) -> None:
        photo = self.replace(verdict)

        self.assertEqual(photo.image_hash, self.old_hash)
        edit = PhotoEdit.objects.get(pk=photo.pk)
        self.assertEqual((edit.version, edit.rendition), (2, "pending"))
        self.assertEqual(edit.settings, CROP)
        self.assertEqual(self.edit_files(), [photo.image_hash + files.PREVIEW_SUFFIX])
        big = self.big_thumbnail(photo)
        self.assertEqual(big.shape, (40, 60, 3))
        self.assertTrue(close(colour_at(big, 0.5, 0.5), GREEN))
        self.assertEqual(self.queued, [(photo.pk, 2)])
        self.run_queued()
        rendition = read_pixels(files.rendition_path(photo.image_hash))
        self.assertTrue(close(colour_at(rendition, 0.5, 0.5), GREEN))
        self.assertEqual(self.edit_files(), [photo.image_hash + files.RENDITION_SUFFIX])

    def test_a_similar_picture_is_rendered_again(self):
        self.assert_rendered_again(file_handlers.SIMILAR_PICTURE)

    def test_an_uncomparable_picture_is_rendered_again(self):
        self.assert_rendered_again(file_handlers.UNCOMPARABLE)

    def test_a_new_picture_resets_the_edit(self):
        photo = self.replace(file_handlers.NEW_PICTURE)

        self.assertNotEqual(photo.image_hash, self.old_hash)
        edit = PhotoEdit.objects.get(pk=photo.pk)
        self.assertEqual(
            (edit.version, edit.rendition, edit.settings, edit.history),
            (2, "none", {"version": 1}, []),
        )
        self.assertEqual(edit.history_cursor, -1)
        self.assertEqual(self.edit_files(), [])
        self.assertEqual(self.queued, [])
        big = self.big_thumbnail(photo)
        self.assertEqual(big.shape, (80, 120, 3))
        self.assertTrue(close(colour_at(big, 0.1, 0.1), GREEN))
        for directory in ("thumbnails_big", "square_thumbnails"):
            names = os.listdir(os.path.join(self.media, directory))
            self.assertFalse([name for name in names if self.old_hash in name])

    def test_the_same_picture_keeps_its_edit(self):
        photo = self.replace(file_handlers.SAME_PICTURE)

        edit = PhotoEdit.objects.get(pk=photo.pk)
        self.assertEqual((edit.version, edit.rendition), (1, "ready"))
        self.assertEqual(self.edit_files(), [photo.image_hash + files.RENDITION_SUFFIX])

    def test_a_new_file_the_edit_cannot_render_marks_it_failed(self):
        def fail(*args: Any, **kwargs: Any) -> None:
            raise renditions.RenderError("x")

        with mock.patch.object(renditions, "_render_preview", side_effect=fail):
            photo = self.replace(file_handlers.SIMILAR_PICTURE)

        edit = PhotoEdit.objects.get(pk=photo.pk)
        self.assertEqual((edit.version, edit.rendition), (2, "failed"))
        self.assertEqual(self.edit_files(), [])
