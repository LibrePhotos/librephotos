"""``/media/photos/<image_hash>`` of an edited photo: its rendition, or ``?original=1``."""

from __future__ import annotations

import io
import os

import PIL.Image
from django.test import override_settings

from api.editing import files
from api.tests.editing.edited_photo import CROP, HEIGHT, WIDTH, EditedPhotoTestCase
from api.tests.utils import create_test_library_share, create_test_user


def _size(content: bytes) -> tuple[int, int]:
    with PIL.Image.open(io.BytesIO(content)) as image:
        return image.size


def _content(response: object) -> bytes:
    return (
        b"".join(response.streaming_content) if response.streaming else response.content
    )


class RenditionServingTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.media_url = f"/media/photos/{self.photo.image_hash}"
        self.save(CROP)

    @override_settings(SERVE_FRONTEND=True)
    def test_the_original_until_the_rendition_is_ready(self):
        response = self.client.get(self.media_url)
        self.assertEqual(_size(_content(response)), (WIDTH, HEIGHT))

    @override_settings(SERVE_FRONTEND=True)
    def test_served_directly(self):
        self.run_queued()

        edited = self.client.get(self.media_url)
        original = self.client.get(self.media_url + "?original=1")

        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited["Content-Type"], "image/jpeg")
        self.assertEqual(_size(_content(edited)), (60, 40))
        self.assertEqual(_size(_content(original)), (WIDTH, HEIGHT))

    @override_settings(SERVE_FRONTEND=False)
    def test_served_by_the_proxy(self):
        self.run_queued()

        edited = self.client.get(self.media_url)
        original = self.client.get(self.media_url + "?original=1")

        self.assertEqual(edited["Content-Type"], "image/jpeg")
        self.assertEqual(
            edited["X-Accel-Redirect"],
            f"/protected_media/{files.EDITS_DIR}/{self.photo.image_hash}.jpg",
        )
        self.assertTrue(original["X-Accel-Redirect"].endswith("picture.jpg"))

    @override_settings(SERVE_FRONTEND=True)
    def test_a_share_without_originals_gets_a_copy_of_the_rendition(self):
        self.run_queued()
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        self.client.force_authenticate(user=recipient)

        response = self.client.get(self.media_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_size(_content(response)), (60, 40))

    @override_settings(SERVE_FRONTEND=True)
    def test_a_new_save_drops_the_copies(self):
        self.run_queued()
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        self.client.force_authenticate(user=recipient)
        # Read and closed: on Windows an open file cannot be deleted.
        served = self.client.get(self.media_url)
        _content(served)
        served.close()
        copies = os.path.join(self.media, "library_copies", str(self.owner.pk))
        self.assertEqual(len(os.listdir(copies)), 1)

        self.client.force_authenticate(user=self.owner)
        self.save({"version": 1})

        self.assertEqual(os.listdir(copies), [])
