"""Media of public photos follow the owner's public sharing switches.

An original file carries its GPS position, camera, capture time, keywords and
the names of people inside it. A visitor of a public photo, a public album or
a photo link gets the untouched original only when every public sharing
switch is on; otherwise the full-size copy without metadata that a library
recipient gets (``api.sharing.copies``), checked here with the real ExifTool
and ffmpeg. Thumbnails carry no metadata and are always served.
"""

import json
import os
import shutil
import tempfile

import pyvips
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.models.photo_share import PhotoShare
from api.models.user import get_default_public_sharing_settings
from api.runtime import binaries
from api.sharing.copies import COPIES_DIR, delete_copies
from api.tests.media_serving.test_library_share_media import (
    _exiftool_json,
    _has_gps,
    client_for,
)
from api.tests.utils import (
    create_test_album_user,
    create_test_file,
    create_test_photo,
    create_test_user,
)

ALL_SWITCHES = dict.fromkeys(get_default_public_sharing_settings(), True)


class MediaRootMixin:
    def use_media_root(self, prefix):
        self.media_root = tempfile.mkdtemp(prefix=prefix)
        self.addCleanup(shutil.rmtree, self.media_root, True)
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

    def copy_path(self, photo, extension):
        return os.path.join(
            self.media_root,
            COPIES_DIR,
            str(photo.owner_id),
            f"{photo.image_hash}{extension}",
        )

    def switch_on(self, owner, **switches):
        settings = get_default_public_sharing_settings()
        settings.update(switches)
        owner.public_sharing_defaults = settings
        owner.save()


class PublicStillTest(MediaRootMixin, TestCase):
    def setUp(self):
        self.use_media_root("lp-public-media-")
        self.owner = create_test_user(public_sharing=True)
        source = os.path.join(self.media_root, "originals", "with-gps.jpg")
        os.makedirs(os.path.dirname(source))
        pyvips.Image.black(64, 48).write_to_file(source)
        binaries.run_tool(
            "exiftool",
            [
                "-overwrite_original",
                "-GPSLatitude=47.99",
                "-GPSLatitudeRef=N",
                "-GPSLongitude=11.34",
                "-GPSLongitudeRef=E",
                "-Model=SecretCam",
                source,
            ],
            timeout=60,
        )
        with open(source, "rb") as handle:
            main_file = create_test_file(source, self.owner, handle.read())
        self.photo = create_test_photo(owner=self.owner, main_file=main_file)
        self.addCleanup(delete_copies, self.photo.image_hash)
        self.readers = {
            "anonymous": APIClient(),
            "signed in": client_for(create_test_user()),
        }

    def make_public(self):
        self.photo.public = True
        self.photo.save()

    def put_in_public_album(self, **switches):
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo)
        return AlbumUserShare.objects.create(  # raw-create: a public link
            album=album, enabled=True, **switches
        )

    def assert_copy_served(self, client):
        response = client.get(f"/media/photos/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/{COPIES_DIR}/{self.owner.pk}/{self.photo.image_hash}.jpg",
        )
        tags = _exiftool_json(self.copy_path(self.photo, ".jpg"))
        self.assertFalse(_has_gps(tags), tags)
        self.assertNotIn("SecretCam", json.dumps(tags))

    def test_a_public_photo_is_downloaded_without_its_metadata(self):
        self.assertTrue(_has_gps(_exiftool_json(self.photo.main_file.path)))
        self.make_public()
        for name, client in self.readers.items():
            with self.subTest(name):
                self.assert_copy_served(client)

    def test_a_public_album_photo_is_downloaded_without_its_metadata(self):
        self.put_in_public_album()
        for name, client in self.readers.items():
            with self.subTest(name):
                self.assert_copy_served(client)

    def test_every_switch_on_serves_the_original(self):
        self.make_public()
        self.switch_on(self.owner, **ALL_SWITCHES)
        response = APIClient().get(f"/media/photos/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("with-gps.jpg", response["X-Accel-Redirect"])

    def test_one_switch_off_keeps_the_original_back(self):
        switches = {**ALL_SWITCHES, "share_faces": False}
        self.make_public()
        self.switch_on(self.owner, **switches)
        self.assert_copy_served(APIClient())

    def test_an_album_with_every_switch_on_serves_the_original(self):
        self.put_in_public_album(**ALL_SWITCHES)
        response = APIClient().get(f"/media/photos/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("with-gps.jpg", response["X-Accel-Redirect"])

    def test_thumbnails_are_still_served(self):
        self.make_public()
        response = APIClient().get(f"/media/thumbnails_big/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("thumbnails_big", response["X-Accel-Redirect"])

    def test_the_owner_still_gets_the_original(self):
        self.make_public()
        response = client_for(self.owner).get(f"/media/photos/{self.photo.image_hash}")
        self.assertIn("with-gps.jpg", response["X-Accel-Redirect"])

    def test_the_motion_video_comes_out_of_the_original(self):
        clip = os.path.join(self.media_root, "originals", "motion.mp4")
        with open(clip, "wb") as handle:
            handle.write(b"not really a video")
        assert self.photo.main_file is not None
        self.photo.main_file.embedded_media.add(
            create_test_file(clip, self.owner, b"not really a video")
        )
        self.make_public()
        url = f"/media/embedded_media/{self.photo.image_hash}"
        self.assertEqual(APIClient().get(url).status_code, 403)
        self.switch_on(self.owner, **ALL_SWITCHES)
        self.assertEqual(APIClient().get(url).status_code, 200)


@override_settings(SERVE_FRONTEND=True)
class PublicVideoTest(MediaRootMixin, TestCase):
    """A video plays from its copy without the recorded location (direct mode)."""

    def setUp(self):
        self.use_media_root("lp-public-video-")
        self.owner = create_test_user(public_sharing=True)
        source = os.path.join(self.media_root, "clip.mp4")
        binaries.run_tool(
            "ffmpeg",
            [
                "-nostdin",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=64x48:rate=5:duration=1",
                "-metadata",
                "location=+47.9900+011.3400/",
                "-pix_fmt",
                "yuv420p",
                source,
            ],
            timeout=120,
        )
        with open(source, "rb") as handle:
            main_file = create_test_file(source, self.owner, handle.read())
        self.photo = create_test_photo(
            owner=self.owner, main_file=main_file, video=True, public=True
        )
        self.addCleanup(delete_copies, self.photo.image_hash)

    def assert_plays_the_copy(self, url):
        response = APIClient().get(url)
        self.assertEqual(response.status_code, 200)
        response.close()
        copy = self.copy_path(self.photo, ".mp4")
        self.assertTrue(os.path.exists(copy), url)
        self.assertFalse(_has_gps(_exiftool_json(copy)))
        delete_copies(self.photo.image_hash)

    def test_a_public_video_plays_without_its_location(self):
        self.assertTrue(_has_gps(_exiftool_json(self.photo.main_file.path)))
        for url in (
            f"/media/video/{self.photo.image_hash}",
            f"/media/photos/{self.photo.image_hash}",
        ):
            with self.subTest(url):
                self.assert_plays_the_copy(url)

    def test_a_video_link_plays_without_its_location(self):
        link = PhotoShare.objects.create(photo=self.photo, enabled=True)
        self.assert_plays_the_copy(f"/api/public/photo/{link.slug}/media/video/")

    def test_every_switch_on_plays_the_original(self):
        self.switch_on(self.owner, **ALL_SWITCHES)
        response = APIClient().get(f"/media/video/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertFalse(os.path.exists(self.copy_path(self.photo, ".mp4")))
