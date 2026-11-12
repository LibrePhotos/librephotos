"""Saving an edit end to end: thumbnails, the rendition task, faces, OCR, rotation."""

from __future__ import annotations

import os
import types
from unittest import mock

import numpy as np

from api.editing import files, renditions
from api.editing import source as source_module
from api.editing.thumbnail_source import to_original_box
from api.metadata import face_regions
from api.metadata.photo_writer import rotate_photo
from api.models import Face, Photo, PhotoEdit
from api.tests.editing.edited_photo import (
    CROP,
    EXPOSURE,
    HEIGHT,
    QUADRANTS,
    WIDTH,
    EditedPhotoTestCase,
    close,
    colour_at,
    read_pixels,
    recipe,
)
from api.tests.utils import (
    create_test_face,
    create_test_photo_edit,
    create_test_photo_ocr,
)
from api.thumbnails import render


class SaveFlowTest(EditedPhotoTestCase):
    def test_the_thumbnails_show_the_edit_when_the_save_answers(self):
        before = self.big_thumbnail()

        saved = self.save(EXPOSURE)

        after = self.big_thumbnail()
        self.assertEqual(after.shape, before.shape)
        # One stop brighter.
        self.assertGreater(after.mean(), before.mean() + 20)
        self.assertEqual(saved["rendition"], "pending")
        self.assertTrue(os.path.exists(files.preview_path(self.photo.image_hash)))
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.width, edit.height), (WIDTH, HEIGHT))
        self.assertEqual(self.queued, [(self.photo.pk, 1)])

    def test_the_photo_detail_carries_the_edit_for_its_owner(self):
        detail = self.client.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertIsNone(detail["edit"])

        self.save(CROP)

        detail = self.client.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(
            detail["edit"],
            {"version": 1, "rendition": "pending", "width": 60, "height": 40},
        )

    def test_the_background_render_writes_the_rendition(self):
        self.save(CROP)

        self.run_queued()

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual(edit.rendition, "ready")
        self.assertEqual((edit.width, edit.height), (60, 40))
        rendition = read_pixels(files.rendition_path(self.photo.image_hash))
        self.assertEqual(rendition.shape, (40, 60, 3))
        # The centre crop keeps a quarter of each quadrant.
        self.assertTrue(close(colour_at(rendition, 0.25, 0.25), QUADRANTS[0]))
        self.assertTrue(close(colour_at(rendition, 0.75, 0.75), QUADRANTS[3]))
        self.assertFalse(os.path.exists(files.preview_path(self.photo.image_hash)))
        # Regenerated from the rendition, the thumbnails still show the crop.
        render.regenerate_thumbnails(self.photo.thumbnail)
        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))
        self.assertTrue(os.path.exists(files.rendition_path(self.photo.image_hash)))

    def test_a_stale_task_writes_nothing_when_it_starts_late(self):
        self.save(EXPOSURE)
        self.save(CROP)
        first, second = self.queued

        with self.captureOnCommitCallbacks(execute=True):
            renditions.render_rendition(*first)

        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).rendition, "pending")
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        with self.captureOnCommitCallbacks(execute=True):
            renditions.render_rendition(*second)
        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.rendition, edit.version), ("ready", 2))
        self.assertEqual(
            read_pixels(files.rendition_path(self.photo.image_hash)).shape, (40, 60, 3)
        )

    def test_a_save_while_a_task_renders_makes_it_drop_its_render(self):
        self.save(EXPOSURE)
        (first,) = self.queued
        real_render = renditions._render_full

        def render_then_save_again(*args: object) -> np.ndarray:
            pixels = real_render(*args)
            self.save(CROP)
            return pixels

        with mock.patch.object(renditions, "_render_full", render_then_save_again):
            with self.captureOnCommitCallbacks(execute=True):
                renditions.render_rendition(*first)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.rendition, edit.version), ("pending", 2))
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        edits = os.listdir(os.path.join(self.media, files.EDITS_DIR))
        self.assertEqual(edits, [self.photo.image_hash + files.PREVIEW_SUFFIX])

    def test_a_task_that_finished_first_is_replaced_by_the_next_save(self):
        self.save(EXPOSURE)
        self.run_queued()
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).rendition, "ready")

        self.save(CROP)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual((edit.rendition, edit.version), ("pending", 2))
        self.assertFalse(os.path.exists(files.rendition_path(self.photo.image_hash)))
        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))
        self.run_queued()
        self.assertEqual(
            read_pixels(files.rendition_path(self.photo.image_hash)).shape, (40, 60, 3)
        )

    def test_a_failed_render_is_marked_and_logged_without_its_path(self):
        self.save(CROP)
        os.remove(self.photo.main_file.path)

        with self.assertLogs("api.editing.renditions", level="ERROR") as logs:
            self.run_queued()

        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).rendition, "failed")
        self.assertNotIn(self.media, "\n".join(logs.output))
        self.assertIn(self.photo.image_hash, logs.output[0])
        # The thumbnails keep the save's render.
        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))

    def test_a_short_thumbnail_is_made_again_from_the_rendition(self):
        big = os.path.join(
            self.media, "thumbnails_big", self.photo.image_hash + ".webp"
        )
        with mock.patch.object(renditions, "PREVIEW_LONG_EDGE_CAP", 30):
            self.save(EXPOSURE)
        self.assertEqual(read_pixels(big).shape, (20, 30, 3))

        self.run_queued()

        self.assertEqual(read_pixels(big).shape, (HEIGHT, WIDTH, 3))

    def test_an_identity_recipe_brings_the_original_back(self):
        original = self.big_thumbnail()
        self.save(CROP)
        self.run_queued()
        history = [
            {"action": "crop", "at": "2026-11-12T09:30:00Z", "settings": CROP},
            {"action": "reset", "at": "2026-11-12T09:31:00Z", "settings": recipe()},
        ]

        saved = self.save(recipe(), history=history)

        self.assertEqual(saved["rendition"], "none")
        self.assertEqual(saved["history"], history)
        restored = self.big_thumbnail()
        self.assertEqual(restored.shape, original.shape)
        self.assertLess(np.abs(restored.astype(int) - original.astype(int)).mean(), 3)
        self.assertEqual(os.listdir(os.path.join(self.media, files.EDITS_DIR)), [])
        self.assertEqual(self.queued, [])
        detail = self.client.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertIsNone(detail["edit"])

    def test_delete_brings_the_original_back(self):
        original = self.big_thumbnail()
        self.save(CROP)
        self.run_queued()

        self.delete_edit()

        self.assertEqual(self.big_thumbnail().shape, original.shape)
        self.assertEqual(os.listdir(os.path.join(self.media, files.EDITS_DIR)), [])

    def test_regenerating_the_thumbnails_keeps_the_edit_and_its_files(self):
        self.save(CROP)

        render.regenerate_thumbnails(self.photo.thumbnail)

        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))
        self.assertTrue(os.path.exists(files.preview_path(self.photo.image_hash)))

    def test_a_lost_preview_is_rendered_again(self):
        self.save(CROP)
        os.remove(files.preview_path(self.photo.image_hash))

        render.regenerate_thumbnails(self.photo.thumbnail)

        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))

    def test_the_rotation_is_not_applied_twice(self):
        self.photo.local_orientation = 6  # a quarter counter-clockwise
        self.photo.save(update_fields=["local_orientation"])
        render.regenerate_thumbnails(self.photo.thumbnail)
        self.assertEqual(self.big_thumbnail().shape, (WIDTH, HEIGHT, 3))

        self.save(EXPOSURE)
        self.assertEqual(self.big_thumbnail().shape, (WIDTH, HEIGHT, 3))
        self.run_queued()
        render.regenerate_thumbnails(self.photo.thumbnail)

        shown = self.big_thumbnail()
        self.assertEqual(shown.shape, (WIDTH, HEIGHT, 3))
        # Turned left: the green top right quadrant is now top left, a stop brighter.
        self.assertTrue(close(colour_at(shown, 0.25, 0.25), (45, 255, 45), 30))

    def test_the_perceptual_hash_stays_the_originals(self):
        Photo.objects.filter(pk=self.photo.pk).update(
            perceptual_hash="0123456789abcdef"
        )

        self.save(CROP)

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.perceptual_hash, "0123456789abcdef")

    def test_deleting_the_photo_removes_its_edit_files(self):
        self.save(CROP)
        self.run_queued()
        self.save(EXPOSURE)
        rendition = files.rendition_path(self.photo.image_hash)
        preview = files.preview_path(self.photo.image_hash)
        open(rendition, "wb").close()

        with self.captureOnCommitCallbacks(execute=True):
            Photo.objects.get(pk=self.photo.pk).delete()

        self.assertFalse(os.path.exists(rendition))
        self.assertFalse(os.path.exists(preview))


class FaceBoxTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        # The top left quadrant's lower right quarter, in pixels of the
        # 120 x 80 big thumbnail.
        self.face = create_test_face(
            photo=self.photo,
            location_left=30,
            location_top=20,
            location_right=60,
            location_bottom=40,
        )

    def box(self, face: Face | None = None) -> tuple[int, int, int, int]:
        face = face or self.face
        face.refresh_from_db()
        return (
            face.location_left,
            face.location_top,
            face.location_right,
            face.location_bottom,
        )

    def test_a_crop_moves_the_box(self):
        # The centre crop is x 30 to 90, y 20 to 60 of the picture, 60 x 40.
        self.save(CROP)
        self.assertEqual(self.box(), (0, 0, 30, 20))

    def test_a_quarter_turn_after_the_crop_moves_it_again(self):
        self.save(CROP)

        rotate_photo(Photo.objects.get(pk=self.photo.pk), -90)

        # Turned clockwise, the 60 x 40 picture is 40 x 60 and (x, y) goes to
        # (40 - y, x): (0, 0) to (40, 0), (30, 20) to (20, 30).
        self.assertEqual(self.box(), (20, 0, 40, 30))
        self.assertEqual(self.big_thumbnail().shape, (60, 40, 3))

    def test_reverting_moves_the_box_back(self):
        self.save(CROP)

        self.save(recipe(), history=[], cursor=-1)

        self.assertEqual(self.box(), (30, 20, 60, 40))

    def test_a_box_outside_the_crop_keeps_its_face_with_an_edge_box(self):
        outside = create_test_face(
            photo=self.photo,
            location_left=1,
            location_top=1,
            location_right=10,
            location_bottom=10,
        )

        self.save(CROP)

        left, top, right, bottom = self.box(outside)
        self.assertEqual((left, top, right, bottom), (0, 0, 1, 1))
        self.assertTrue(Face.objects.filter(pk=outside.pk).exists())
        detail = self.client.get(f"/api/photos/{self.photo.pk}/")
        self.assertEqual(detail.status_code, 200)

    def test_a_region_written_to_the_file_is_on_the_original(self):
        self.save(CROP)
        self.face.refresh_from_db()

        region = face_regions._face_region(
            self.face, (60, 40), 1, to_original_box(self.photo)
        )

        # (0, 0, 30, 20) of the 60 x 40 crop is x 30 to 60, y 20 to 40 of 120 x 80.
        self.assertAlmostEqual(region["x"], 0.375)
        self.assertAlmostEqual(region["y"], 0.375)
        self.assertAlmostEqual(region["w"], 0.25)
        self.assertAlmostEqual(region["h"], 0.25)

    def test_an_exposure_edit_leaves_the_boxes(self):
        self.save(EXPOSURE)
        self.assertEqual(self.box(), (30, 20, 60, 40))


class OcrPositionsTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        create_test_photo_ocr(
            self.photo,
            text="Hello",
            blocks=[{"text": "Hello", "box": [[0, 0], [60, 0], [60, 20], [0, 20]]}],
            source_width=WIDTH,
            source_height=HEIGHT,
        )

    def ocr(self) -> dict[str, object]:
        return self.client.get(f"/api/photos/{self.photo.pk}/").json()["ocr"]

    def test_positions_stay_without_a_geometry_change(self):
        self.save(EXPOSURE)
        self.assertEqual(len(self.ocr()["blocks"]), 1)

    def test_positions_go_while_the_edit_crops(self):
        self.save(CROP)
        self.assertEqual(self.ocr(), {"text": "Hello", "blocks": []})
        self.delete_edit()
        self.assertEqual(len(self.ocr()["blocks"]), 1)


class RotateEditedPhotoTest(EditedPhotoTestCase):
    def test_an_edited_photo_turns_in_its_recipe(self):
        self.save(CROP)

        response = self.client.post(
            "/api/photosedit/rotate/",
            {"image_hash": self.photo.image_hash, "angle": -90},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 1)
        edit = self.client.get(self.url()).json()
        self.assertEqual(edit["version"], 2)
        self.assertEqual(edit["settings"]["geometry"]["orientation"], 90)
        self.assertEqual(edit["history_cursor"], 1)
        step = edit["history"][-1]
        self.assertEqual(
            (step["action"], step["control"], step["value"]),
            ("set", "geometry.orientation", 90),
        )
        self.assertEqual(step["settings"], edit["settings"])
        shown = self.big_thumbnail()
        self.assertEqual(shown.shape, (60, 40, 3))
        # Clockwise: the bottom left quadrant comes to the top left.
        self.assertTrue(close(colour_at(shown, 0.25, 0.25), QUADRANTS[2]))

    def test_a_flip_turns_into_the_recipe_too(self):
        self.save(EXPOSURE)

        rotate_photo(Photo.objects.get(pk=self.photo.pk), 0, flip_horizontal=True)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual(edit.settings["geometry"], {"flip_h": True})
        self.assertEqual(edit.history[-1]["control"], "geometry.flip_h")

    def test_the_history_after_the_cursor_is_dropped(self):
        history = [
            {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": EXPOSURE},
            {"action": "crop", "at": "2026-11-12T09:31:00Z", "settings": CROP},
        ]
        self.save(EXPOSURE, history=history, cursor=0)

        rotate_photo(Photo.objects.get(pk=self.photo.pk), 90)

        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        self.assertEqual(len(edit.history), 2)
        self.assertEqual(edit.history_cursor, 1)
        self.assertEqual(edit.settings["geometry"], {"orientation": 270})

    def test_a_photo_with_an_identity_edit_rotates_as_before(self):
        create_test_photo_edit(self.photo)

        rotate_photo(Photo.objects.get(pk=self.photo.pk), 90)

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 6)
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).version, 1)


class RawEditTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        linear = np.zeros((40, 60, 3), dtype=np.uint16)
        linear[:, :30] = (30000, 8000, 8000)
        linear[:, 30:] = (8000, 8000, 30000)
        calls: list[dict[str, object]] = []

        class Raw:
            sizes = types.SimpleNamespace(width=60, height=40, flip=0)

            def __enter__(self) -> Raw:
                return self

            def __exit__(self, *args: object) -> bool:
                return False

            def postprocess(self, **kwargs: object) -> np.ndarray:
                calls.append(kwargs)
                return linear

        fake = types.SimpleNamespace(
            imread=lambda path: Raw(),
            ColorSpace=types.SimpleNamespace(sRGB="srgb"),
            HighlightMode=types.SimpleNamespace(Clip="clip"),
        )
        patcher = mock.patch.object(source_module, "rawpy", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.calls = calls
        self.raw = self.make_photo(
            self.owner, b"raw sensor data", "photo.NEF", thumbnails=False
        )

    def test_a_raw_is_developed_by_libraw_for_its_edit(self):
        response = self.put(
            {"settings": CROP, "history": [], "history_cursor": -1}, photo=self.raw
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertTrue(self.calls)
        self.assertEqual(self.big_thumbnail(self.raw).shape, (20, 30, 3))
        self.run_queued()
        rendition = read_pixels(files.rendition_path(self.raw.image_hash))
        self.assertEqual(rendition.shape, (20, 30, 3))
        # Red on the left, blue on the right.
        self.assertGreater(int(rendition[10, 5, 0]), int(rendition[10, 5, 2]))
        self.assertGreater(int(rendition[10, 25, 2]), int(rendition[10, 25, 0]))

    def test_its_source_file_is_linear16(self):
        response = self.client.get(self.url(self.raw) + "source/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content[5], 1)
