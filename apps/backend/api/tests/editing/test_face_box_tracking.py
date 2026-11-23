"""Face boxes kept on the unedited picture while an edit crops or turns it.

The picture and its big thumbnail are 120 x 80. Boxes are (left, top, right,
bottom) in big thumbnail pixels, computed by hand in each test.
"""

from __future__ import annotations

from typing import Any
from unittest import mock

from api.editing import faces as edit_faces
from api.faces import extractor, photo_faces
from api.models import Face, PhotoEdit
from api.tests.editing.edited_photo import CROP, EXPOSURE, EditedPhotoTestCase, recipe
from api.tests.utils import create_test_face
from api.thumbnails import render

# The centre crop again, moved to the left half: x 0 to 60, y 20 to 60.
LEFT_CROP = recipe(geometry={"crop": {"cx": 0.25, "cy": 0.5, "w": 0.5, "h": 0.5}})


def _face(photo: Any, box: tuple[int, int, int, int]) -> Face:
    """A face with this box; the factory replaces a 0 with a random number."""
    left, top, right, bottom = box
    return create_test_face(
        photo=photo,
        location_left=left,
        location_top=top,
        location_right=right,
        location_bottom=bottom,
    )


class FaceBoxTrackingTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.inside = _face(self.photo, (30, 20, 60, 40))
        self.outside = _face(self.photo, (1, 1, 10, 10))
        self.partial = _face(self.photo, (10, 10, 50, 40))

    def box(self, face: Face) -> tuple[int, int, int, int]:
        face.refresh_from_db()
        return (
            face.location_left,
            face.location_top,
            face.location_right,
            face.location_bottom,
        )

    def revert(self) -> None:
        self.save(recipe(), history=[], cursor=-1)

    def test_a_crop(self):
        # Crop x 30 to 90, y 20 to 60, shown 60 x 40: (x - 30, y - 20), clamped.
        self.save(CROP)

        self.assertEqual(self.box(self.inside), (0, 0, 30, 20))
        self.assertEqual(self.box(self.outside), (0, 0, 1, 1))
        self.assertEqual(self.box(self.partial), (0, 0, 20, 20))

    def test_crop_then_revert_restores_every_box_exactly(self):
        self.save(CROP)
        self.revert()

        self.assertEqual(self.box(self.inside), (30, 20, 60, 40))
        self.assertEqual(self.box(self.outside), (1, 1, 10, 10))
        self.assertEqual(self.box(self.partial), (10, 10, 50, 40))
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).face_boxes, {})

    def test_crop_then_delete_restores_every_box_exactly(self):
        self.save(CROP)
        self.delete_edit()

        self.assertEqual(self.box(self.outside), (1, 1, 10, 10))
        self.assertEqual(self.box(self.partial), (10, 10, 50, 40))

    def test_two_different_crops_derive_from_the_unedited_boxes(self):
        self.save(CROP)
        # Crop x 0 to 60, y 20 to 60: (x, y - 20), clamped. Moved from the
        # first crop instead, the outside face would stay a corner pixel.
        self.save(LEFT_CROP)

        self.assertEqual(self.box(self.inside), (30, 0, 60, 20))
        self.assertEqual(self.box(self.outside), (1, 0, 10, 1))
        self.assertEqual(self.box(self.partial), (10, 0, 50, 20))
        self.revert()
        self.assertEqual(self.box(self.partial), (10, 10, 50, 40))

    def test_a_quarter_turn(self):
        # Turned clockwise the picture is 80 x 120 and (x, y) goes to (80 - y, x).
        self.save(recipe(geometry={"orientation": 90}))

        self.assertEqual(self.big_thumbnail().shape, (120, 80, 3))
        self.assertEqual(self.box(self.inside), (40, 30, 60, 60))
        self.assertEqual(self.box(self.outside), (70, 1, 79, 10))
        self.revert()
        self.assertEqual(self.box(self.inside), (30, 20, 60, 40))

    def test_a_flip(self):
        # Mirrored: x goes to 120 - x.
        self.save(recipe(geometry={"flip_h": True}))

        self.assertEqual(self.box(self.inside), (60, 20, 90, 40))
        self.assertEqual(self.box(self.outside), (110, 1, 119, 10))

    def test_a_straightened_crop(self):
        # The 60 x 40 centre crop turned 45 degrees, shown at its own size.
        # A 20 x 20 box on the centre (60, 40) turns into a diamond whose
        # bounds reach 10 sqrt(2) = 14.142 each way from the shown centre
        # (30, 20): 15.858 to 44.142 and 5.858 to 34.142.
        centre = _face(self.photo, (50, 30, 70, 50))
        geometry = {
            "straighten": 45,
            "crop": {"cx": 0.5, "cy": 0.5, "w": 0.5, "h": 0.5},
        }

        self.save(recipe(geometry=geometry))

        self.assertEqual(self.big_thumbnail().shape, (40, 60, 3))
        self.assertEqual(self.box(centre), (16, 6, 44, 34))
        self.revert()
        self.assertEqual(self.box(centre), (50, 30, 70, 50))

    def test_a_face_found_while_edited_is_taken_back_unclamped(self):
        self.save(CROP)
        # Drawn on the cropped picture's lower left quarter (a 0 would be
        # replaced by the factory): x 31 to 60, y 40 to 60 of the unedited one.
        drawn = _face(self.photo, (1, 20, 30, 40))

        self.revert()

        self.assertEqual(self.box(drawn), (31, 40, 60, 60))

    def test_a_box_moved_while_edited_is_taken_again(self):
        self.save(CROP)
        Face.objects.filter(pk=self.inside.pk).update(
            location_left=10, location_top=10, location_right=30, location_bottom=30
        )

        self.revert()

        # (x + 30, y + 20) of the box where the user put it.
        self.assertEqual(self.box(self.inside), (40, 30, 60, 50))
        self.assertEqual(self.box(self.partial), (10, 10, 50, 40))

    def test_a_deleted_face_drops_out_of_the_map(self):
        self.save(CROP)
        stored = PhotoEdit.objects.get(pk=self.photo.pk).face_boxes
        self.assertIn(str(self.outside.pk), stored)
        Face.objects.filter(pk=self.outside.pk).delete()

        self.save(LEFT_CROP)

        stored = PhotoEdit.objects.get(pk=self.photo.pk).face_boxes
        self.assertEqual(
            sorted(stored), sorted([str(self.inside.pk), str(self.partial.pk)])
        )

    def test_a_stale_entry_is_ignored(self):
        self.save(CROP)
        edit = PhotoEdit.objects.get(pk=self.photo.pk)
        edit.face_boxes["999999"] = {"unedited": [0, 0, 1, 1], "shown": [0, 0, 60, 40]}
        edit.face_boxes[str(self.inside.pk)] = {"unedited": "broken", "shown": []}
        edit.save(update_fields=["face_boxes"])

        self.revert()

        # Taken from its box on the crop, (0, 0, 30, 20): still exact.
        self.assertEqual(self.box(self.inside), (30, 20, 60, 40))

    def test_an_exposure_edit_on_top_keeps_the_boxes(self):
        self.save(CROP)
        self.save(recipe(geometry=CROP["geometry"], light={"exposure": 1.0}))
        self.revert()
        self.assertEqual(self.box(self.outside), (1, 1, 10, 10))

    def test_regenerated_thumbnails_derive_the_boxes_again(self):
        self.save(CROP)

        render.regenerate_thumbnails(self.photo.thumbnail)

        self.assertEqual(self.box(self.outside), (0, 0, 1, 1))
        self.revert()
        self.assertEqual(self.box(self.outside), (1, 1, 10, 10))

    def test_without_a_geometry_edit_nothing_is_stored(self):
        self.save(EXPOSURE)
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).face_boxes, {})


class FaceRegionsOfAnEditedPhotoTest(EditedPhotoTestCase):
    """Regions read from the file are of the unedited picture (finding 5)."""

    def _regions(self, detected: list[Any] | None = None) -> list[Any]:
        region_info = {
            "RegionList": [
                {
                    "Type": "Face",
                    "Name": "Alice",
                    # x 30 to 60, y 20 to 40 of the 120 x 80 picture.
                    "Area": {
                        "X": 0.375,
                        "Y": 0.375,
                        "W": 0.25,
                        "H": 0.25,
                        "Unit": "normalized",
                    },
                }
            ]
        }
        path = self.photo.thumbnail.thumbnail_big.path
        with mock.patch.object(
            extractor, "get_metadata", return_value=(region_info, 1, None, None)
        ):
            return photo_faces.read_face_regions(self.photo, path, detected) or []

    def test_unedited_regions_are_placed_as_written(self):
        self.assertIsNone(
            edit_faces.region_frame(self.photo, self.photo.thumbnail.thumbnail_big.path)
        )
        # (top, right, bottom, left) on the 120 x 80 thumbnail.
        self.assertEqual(self._regions(), [(20, 60, 40, 30, "Alice")])

    def test_a_region_is_moved_onto_the_crop(self):
        self.save(CROP)
        # On the 60 x 40 crop of x 30 to 90, y 20 to 60.
        self.assertEqual(self._regions(), [(0, 30, 20, 0, "Alice")])

    def test_a_region_is_turned_with_the_picture(self):
        self.save(recipe(geometry={"orientation": 90}))
        # (x, y) to (80 - y, x) on the 80 x 120 thumbnail.
        self.assertEqual(self._regions(), [(30, 60, 60, 40, "Alice")])

    def test_detections_are_compared_on_the_same_picture(self):
        self.save(CROP)
        # The face service found the face where the region is shown.
        regions = self._regions(detected=[(0, 30, 20, 0, None)])
        self.assertEqual(regions, [(0, 30, 20, 0, "Alice")])

    def test_a_region_lands_where_a_stored_box_is(self):
        face = _face(self.photo, (30, 20, 60, 40))
        self.save(recipe(geometry={"orientation": 90, "flip_v": True}))
        face.refresh_from_db()

        (region,) = self._regions()

        top, right, bottom, left, _ = region
        self.assertEqual(
            (left, top, right, bottom),
            (
                face.location_left,
                face.location_top,
                face.location_right,
                face.location_bottom,
            ),
        )
