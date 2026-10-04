"""Thumbnails carry none of the original's metadata, only its colour profile.

libvips copies EXIF and XMP into what it writes, so a thumbnail used to carry
the photo's GPS position and camera serial number, and a public photo link
(which serves only the big thumbnail) handed them to anyone holding it.
"""

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from io import StringIO
from unittest import mock

import numpy as np
import pyvips
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings
from PIL import Image, ImageCms

from api import binaries, thumbnails
from api.thumbnail_metadata import (
    strip_thumbnail_metadata,
    strip_webp_metadata,
    webp_has_metadata,
)
from api.thumbnails import (
    WEBP,
    _reorient_file_in_place,
    _render_raw_thumbnail,
    _render_thumbnail,
    create_animated_thumbnail,
    create_static_thumbnails,
    create_thumbnail_for_video,
)

ALL_SIZES = ["thumbnails_big", "square_thumbnails", "square_thumbnails_small"]
SRGB_ICC = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
XMP = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" '
    b'dc:title="secret"/></rdf:RDF></x:xmpmeta>'
)


def _gps_jpeg(path, icc=None):
    """A JPEG with GPS, a camera serial number and XMP, like a phone photo."""
    pixels = np.zeros((900, 1200, 3), dtype=np.uint8)
    pixels[:, :600] = (200, 60, 30)
    pixels[300:, :, 2] = 220
    exif = Image.Exif()
    exif[0x0110] = "Leaky 1"  # Model
    exif.get_ifd(0x8769)[0xA431] = "SN-123456"  # BodySerialNumber
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (48.0, 51.0, 30.24)
    gps[3], gps[4] = "E", (2.0, 17.0, 40.2)
    kwargs = {"exif": exif.tobytes(), "xmp": XMP, "quality": 92}
    if icc:
        kwargs["icc_profile"] = icc
    Image.fromarray(pixels).save(path, "JPEG", **kwargs)


def _load(path):
    # From bytes: on Windows libvips keeps an opened file open.
    with open(path, "rb") as handle:
        return pyvips.Image.new_from_buffer(handle.read(), "")


def _metadata_fields(image):
    return [f for f in image.get_fields() if f.startswith(("exif-", "xmp-", "iptc-"))]


def _icc(image):
    if "icc-profile-data" not in image.get_fields():
        return None
    return image.get("icc-profile-data")


class MediaRootTestCase(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp(prefix="librephotos-thumbmeta")
        self.addCleanup(shutil.rmtree, self.media, True)
        for directory in ALL_SIZES:
            os.makedirs(os.path.join(self.media, directory))
        self.source = os.path.join(self.media, "photo.jpg")
        _gps_jpeg(self.source)
        settings = override_settings(MEDIA_ROOT=self.media)
        settings.enable()
        self.addCleanup(settings.disable)

    def path(self, directory, name="h.webp"):
        return os.path.join(self.media, directory, name)


class GeneratedThumbnailMetadataTest(MediaRootTestCase):
    def test_source_carries_the_metadata(self):
        # Guards the other tests: they prove nothing if the fixture has no GPS.
        fields = pyvips.Image.new_from_file(self.source).get_fields()
        self.assertIn("exif-ifd3-GPSLatitude", fields)
        self.assertIn("xmp-data", fields)

    def test_static_thumbnails_have_no_exif_or_xmp(self):
        create_static_thumbnails(self.source, "h", ALL_SIZES)
        for directory in ALL_SIZES:
            with self.subTest(directory):
                self.assertEqual(_metadata_fields(_load(self.path(directory))), [])
                self.assertFalse(webp_has_metadata(self.path(directory)))
                with Image.open(self.path(directory)) as image:
                    self.assertNotIn("exif", image.info)
                    self.assertNotIn("xmp", image.info)

    def test_missing_small_sizes_from_the_big_thumbnail_have_none(self):
        create_static_thumbnails(self.source, "h", ["thumbnails_big"])
        create_static_thumbnails(self.source, "h", ALL_SIZES[1:])
        for directory in ALL_SIZES[1:]:
            with self.subTest(directory):
                self.assertFalse(webp_has_metadata(self.path(directory)))

    def test_rotated_thumbnail_has_none(self):
        out = self.path("thumbnails_big")
        _render_thumbnail(self.source, 1080, out, 6)
        self.assertEqual(_metadata_fields(_load(out)), [])

    def test_icc_profile_is_kept_byte_for_byte(self):
        tagged = os.path.join(self.media, "tagged.jpg")
        _gps_jpeg(tagged, icc=SRGB_ICC)
        create_static_thumbnails(tagged, "h", ALL_SIZES)
        for directory in ALL_SIZES:
            with self.subTest(directory):
                image = _load(self.path(directory))
                self.assertEqual(_icc(image), SRGB_ICC)
                self.assertEqual(_metadata_fields(image), [])

    def test_untagged_source_gets_no_profile(self):
        create_static_thumbnails(self.source, "h", ["thumbnails_big"])
        self.assertIsNone(_icc(_load(self.path("thumbnails_big"))))

    def test_dropping_metadata_leaves_the_pixels_alone(self):
        image = pyvips.Image.new_from_file(self.source)
        stripped = pyvips.Image.new_from_buffer(
            image.write_to_buffer(".webp", **WEBP), ""
        )
        everything = {**WEBP, "keep": pyvips.enums.ForeignKeep.ALL}
        kept = pyvips.Image.new_from_buffer(
            image.write_to_buffer(".webp", **everything), ""
        )
        self.assertTrue((stripped.numpy() == kept.numpy()).all())

    def test_raw_preview_thumbnail_has_none(self):
        # Whatever the preview image still carries must not reach the file.
        leaky = pyvips.Image.new_from_file(self.source).copy_memory()
        out = self.path("thumbnails_big")
        with mock.patch(
            "api.thumbnails.image_decoding.raw_preview", return_value=leaky
        ):
            _render_raw_thumbnail("/photos/x.nef", 1080, out, 1)
        self.assertEqual(_metadata_fields(_load(out)), [])

    @unittest.skipIf(
        sys.platform == "win32",
        "_reorient_file_in_place writes to the file libvips still holds open",
    )
    def test_reoriented_raw_service_thumbnail_has_none(self):
        out = self.path("thumbnails_big")
        pyvips.Image.new_from_file(self.source).write_to_file(out)  # keeps all
        self.assertTrue(webp_has_metadata(out))
        _reorient_file_in_place(out, 6)
        self.assertFalse(webp_has_metadata(out))

    def test_raw_service_writes_no_metadata(self):
        from api.tests.photos.test_thumbnail_service_raw import FakeRaw
        from service.thumbnail.main import render_raw

        out = self.path("thumbnails_big")
        with mock.patch("service.thumbnail.main.rawpy.imread", FakeRaw):
            render_raw("/photos/x.nef", out, 75)
        self.assertEqual(_metadata_fields(_load(out)), [])


class VideoThumbnailMetadataTest(MediaRootTestCase):
    def _command(self, create, *args):
        with (
            mock.patch("api.thumbnails._run_ffmpeg") as run,
            mock.patch("api.thumbnails.video_color.video_filter", return_value=None),
        ):
            create("/videos/clip.mp4", *args)
        return run.call_args.args[0]

    def _assert_drops_metadata(self, command):
        output = len(command) - 1
        for flag in ("-map_metadata", "-map_chapters"):
            self.assertIn(flag, command)
            index = command.index(flag)
            self.assertEqual(command[index + 1], "-1")
            self.assertLess(index, output)  # an output option, before the file

    def test_animated_thumbnail_drops_the_source_metadata(self):
        self._assert_drops_metadata(
            self._command(
                create_animated_thumbnail, 250, "square_thumbnails", "h", ".mp4"
            )
        )

    def test_video_still_drops_the_source_metadata(self):
        self._assert_drops_metadata(
            self._command(create_thumbnail_for_video, "thumbnails_big", "h", ".webp")
        )


def _leaky_webp(path, icc=None):
    """A thumbnail as releases before the fix wrote it: all the source's metadata."""
    source = path + ".jpg"
    _gps_jpeg(source, icc=icc)
    image = pyvips.Image.thumbnail(source, 10000, height=500)
    image.write_to_file(path, Q=95, keep=pyvips.enums.ForeignKeep.ALL)
    os.remove(source)


class StripWebpMetadataTest(MediaRootTestCase):
    def test_strips_exif_and_xmp_keeping_pixels_and_profile(self):
        path = self.path("thumbnails_big")
        _leaky_webp(path, icc=SRGB_ICC)
        before = _load(path)
        self.assertIn("exif-ifd3-GPSLatitude", before.get_fields())

        self.assertTrue(strip_webp_metadata(path))

        after = _load(path)
        self.assertEqual(_metadata_fields(after), [])
        self.assertEqual(_icc(after), SRGB_ICC)
        self.assertTrue((after.numpy() == before.numpy()).all())
        with Image.open(path) as image:
            image.load()  # Pillow still parses the rewritten container
            self.assertNotIn("exif", image.info)

    def test_clean_file_is_not_rewritten(self):
        path = self.path("thumbnails_big")
        create_static_thumbnails(self.source, "h", ["thumbnails_big"])
        with open(path, "rb") as handle:
            content = handle.read()
        self.assertFalse(strip_webp_metadata(path))
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(), content)

    def test_not_a_webp_is_left_alone(self):
        path = self.path("thumbnails_big", "broken.webp")
        with open(path, "wb") as handle:
            handle.write(b"not a webp at all")
        self.assertFalse(webp_has_metadata(path))
        self.assertFalse(strip_webp_metadata(path))

    @unittest.skipIf(sys.platform == "win32", "POSIX mode bits")
    def test_keeps_the_file_mode(self):
        path = self.path("thumbnails_big")
        _leaky_webp(path)
        os.chmod(path, 0o644)
        strip_webp_metadata(path)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o644)


class StripThumbnailMetadataTest(MediaRootTestCase):
    def setUp(self):
        super().setUp()
        for directory in ALL_SIZES:
            _leaky_webp(self.path(directory))
        create_static_thumbnails(self.source, "clean", ["thumbnails_big"])

    def test_dry_run_counts_without_touching(self):
        result = strip_thumbnail_metadata(self.media, dry_run=True)
        self.assertEqual(result.scanned, 4)
        self.assertEqual(len(result.with_metadata), 3)
        self.assertTrue(webp_has_metadata(self.path("thumbnails_big")))

    def test_strips_every_size_and_a_second_run_finds_nothing(self):
        result = strip_thumbnail_metadata(self.media)
        self.assertEqual(result.stripped, 3)
        self.assertEqual(result.still_with_metadata, [])
        for directory in ALL_SIZES:
            self.assertFalse(webp_has_metadata(self.path(directory)))
        self.assertEqual(strip_thumbnail_metadata(self.media).with_metadata, [])

    def test_management_command(self):
        out = StringIO()
        call_command("strip_thumbnail_metadata", stdout=out)
        self.assertIn("Stripped 3 thumbnails", out.getvalue())
        self.assertFalse(webp_has_metadata(self.path("square_thumbnails")))


def _video_tools_available():
    return bool(shutil.which(binaries.exiftool()) and shutil.which(binaries.ffmpeg()))


@unittest.skipUnless(_video_tools_available(), "ffmpeg or exiftool not available")
class StripVideoThumbnailMetadataTest(MediaRootTestCase):
    def _location(self, path):
        return subprocess.run(
            [binaries.exiftool(), "-s3", "-UserData:LocationInformation", path],
            capture_output=True,
            text=True,
        ).stdout.strip()

    def _video(self, path):
        # An Android phone records its position in the mp4 "location" tag.
        subprocess.run(
            [binaries.ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi"]
            + ["-i", "testsrc=duration=1:size=320x240:rate=5"]
            + ["-metadata", "location=+48.8584+002.2945/", "-vcodec", "libx264", path],
            check=True,
        )

    def test_animated_thumbnail_of_a_located_video_has_no_location(self):
        source = os.path.join(self.media, "clip.mp4")
        self._video(source)
        self.assertIn("48.8", self._location(source))
        with mock.patch(
            "api.thumbnails.video_color.video_filter", return_value="scale=-2:120"
        ):
            thumbnails.create_animated_thumbnail(
                source, 120, "square_thumbnails", "v", ".mp4"
            )
        self.assertEqual(self._location(self.path("square_thumbnails", "v.mp4")), "")

    def test_strips_the_location_from_an_old_video_thumbnail(self):
        path = self.path("square_thumbnails", "v.mp4")
        self._video(path)
        result = strip_thumbnail_metadata(self.media)
        self.assertIn(os.path.normpath(path), result.with_metadata)
        self.assertEqual(result.still_with_metadata, [])
        self.assertEqual(self._location(path), "")
        self.assertEqual(strip_thumbnail_metadata(self.media).with_metadata, [])
