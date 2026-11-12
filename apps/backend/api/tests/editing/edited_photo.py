"""A photo with a real picture on disk and real thumbnails, for the edit tests.

The picture is 120 x 80 pixels of four flat quadrants, so the big thumbnail
(never larger than the picture) is 120 x 80 too and a crop or a turn can be
checked by its colours. ``MEDIA_ROOT`` is a directory of the test's own.
"""

from __future__ import annotations

import io
import os
import shutil
import tempfile
from typing import Any
from unittest import mock

import numpy as np
import PIL.Image
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.editing import renditions
from api.models import Photo, User
from api.tests.utils import create_test_file, create_test_photo, create_test_user
from api.thumbnails import render

WIDTH, HEIGHT = 120, 80
# Top left, top right, bottom left, bottom right.
QUADRANTS = ((220, 30, 30), (30, 200, 30), (30, 30, 220), (230, 230, 40))


def quadrants(width: int = WIDTH, height: int = HEIGHT) -> np.ndarray:
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    half_w, half_h = width // 2, height // 2
    pixels[:half_h, :half_w] = QUADRANTS[0]
    pixels[:half_h, half_w:] = QUADRANTS[1]
    pixels[half_h:, :half_w] = QUADRANTS[2]
    pixels[half_h:, half_w:] = QUADRANTS[3]
    return pixels


def jpeg_bytes(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    PIL.Image.fromarray(pixels).save(buffer, "JPEG", quality=95, subsampling=0)
    return buffer.getvalue()


def read_pixels(path: str) -> np.ndarray:
    """A picture file's pixels, read from bytes (no handle stays open on Windows)."""
    with open(path, "rb") as handle:
        data = handle.read()
    with PIL.Image.open(io.BytesIO(data)) as image:
        return np.asarray(image.convert("RGB")).copy()


def colour_at(pixels: np.ndarray, u: float, v: float) -> tuple[int, ...]:
    """The colour at a normalised position."""
    height, width = pixels.shape[:2]
    return tuple(int(c) for c in pixels[int(v * height), int(u * width)])


def close(a: tuple[int, ...], b: tuple[int, ...], tolerance: int = 24) -> bool:
    return all(abs(x - y) <= tolerance for x, y in zip(a, b, strict=True))


def recipe(**groups: Any) -> dict[str, Any]:
    return {"version": 1, **groups}


def body(
    settings: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
    cursor: int | None = None,
) -> dict[str, Any]:
    """A PUT body whose history is the one step to ``settings`` unless given."""
    if history is None:
        history = [
            {"action": "set", "at": "2026-11-12T09:30:00Z", "settings": settings}
        ]
    if cursor is None:
        cursor = len(history) - 1
    return {"settings": settings, "history": history, "history_cursor": cursor}


EXPOSURE = recipe(light={"exposure": 1.0})
CROP = recipe(geometry={"crop": {"cx": 0.5, "cy": 0.5, "w": 0.5, "h": 0.5}})


class EditedPhotoTestCase(TestCase):
    """An owner, their photo of ``quadrants()`` with its thumbnails made, a client.

    The background render is not queued: ``self.queued`` collects its
    arguments, and ``run_queued()`` runs it as the worker would.
    """

    def setUp(self) -> None:
        super().setUp()
        self.media = tempfile.mkdtemp(prefix="librephotos-edits")
        self.addCleanup(shutil.rmtree, self.media, True)
        for directory in ("thumbnails_big", "square_thumbnails"):
            os.makedirs(os.path.join(self.media, directory))
        overridden = override_settings(MEDIA_ROOT=self.media)
        overridden.enable()
        self.addCleanup(overridden.disable)
        self.queued: list[tuple[Any, ...]] = []
        patcher = mock.patch.object(
            renditions,
            "enqueue_task",
            side_effect=lambda func, *args: self.queued.append(args),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.owner = create_test_user()
        self.photo = self.make_photo(self.owner, jpeg_bytes(quadrants()), "picture.jpg")
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def make_photo(
        self,
        owner: User,
        content: bytes,
        name: str,
        thumbnails: bool = True,
        **fields: Any,
    ) -> Photo:
        directory = os.path.join(self.media, "library", str(owner.pk))
        os.makedirs(directory, exist_ok=True)
        main_file = create_test_file(os.path.join(directory, name), owner, content)
        photo = create_test_photo(owner=owner, main_file=main_file, **fields)
        if thumbnails and not photo.video:
            render.generate_thumbnail(photo.thumbnail)
        return photo

    def big_thumbnail(self, photo: Photo | None = None) -> np.ndarray:
        photo = photo or self.photo
        return read_pixels(
            os.path.join(self.media, "thumbnails_big", photo.image_hash + ".webp")
        )

    def url(self, photo: Photo | None = None) -> str:
        return f"/api/photos/{(photo or self.photo).pk}/edit/"

    def put(self, data: dict[str, Any], photo: Photo | None = None) -> Any:
        """PUT ``data``, its commit callbacks run (files removed, render queued)."""
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.put(self.url(photo), data, format="json")

    def save(self, settings: dict[str, Any], **kwargs: Any) -> Any:
        response = self.put(body(settings, **kwargs))
        self.assertEqual(response.status_code, 200, response.content[:500])
        return response.json()

    def delete_edit(self) -> Any:
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.delete(self.url())

    def run_queued(self) -> None:
        queued, self.queued = self.queued, []
        for args in queued:
            with self.captureOnCommitCallbacks(execute=True):
                renditions.render_rendition(*args)
