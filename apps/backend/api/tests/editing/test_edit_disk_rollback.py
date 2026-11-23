"""The files a save changes follow its transaction.

The preview file and the thumbnails are replaced inside the save's
transaction; when it does not commit they are put back as they were, and
when the photo was deleted meanwhile they are removed, so the disk never
shows a recipe the database does not have.
"""

from __future__ import annotations

import os
from typing import Any
from unittest import mock

from api.editing import files, renditions
from api.editing.recipe import recipe_from_json
from api.models import Photo, PhotoEdit
from api.tests.editing.edited_photo import CROP, EXPOSURE, EditedPhotoTestCase
from api.thumbnails import render

# Where a failure is forced: each step of a save after the preview is in place.
STEPS: dict[str, tuple[Any, str]] = {
    "thumbnails": (render, "regenerate_thumbnails"),
    "colour": (render, "refresh_dominant_color"),
    "face boxes": (renditions, "place_face_boxes"),
    "touch": (renditions, "_touch"),
}
DIRECTORIES = (files.EDITS_DIR, "thumbnails_big", "square_thumbnails")


class ForcedFailureError(Exception):
    pass


class SaveRollbackTest(EditedPhotoTestCase):
    def snapshot(self) -> dict[str, bytes]:
        found: dict[str, bytes] = {}
        for directory in DIRECTORIES:
            root = os.path.join(self.media, directory)
            if not os.path.isdir(root):
                continue
            for name in os.listdir(root):
                with open(os.path.join(root, name), "rb") as handle:
                    found[f"{directory}/{name}"] = handle.read()
        return found

    def row(self) -> tuple[Any, ...] | None:
        edit = PhotoEdit.objects.filter(pk=self.photo.pk).first()
        if edit is None:
            return None
        return (edit.version, edit.rendition, edit.settings, edit.face_boxes)

    def failing_save(self, step: str, settings: dict[str, Any]) -> None:
        module, name = STEPS[step]
        photo = Photo.objects.get(pk=self.photo.pk)
        with mock.patch.object(module, name, side_effect=ForcedFailureError):
            with self.assertRaises(ForcedFailureError):
                renditions.save_edit(
                    photo, recipe_from_json(settings), [], -1
                ) if settings == {"version": 1} else renditions.save_edit(
                    photo,
                    recipe_from_json(settings),
                    [
                        {
                            "action": "set",
                            "at": "2026-11-12T09:30:00Z",
                            "settings": settings,
                        }
                    ],
                    0,
                )

    def assert_rolled_back(self, setup: Any, settings: dict[str, Any]) -> None:
        for step in STEPS:
            with self.subTest(step=step):
                setup()
                disk, row = self.snapshot(), self.row()

                self.failing_save(step, settings)

                self.assertEqual(self.row(), row)
                self.assertEqual(self.snapshot(), disk)

    def test_a_first_save(self):
        self.assert_rolled_back(lambda: None, CROP)

    def test_a_save_over_a_pending_edit(self):
        self.save(EXPOSURE)
        self.assert_rolled_back(lambda: None, CROP)

    def test_a_save_over_a_ready_edit(self):
        self.save(EXPOSURE)
        self.run_queued()
        self.assert_rolled_back(lambda: None, CROP)

    def test_a_revert(self):
        self.save(CROP)
        self.run_queued()
        disk, row = self.snapshot(), self.row()
        with mock.patch.object(renditions, "_touch", side_effect=ForcedFailureError):
            with self.assertRaises(ForcedFailureError):
                renditions.reset_edit(Photo.objects.get(pk=self.photo.pk))
        self.assertEqual(self.row(), row)
        self.assertEqual(self.snapshot(), disk)

    def test_a_save_that_commits_keeps_no_copy_of_what_it_replaced(self):
        self.save(EXPOSURE)
        self.save(CROP)
        kept = [name for name in self.snapshot() if name.endswith(files.KEPT_SUFFIX)]
        self.assertEqual(kept, [])

    def test_the_photo_deleted_meanwhile_leaves_no_file(self):
        self.save(EXPOSURE)
        image_hash = self.photo.image_hash
        with mock.patch.object(renditions, "_photo_exists", return_value=False):
            self.failing_save("touch", CROP)
        self.assertEqual([name for name in self.snapshot() if image_hash in name], [])
