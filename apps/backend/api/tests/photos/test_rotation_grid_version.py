from __future__ import annotations

from typing import Any

import numpy as np
from rest_framework.test import APIRequestFactory

from api.models import Photo
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.tests.editing.edited_photo import CROP, EditedPhotoTestCase, jpeg_bytes
from api.tests.utils import create_test_album_auto, create_test_photo_edit
from api.thumbnails import render


def flat(width: int, height: int) -> np.ndarray:
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    pixels[:, :] = (90, 140, 200)
    return pixels


def grid_key(row: dict[str, Any]) -> str:
    version = row.get("thumbnail_version")
    return f"{row.get('thumbhash') or ''}{f':{version}' if version else ''}"


class RotationGridVersionTest(EditedPhotoTestCase):
    def summary(self, photo: Photo | None = None) -> dict[str, Any]:
        request = APIRequestFactory().get("/")
        request.user = self.owner
        loaded = with_photo_summary_relations(
            Photo.objects.filter(pk=(photo or self.photo).pk)
        )
        return dict(
            PhotoSummarySerializer(
                loaded, many=True, context={"request": request}
            ).data[0]
        )

    def rotate(self, angle: int, photo: Photo | None = None) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/photosedit/rotate/",
                {"image_hash": (photo or self.photo).image_hash, "angle": angle},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.content[:300])

    def test_a_quarter_turn_gives_the_grid_a_new_thumbhash_and_key(self):
        before = self.summary()

        self.rotate(-90)

        after = self.summary()
        self.photo.thumbnail.refresh_from_db()
        self.assertIsNotNone(after["thumbhash"])
        self.assertNotEqual(after["thumbhash"], before["thumbhash"])
        self.assertEqual(after["thumbhash"], self.photo.thumbnail.thumbhash)
        self.assertNotEqual(grid_key(after), grid_key(before))

    def test_a_picture_that_looks_the_same_turned_still_gets_a_new_key(self):
        photo = self.make_photo(self.owner, jpeg_bytes(flat(80, 80)), "sky.jpg")
        render.calculate_thumbhash(photo.thumbnail)
        keys = [grid_key(self.summary(photo))]
        hashes = [self.summary(photo)["thumbhash"]]

        for angle in (-90, -90, 180, -90):
            self.rotate(angle, photo)
            row = self.summary(photo)
            keys.append(grid_key(row))
            hashes.append(row["thumbhash"])

        self.assertEqual(len(set(hashes)), 1)
        self.assertEqual(len(set(keys)), len(keys))

    def test_turning_an_edited_photo_gives_a_new_key(self):
        self.save(CROP)
        before = self.summary()

        self.rotate(-90)

        after = self.summary()
        self.assertGreater(after["thumbnail_version"], before["thumbnail_version"])
        self.assertNotEqual(grid_key(after), grid_key(before))

    def test_an_identity_edit_turns_with_a_new_key(self):
        photo = self.make_photo(self.owner, jpeg_bytes(flat(80, 80)), "flat.jpg")
        create_test_photo_edit(photo)
        before = self.summary(photo)

        self.rotate(90, photo)

        self.assertNotEqual(grid_key(self.summary(photo)), grid_key(before))

    def test_every_rebuild_raises_the_version_and_a_first_build_does_not(self):
        photo = self.make_photo(self.owner, jpeg_bytes(flat(80, 80)), "same.jpg")
        first = self.summary(photo)["thumbnail_version"]

        render.regenerate_thumbnails(photo.thumbnail, keep_old_on_failure=True)
        render.regenerate_thumbnails(photo.thumbnail)

        self.assertEqual(first, 0)
        self.assertEqual(self.summary(photo)["thumbnail_version"], 2)

    def test_an_event_grid_gets_the_same_version(self):
        photo = self.make_photo(self.owner, jpeg_bytes(flat(80, 80)), "event.jpg")
        album = create_test_album_auto(self.owner)
        album.photos.add(photo)
        self.rotate(-90, photo)

        response = self.client.get(f"/api/albums/auto/{album.pk}/")

        self.assertEqual(response.status_code, 200, response.content[:300])
        (tile,) = response.json()["photos"]
        self.assertEqual(tile["thumbnail_version"], 1)
        self.assertEqual(grid_key(tile), grid_key(self.summary(photo)))
