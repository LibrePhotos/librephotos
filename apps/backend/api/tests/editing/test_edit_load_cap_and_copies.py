"""The save's render loads a bounded source; share copies never go stale."""

from __future__ import annotations

import os
from typing import Any
from unittest import mock

from django.test import override_settings
from rest_framework.test import APIClient

from api.editing import renditions
from api.editing import source as source_module
from api.models import PhotoEdit
from api.tests.editing.edited_photo import (
    CROP,
    EXPOSURE,
    EditedPhotoTestCase,
    recipe,
)
from api.tests.utils import create_test_library_share, create_test_user

TINY_CROP = recipe(geometry={"crop": {"cx": 0.5, "cy": 0.5, "w": 0.001, "h": 0.001}})


class PreviewLoadCapTest(EditedPhotoTestCase):
    def test_a_tiny_crop_never_asks_for_more_than_the_cap(self):
        asked: list[int | None] = []
        real = source_module.load_source

        def recording(path: str, orientation: int, long_edge: int | None = None) -> Any:
            asked.append(long_edge)
            return real(path, orientation, long_edge=long_edge)

        with mock.patch.object(renditions, "load_source", side_effect=recording):
            saved = self.save(TINY_CROP)

        self.assertEqual(saved["rendition"], "pending")
        self.assertTrue(asked)
        self.assertTrue(all(edge is not None for edge in asked), asked)
        self.assertLessEqual(
            max(edge or 0 for edge in asked), renditions.PREVIEW_LOAD_CAP
        )

    def test_a_large_crop_still_loads_what_it_needs(self):
        asked: list[int | None] = []
        real = source_module.load_source

        def recording(path: str, orientation: int, long_edge: int | None = None) -> Any:
            asked.append(long_edge)
            return real(path, orientation, long_edge=long_edge)

        with mock.patch.object(renditions, "load_source", side_effect=recording):
            self.save(CROP)

        self.assertEqual(asked, [renditions.PREVIEW_LONG_EDGE_CAP * 2])


@override_settings(SERVE_FRONTEND=True)
class StaleCopyTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        self.recipient = APIClient()
        self.recipient.force_authenticate(user=recipient)
        self.copies = os.path.join(self.media, "library_copies", str(self.owner.pk))
        self.media_url = f"/media/photos/{self.photo.image_hash}"

    def fetch(self) -> None:
        response = self.recipient.get(self.media_url)
        self.assertEqual(response.status_code, 200)
        # Read and closed: on Windows an open file cannot be deleted.
        if response.streaming:
            b"".join(response.streaming_content)
        response.close()

    def test_a_copy_finished_during_a_save_or_revert_is_cleared_on_commit(self):
        real_touch = renditions._touch
        late_copy = os.path.join(self.copies, self.photo.image_hash + ".jpg")

        def copy_lands_then_touch(photo: Any) -> None:
            # A copy another request was making lands after the thumbnails
            # (and the copies with them) were made again.
            os.makedirs(self.copies, exist_ok=True)
            with open(late_copy, "wb") as handle:
                handle.write(b"the picture before")
            real_touch(photo)

        for name, change in (
            ("first save", lambda: self.save(CROP)),
            ("another save", lambda: self.save(EXPOSURE)),
            ("identity save", lambda: self.save(recipe(), history=[], cursor=-1)),
            ("revert", self.delete_edit),
        ):
            with self.subTest(name):
                with mock.patch.object(
                    renditions, "_touch", side_effect=copy_lands_then_touch
                ):
                    change()
                self.assertEqual(os.listdir(self.copies), [])

    def test_a_copy_finished_after_the_clear_is_never_served(self):
        # A copy of the original being made while the save ran lands after
        # the copies were cleared: it is named for the original, and the
        # edited photo's copies have names of their own.
        self.save(CROP)
        self.run_queued()
        self.fetch()
        (edited_copy,) = os.listdir(self.copies)
        self.assertIn(".edit1.", edited_copy)
        stale = os.path.join(self.copies, self.photo.image_hash + ".jpg")
        with open(stale, "wb") as handle:
            handle.write(b"not this one")

        self.fetch()

        self.assertEqual(
            sorted(os.listdir(self.copies)),
            sorted([edited_copy, self.photo.image_hash + ".jpg"]),
        )
        self.assertEqual(PhotoEdit.objects.get(pk=self.photo.pk).version, 1)
