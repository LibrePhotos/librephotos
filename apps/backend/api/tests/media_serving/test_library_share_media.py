"""Media of a shared library (#2731): what ``/media/`` serves a recipient.

Thumbnails and posters always (they carry no metadata). The original file
only with "Download original files" on; otherwise a full-size copy without
metadata, checked here with the real ExifTool and ffmpeg: the original's GPS
position must not be in it. Revoking a share ends media access at once.
"""

import json
import os
import shutil
import tempfile

import pyvips
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.runtime import binaries
from api.sharing.copies import COPIES_DIR, delete_copies
from api.tests.utils import (
    create_test_file,
    create_test_library_share,
    create_test_photo,
    create_test_user,
)

GPS_TAGS = ("GPSLatitude", "GPSLongitude", "GPSPosition", "GPSCoordinates")


def _exiftool_json(path):
    process = binaries.run_tool(
        "exiftool", ["-j", "-n", "-G1", "-a", path], timeout=60, text=True
    )
    return json.loads(process.stdout)[0]


def _has_gps(tags):
    return any(name.split(":")[-1] in GPS_TAGS for name in tags) or any(
        "location" in name.lower() for name in tags
    )


def client_for(user):
    # The media view reads the raw jwt cookie, as <img> and <video> send it.
    client = APIClient()
    client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


class LibraryMediaTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix="lp-2731-media-")
        self.addCleanup(shutil.rmtree, self.media_root, True)
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.stranger = create_test_user()
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
            content = handle.read()
        main_file = create_test_file(source, self.owner, content)
        self.photo = create_test_photo(owner=self.owner, main_file=main_file)
        self.hidden = create_test_photo(owner=self.owner, hidden=True)
        self.share = create_test_library_share(
            owner=self.owner, recipient=self.recipient
        )
        self.addCleanup(delete_copies, self.photo.image_hash)

    def test_thumbnails_are_served_to_the_recipient_only(self):
        url = f"/media/thumbnails_big/{self.photo.image_hash}"
        response = client_for(self.recipient).get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("thumbnails_big", response["X-Accel-Redirect"])
        self.assertEqual(client_for(self.stranger).get(url).status_code, 404)

    def test_a_hidden_photo_is_not_served(self):
        url = f"/media/thumbnails_big/{self.hidden.image_hash}"
        self.assertEqual(client_for(self.recipient).get(url).status_code, 404)

    def test_without_originals_the_download_is_a_copy_without_metadata(self):
        self.assertTrue(_has_gps(_exiftool_json(self.photo.main_file.path)))
        response = client_for(self.recipient).get(
            f"/media/photos/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/{COPIES_DIR}/{self.photo.image_hash}.jpg",
        )
        self.assertNotIn("Content-Disposition", response)
        copy = os.path.join(self.media_root, COPIES_DIR, f"{self.photo.image_hash}.jpg")
        tags = _exiftool_json(copy)
        self.assertFalse(_has_gps(tags), tags)
        self.assertNotIn("SecretCam", json.dumps(tags))
        self.assertEqual(tags.get("File:ImageWidth"), 64)

    def test_with_originals_the_original_is_served_without_its_name(self):
        self.share.share_originals = True
        self.share.save()
        response = client_for(self.recipient).get(
            f"/media/photos/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("with-gps.jpg", response["X-Accel-Redirect"])
        self.assertNotIn("Content-Disposition", response)

    def test_revoking_ends_media_access_at_once(self):
        client = client_for(self.recipient)
        urls = [
            f"/media/thumbnails_big/{self.photo.image_hash}",
            f"/media/photos/{self.photo.image_hash}",
        ]
        for url in urls:
            self.assertEqual(client.get(url).status_code, 200, url)
        self.share.delete()
        for url in urls:
            self.assertEqual(client.get(url).status_code, 404, url)

    def test_a_still_has_no_video_file_to_serve(self):
        response = client_for(self.recipient).get(
            f"/media/video/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 404)

    def test_the_recipient_gets_no_embedded_motion_video_without_originals(self):
        response = client_for(self.recipient).get(
            f"/media/embedded_media/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 404)


@override_settings(SERVE_FRONTEND=True)
class LibraryVideoCopyTest(TestCase):
    """A video's copy is remuxed without the recorded location (direct mode)."""

    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix="lp-2731-video-")
        self.addCleanup(shutil.rmtree, self.media_root, True)
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.owner = create_test_user()
        self.recipient = create_test_user()
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
            content = handle.read()
        main_file = create_test_file(source, self.owner, content)
        self.photo = create_test_photo(
            owner=self.owner, main_file=main_file, video=True
        )
        self.share = create_test_library_share(
            owner=self.owner, recipient=self.recipient
        )
        self.addCleanup(delete_copies, self.photo.image_hash)

    def test_the_video_path_plays_the_copy_or_the_original(self):
        client = client_for(self.recipient)
        copy = os.path.join(self.media_root, COPIES_DIR, f"{self.photo.image_hash}.mp4")
        response = client.get(f"/media/video/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertTrue(os.path.exists(copy))
        delete_copies(self.photo.image_hash)
        self.share.share_originals = True
        self.share.save()
        response = client.get(f"/media/video/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        response.close()
        # The original itself: no copy made.
        self.assertFalse(os.path.exists(copy))

    def test_a_conversion_is_never_served_without_originals(self):
        # A cached conversion made before conversions dropped the metadata
        # still carries the location: the copy is served instead.
        self.recipient.transcode_videos = True
        self.recipient.save()
        response = client_for(self.recipient).get(
            f"/media/photos/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 200)
        response.close()
        copy = os.path.join(self.media_root, COPIES_DIR, f"{self.photo.image_hash}.mp4")
        self.assertTrue(os.path.exists(copy))

    def test_the_copy_has_no_location(self):
        self.assertTrue(_has_gps(_exiftool_json(self.photo.main_file.path)))
        response = client_for(self.recipient).get(
            f"/media/photos/{self.photo.image_hash}"
        )
        self.assertEqual(response.status_code, 200)
        response.close()
        copy = os.path.join(self.media_root, COPIES_DIR, f"{self.photo.image_hash}.mp4")
        self.assertTrue(os.path.exists(copy))
        tags = _exiftool_json(copy)
        self.assertFalse(_has_gps(tags), tags)
