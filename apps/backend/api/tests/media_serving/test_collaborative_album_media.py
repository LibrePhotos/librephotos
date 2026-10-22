"""The original of a contributor's photo in a collaborative album (#464).

A member gets the original file only where both the album's owner and the
photo's owner allow original files; otherwise the full-size copy without
metadata that a shared library hands out (#2731), checked with the real
ExifTool: the original's GPS position and camera must not be in it. A
stranger gets neither.
"""

import json
import os
import shutil
import tempfile
from unittest.mock import patch

import pyvips
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.albums import members
from api.models import AlbumRole, Photo
from api.runtime import binaries
from api.sharing.copies import COPIES_DIR, delete_copies
from api.tests.utils import (
    create_test_album_user,
    create_test_file,
    create_test_photo,
    create_test_user,
)


def _client(user):
    # The media view reads the raw jwt cookie, as <img> and <video> send it.
    client = APIClient()
    client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


def _tags(path):
    process = binaries.run_tool(
        "exiftool", ["-j", "-n", "-G1", "-a", path], timeout=60, text=True
    )
    return json.loads(process.stdout)[0]


class ContributorOriginalTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix="lp-464-media-")
        self.addCleanup(shutil.rmtree, self.media_root, True)
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        self.anna = create_test_user()
        self.ben = create_test_user()
        self.clara = create_test_user()
        self.mallory = create_test_user()
        source = os.path.join(self.media_root, "originals", "ben-gps.jpg")
        os.makedirs(os.path.dirname(source))
        pyvips.Image.black(64, 48).write_to_file(source)
        binaries.run_tool(
            "exiftool",
            [
                "-overwrite_original",
                "-GPSLatitude=52.52",
                "-GPSLatitudeRef=N",
                "-GPSLongitude=13.40",
                "-GPSLongitudeRef=E",
                "-Model=BenSecretCam",
                source,
            ],
            timeout=60,
        )
        with open(source, "rb") as handle:
            main_file = create_test_file(source, self.ben, handle.read())
        self.photo = create_test_photo(owner=self.ben, main_file=main_file)
        self.addCleanup(delete_copies, self.photo.image_hash)
        self.album = create_test_album_user(owner=self.anna)
        members.set_member_role(self.album, self.ben, AlbumRole.CONTRIBUTOR)
        members.set_member_role(self.album, self.clara, AlbumRole.VIEWER)
        members.add_photos(self.album, self.ben, Photo.objects.filter(pk=self.photo.pk))
        self.url = f"/media/photos/{self.photo.image_hash}"

    def test_without_originals_a_member_gets_the_copy_without_metadata(self):
        response = _client(self.clara).get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/{COPIES_DIR}/{self.ben.pk}/{self.photo.image_hash}.jpg",
        )
        copy = os.path.join(
            self.media_root,
            COPIES_DIR,
            str(self.ben.pk),
            f"{self.photo.image_hash}.jpg",
        )
        tags = json.dumps(_tags(copy))
        self.assertNotIn("GPSLatitude", tags)
        self.assertNotIn("BenSecretCam", tags)

    def test_with_both_switches_a_member_gets_the_original(self):
        members.update_switches(
            self.album.memberships.get(user=self.ben), {"share_originals": True}
        )
        response = _client(self.clara).get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(COPIES_DIR, response["X-Accel-Redirect"])

    def test_a_stranger_and_a_revoked_album_get_nothing(self):
        self.assertEqual(_client(self.mallory).get(self.url).status_code, 404)
        members.set_member_role(self.album, self.ben, AlbumRole.VIEWER)
        self.assertEqual(_client(self.clara).get(self.url).status_code, 404)

    def test_new_copies_are_counted_per_member(self):
        cache.clear()
        with patch("api.sharing.copies.COPIES_PER_HOUR", 0):
            response = _client(self.clara).get(self.url)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "30")
