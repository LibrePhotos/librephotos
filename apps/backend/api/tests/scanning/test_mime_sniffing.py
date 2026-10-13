"""MIME sniffing covers what the scanner decides on: video or not, JPEG or not."""

import os
import tempfile
import unittest

from api.mime import mime_type, sniffed_mime_type
from api.photos.media_files import is_video
from api.runtime import binaries


def _write(name, data):
    path = os.path.join(tempfile.mkdtemp(), name)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


def _ftyp(major, *compatible, size=None):
    """An ISO-BMFF ``ftyp`` box (size, "ftyp", major brand, minor version, brands)."""
    body = b"ftyp" + major + b"\x00\x00\x02\x00" + b"".join(compatible)
    box_size = size if size is not None else len(body) + 4
    return box_size.to_bytes(4, "big") + body + b"\x00" * 64


class SniffTests(unittest.TestCase):
    def test_mp4_and_mov_are_video(self):
        ftyp = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
        self.assertEqual(sniffed_mime_type(_write("a.mp4", ftyp)), "video/mp4")
        qt = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 64
        self.assertEqual(sniffed_mime_type(_write("a.mov", qt)), "video/quicktime")

    def test_3gp_with_only_3gpp_brands_is_video(self):
        # Old phones list no MP4 brand. filetype 1.2.0's 3GP matcher compares
        # "ftyp3gp" with the first bytes (the box size), so it never matches,
        # and only the MP4 matcher's isom/mp41/mp42 brands caught 3GPs (#2418).
        old = _ftyp(b"3gp4", b"3gp4", b"3gp5", b"3g2a")
        self.assertEqual(sniffed_mime_type(_write("old.3gp", old)), "video/3gpp")
        # A 3GPP brand only among the compatible ones.
        odd = _ftyp(b"abcd", b"3gp6")
        self.assertEqual(sniffed_mime_type(_write("odd.3gp", odd)), "video/3gpp")
        cdma = _ftyp(b"3g2a", b"3g2a")
        self.assertEqual(sniffed_mime_type(_write("old.3g2", cdma)), "video/3gpp2")

    def test_3gp_with_an_mp4_brand_stays_mp4(self):
        new = _ftyp(b"3gp4", b"3gp4", b"isom", b"iso2")
        self.assertEqual(sniffed_mime_type(_write("new.3gp", new)), "video/mp4")

    def test_ftyp_without_a_3gpp_brand_is_not_video(self):
        other = _ftyp(b"abcd", b"efgh")
        self.assertIsNone(sniffed_mime_type(_write("box.3gp", other)))
        # Bytes past the box's own size are not its brands.
        cut = _ftyp(b"abcd", b"efgh", b"3gp4", size=20)
        self.assertIsNone(sniffed_mime_type(_write("cut.3gp", cut)))

    def test_mpeg_transport_stream_is_video(self):
        packet = b"\x47\x40\x00\x10" + b"\x00" * 184
        self.assertEqual(sniffed_mime_type(_write("clip.ts", packet * 4)), "video/mp2t")
        # AVCHD / Blu-ray: a 4-byte timestamp before every packet (192-byte packets)
        m2ts = (b"\x00\x00\x00\x00" + packet) * 4
        self.assertEqual(sniffed_mime_type(_write("clip.MTS", m2ts)), "video/mp2t")

    def test_garbage_with_a_video_extension_is_not_video(self):
        self.assertIsNone(sniffed_mime_type(_write("fake.mp4", b"not a video at all")))

    def test_served_content_type_falls_back_to_the_extension(self):
        self.assertEqual(mime_type(_write("empty.mov", b"")), "video/quicktime")
        self.assertEqual(
            mime_type(_write("blob.bin", b"\x00\x01")), "application/octet-stream"
        )


@unittest.skipUnless(binaries.available("ffmpeg"), "no ffmpeg")
class Real3gpTests(unittest.TestCase):
    """An ffmpeg-made 3GP whose brands are 3GPP ones only, as old phones write (#2418)."""

    def test_old_phone_3gp_is_video(self):
        path = os.path.join(tempfile.mkdtemp(), "VID0001.3gp")
        binaries.run_tool(
            "ffmpeg",
            [
                "-y",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:size=64x48:duration=0.2",
                "-c:v",
                "mpeg4",
                "-f",
                "3gp",
                path,
            ],
            timeout=60,
        )
        with open(path, "rb") as handle:
            data = handle.read()
        # ffmpeg writes major 3gp4 with compatible "3gp4 isom iso2"; drop isom.
        patched = data.replace(b"3gp4isomiso2", b"3gp43gp5iso2", 1)
        self.assertNotEqual(data, patched)
        with open(path, "wb") as handle:
            handle.write(patched)

        self.assertEqual(sniffed_mime_type(path), "video/3gpp")
        self.assertEqual(mime_type(path), "video/3gpp")
        self.assertTrue(is_video(path))
