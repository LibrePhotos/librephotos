from __future__ import annotations

import gc
import os

import numpy as np
import pyvips

from api.editing import files
from api.models import File, Photo, PhotoEdit
from api.photos.files import detach_missing_files
from api.tests.editing.edited_photo import (
    CROP,
    EditedPhotoTestCase,
    close,
    colour_at,
    jpeg_bytes,
    read_pixels,
)
from api.tests.utils import create_test_file

GREEN = (20, 200, 20)


class StandInEditTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.save(CROP)
        self.run_queued()
        self.assertTrue(os.path.exists(files.rendition_path(self.photo.image_hash)))

    def add_file(self, name: str, content: bytes, file_type: int) -> File:
        directory = os.path.dirname(self.photo.main_file.path)
        file = create_test_file(os.path.join(directory, name), self.owner, content)
        File.objects.filter(pk=file.pk).update(type=file_type)
        file.type = file_type
        self.photo.files.add(self.photo.main_file, file)
        return file

    def delete_main_file_and_scan(self) -> Photo:
        pyvips.cache_set_max(0)
        gc.collect()
        os.remove(self.photo.main_file.path)
        with self.captureOnCommitCallbacks(execute=True):
            detach_missing_files(Photo.objects.get(pk=self.photo.pk))
        return Photo.objects.get(pk=self.photo.pk)

    def edit_files(self) -> list[str]:
        return sorted(os.listdir(os.path.join(self.media, files.EDITS_DIR)))

    def test_an_image_standing_in_renders_the_edit_again_from_it(self):
        green = np.zeros((80, 120, 3), dtype=np.uint8)
        green[:] = GREEN
        stand_in = self.add_file("picture.jpeg", jpeg_bytes(green), File.IMAGE)

        photo = self.delete_main_file_and_scan()

        self.assertEqual(photo.main_file, stand_in)
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

    def test_a_video_standing_in_forgets_the_edit(self):
        stand_in = self.add_file("picture.mov", b"not really a video", File.VIDEO)

        photo = self.delete_main_file_and_scan()

        self.assertEqual(photo.main_file, stand_in)
        self.assertTrue(photo.video)
        edit = PhotoEdit.objects.get(pk=photo.pk)
        self.assertEqual(
            (edit.version, edit.rendition, edit.settings, edit.history),
            (2, "none", {"version": 1}, []),
        )
        self.assertEqual(self.edit_files(), [])
        self.assertEqual(self.queued, [])
