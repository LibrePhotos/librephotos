"""MIME sniffing covers what the scanner decides on: video or not, JPEG or not."""

import os
import tempfile
import unittest

from api.mime import mime_type, sniffed_mime_type


def _write(name, data):
    path = os.path.join(tempfile.mkdtemp(), name)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


class SniffTests(unittest.TestCase):
    def test_mp4_and_mov_are_video(self):
        ftyp = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
        self.assertEqual(sniffed_mime_type(_write("a.mp4", ftyp)), "video/mp4")
        qt = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 64
        self.assertEqual(sniffed_mime_type(_write("a.mov", qt)), "video/quicktime")

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
