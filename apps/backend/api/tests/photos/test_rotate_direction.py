"""Which way ``POST /api/photosedit/rotate/`` turns a photo (#2595).

A positive ``angle`` turns the photo counter-clockwise as LibrePhotos shows
it, a negative one clockwise. The web app's clockwise button sends ``-90``
and every other client depends on the same sign, so this pins it against the
rendered thumbnail rather than the stored orientation code.
"""

import os
import shutil
import tempfile

import PIL.Image
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from api.models.photo import Photo
from api.models.user import User
from api.photos.media_files import get_or_create_file
from api.tests.metadata.exiftool_harness import (
    HEIGHT,
    QUADRANTS,
    STORED_LAYOUT,
    WIDTH,
    layout,
    load,
    media_root,
)
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails.render import generate_thumbnail

# Quadrant colours left to right, top to bottom, after the photo is shown.
UPRIGHT = ("landscape", "red", "green", "blue", "white")
TURNED_COUNTER_CLOCKWISE = ("portrait", "green", "white", "red", "blue")
TURNED_CLOCKWISE = ("portrait", "blue", "red", "white", "green")
TURNED_HALF = ("landscape", "white", "blue", "green", "red")


class RotateDirectionTest(APITestCase):
    def setUp(self):
        self.library = tempfile.mkdtemp(prefix="librephotos-rotate-")
        self.addCleanup(shutil.rmtree, self.library, True)
        settings = override_settings(MEDIA_ROOT=media_root(self.library))
        settings.enable()
        self.addCleanup(settings.disable)
        self.user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = self._photo()

    def _photo(self):
        path = os.path.join(self.library, "photo.jpg")
        image = PIL.Image.new("RGB", (WIDTH, HEIGHT))
        half_w, half_h = WIDTH // 2, HEIGHT // 2
        for index, colour in enumerate(STORED_LAYOUT):
            left, top = (index % 2) * half_w, (index // 2) * half_h
            image.paste(QUADRANTS[colour], (left, top, left + half_w, top + half_h))
        image.save(path)
        photo = create_test_photo(owner=self.user)
        photo.main_file = get_or_create_file(path, self.user)
        photo.save()
        generate_thumbnail(photo.thumbnail)
        return Photo.objects.get(pk=photo.pk)

    def _shown(self):
        photo = Photo.objects.get(pk=self.photo.pk)
        return layout(load(photo.thumbnail.thumbnail_big.path))

    def _rotate(self, angle):
        response = self.client.post(
            "/api/photosedit/rotate/",
            {"image_hash": self.photo.image_hash, "angle": angle},
            format="json",
        )
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def test_positive_angle_turns_counter_clockwise(self):
        self.assertEqual(UPRIGHT, self._shown())

        answer = self._rotate(90)

        self.assertEqual(TURNED_COUNTER_CLOCKWISE, self._shown())
        self.assertEqual(6, answer["local_orientation"])

    def test_negative_angle_turns_clockwise(self):
        answer = self._rotate(-90)

        self.assertEqual(TURNED_CLOCKWISE, self._shown())
        self.assertEqual(8, answer["local_orientation"])

    def test_turns_compose(self):
        self._rotate(90)
        self._rotate(90)
        self.assertEqual(TURNED_HALF, self._shown())

        self._rotate(-90)
        self.assertEqual(TURNED_COUNTER_CLOCKWISE, self._shown())
