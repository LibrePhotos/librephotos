"""The content sniff's answer for every format it knows.

``SIGNATURES`` holds a minimal header per format with the answer filetype
1.2.0 (which ``api.mime`` replaced) gave for it, captured on that library
before it was removed, and the answer now. They are the same except the
deliberate changes in ``CHANGED``.
"""

import os
import tempfile
import unittest

from PIL import Image

from api.mime import SNIFF_BYTES, sniff, sniffed_mime_type

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures")


def _ftyp(major, *compatible):
    body = b"ftyp" + major + b"\x00\x00\x00\x00" + b"".join(compatible)
    return (len(body) + 4).to_bytes(4, "big") + body


def _ebml(doctype):
    header = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01"
    return header + b"\x42\x82" + bytes([0x80 | len(doctype)]) + doctype


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"\x00" * 17
ASF = b"\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9\x00\xaa\x00\x62\xce\x6c"
TS_PACKET = b"\x47" + b"\x00" * 187
PAD = b"\x00" * 16

# name: (header, answer)
SIGNATURES = {
    "empty": (b"", None),
    "one byte": (b"\xff", None),
    "jpeg": (b"\xff\xd8\xff\xe0" + PAD, "image/jpeg"),
    "jpeg, 3 bytes": (b"\xff\xd8\xff", "image/jpeg"),
    "png": (PNG + b"\x00\x00\x00\x00IDAT" + PAD, "image/png"),
    "png, 4 bytes": (b"\x89PNG", "image/png"),
    "apng": (PNG + b"\x00\x00\x00\x08acTL" + PAD, "image/apng"),
    "acTL after the image data": (
        PNG + b"\x00\x00\x00\x00IDAT\x00\x00\x00\x00\x00\x00\x00\x08acTL",
        "image/png",
    ),
    "gif": (b"GIF89a" + PAD, "image/gif"),
    "webp lossy": (b"RIFF\x00\x00\x00\x00WEBPVP8 " + PAD, "image/webp"),
    "webp extended": (b"RIFF\x00\x00\x00\x00WEBPVP8X" + PAD, "image/webp"),
    "webp, 13 bytes": (b"RIFF\x00\x00\x00\x00WEBPV", None),
    "tiff, little-endian": (b"II*\x00\x08\x00\x00\x00" + PAD, "image/tiff"),
    "tiff, big-endian": (b"MM\x00*\x00\x00\x00\x08" + PAD, "image/tiff"),
    "tiff, 9 bytes": (b"II*\x00\x08\x00\x00\x00\x00", None),
    "cr2": (b"II*\x00\x10\x00\x00\x00CR\x02\x00" + PAD, "image/x-canon-cr2"),
    "bmp": (b"BM" + PAD, "image/bmp"),
    "jpeg xr": (b"II\xbc\x01" + PAD, "image/vnd.ms-photo"),
    "psd": (b"8BPS" + PAD, "image/vnd.adobe.photoshop"),
    "ico": (b"\x00\x00\x01\x00" + PAD, "image/x-icon"),
    "heic": (_ftyp(b"heic", b"mif1", b"heic") + PAD, "image/heic"),
    "heic under mif1": (_ftyp(b"mif1", b"miaf", b"MiHE", b"heic") + PAD, "image/heic"),
    "heic under msf1": (_ftyp(b"msf1", b"heic") + PAD, "image/heic"),
    "heic with an isom brand": (
        _ftyp(b"heic", b"mif1", b"heic", b"isom") + PAD,
        "image/heic",
    ),
    "heix": (_ftyp(b"heix", b"mif1", b"heix") + PAD, None),
    "avif": (_ftyp(b"avif", b"mif1", b"avif") + PAD, "image/avif"),
    "avif under mif1": (_ftyp(b"mif1", b"miaf", b"MA1B", b"avif") + PAD, "image/avif"),
    "jpeg 2000": (
        b"\x00\x00\x00\x0cjP  \r\n\x87\n" + _ftyp(b"jp2 ", b"jp2 ") + b"\x00" * 40,
        "image/jpx",
    ),
    "dwg": (b"AC1015" + PAD, "image/vnd.dwg"),
    "xcf": (b"gimp xcf v001" + PAD, "image/x-xcf"),
    "dicom": (b"\x00" * 128 + b"DICM" + PAD, "application/dicom"),
    "mp4, isom": (
        _ftyp(b"isom", b"isom", b"iso2", b"avc1", b"mp41") + PAD,
        "video/mp4",
    ),
    "mp4, mp42": (_ftyp(b"mp42", b"mp42", b"isom") + PAD, "video/mp4"),
    "mp4, major brand only": (_ftyp(b"isom"), "video/mp4"),
    "mp4, mp41 among others": (_ftyp(b"avc1", b"avc1", b"mp41"), "video/mp4"),
    "mp4, avc1 only": (_ftyp(b"avc1", b"avc1") + PAD, None),
    "ftyp box size 0": (
        b"\x00\x00\x00\x00ftypisom\x00\x00\x00\x00isommp41" + PAD,
        "video/mp4",
    ),
    "ftyp box longer than the head": (
        b"\x00\x00\xff\xffftypisom\x00\x00\x00\x00isommp41" + PAD,
        None,
    ),
    "mov": (_ftyp(b"qt  ", b"qt  ") + PAD, "video/quicktime"),
    "mov without ftyp": (b"\x00\x00\x00\x08wide\x00\x00\x00\x00mdat" + PAD, None),
    "m4v": (b"\x00\x00\x00\x1cftypM4V " + b"\x00" * 20, "video/x-m4v"),
    "m4a": (_ftyp(b"M4A ", b"M4A ", b"mp42", b"isom") + PAD, "audio/mp4"),
    "3gp, 3GPP brands only": (_ftyp(b"3gp4", b"3gp4") + PAD, "video/3gpp"),
    "3gp with isom": (_ftyp(b"3gp5", b"3gp5", b"isom") + PAD, "video/mp4"),
    "3g2": (_ftyp(b"3g2a", b"3g2a") + PAD, "video/3gpp2"),
    "ftyp3gp at offset 0": (b"ftyp3gp" + PAD, "video/3gpp"),
    "3GPP brand past 64 bytes": (_ftyp(b"abcd", *([b"efgh"] * 14), b"3gp4"), None),
    "cr3": (_ftyp(b"crx ", b"crx ", b"isom") + PAD, "image/x-canon-cr3"),
    "matroska": (_ebml(b"matroska") + PAD, "video/x-matroska"),
    "matroska, doctype 5 KB in": (
        b"\x1a\x45\xdf\xa3" + b"\x00" * 5000 + b"\x42\x82\x88matroska",
        "video/x-matroska",
    ),
    "webm": (_ebml(b"webm") + PAD, "video/webm"),
    "ebml, other doctype": (_ebml(b"foo") + PAD, None),
    "webm doctype without ebml": (b"\x42\x82\x84webm" + PAD, None),
    "avi": (b"RIFF\x00\x00\x00\x00AVI LIST" + PAD, "video/x-msvideo"),
    "riff, 11 bytes": (b"RIFF\x00\x00\x00\x00AVI", None),
    "wav": (b"RIFF\x00\x00\x00\x00WAVEfmt " + PAD, "audio/x-wav"),
    "asf / wmv": (ASF + PAD, "video/x-ms-wmv"),
    "mpeg program stream": (b"\x00\x00\x01\xba" + PAD, "video/mpeg"),
    "mpeg video sequence": (b"\x00\x00\x01\xb3" + PAD, "video/mpeg"),
    "mpeg audio stream id": (b"\x00\x00\x01\xc0" + PAD, None),
    "mpeg-ts": (TS_PACKET * 4, "video/mp2t"),
    "m2ts": ((b"\x00\x00\x00\x00" + TS_PACKET) * 4, "video/mp2t"),
    "mpeg-ts, short": ((TS_PACKET * 3)[:-1], None),
    "flv": (b"FLV\x01\x05" + PAD, "video/x-flv"),
    "mp3 with id3": (b"ID3\x04" + PAD, "audio/mpeg"),
    "mp3 frame": (b"\xff\xfb\x90" + PAD, "audio/mpeg"),
    "aac": (b"\xff\xf1\x50" + PAD, "audio/aac"),
    "midi": (b"MThd" + PAD, "audio/midi"),
    "ogg": (b"OggS" + PAD, "audio/ogg"),
    "flac": (b"fLaC" + PAD, "audio/x-flac"),
    "amr": (b"#!AMR\n" + PAD, "audio/amr"),
    "aiff": (b"FORM\x00\x00\x00\x00AIFF" + PAD, "audio/x-aiff"),
    "bigtiff, little-endian": (b"II+\x00\x08\x00\x00\x00" + PAD, "image/tiff"),
    "bigtiff, big-endian": (b"MM\x00+\x00\x08\x00\x00" + PAD, "image/tiff"),
    "jpeg xl codestream": (b"\xff\x0a" + PAD, "image/jxl"),
    "jpeg xl container": (
        b"\x00\x00\x00\x0cJXL \r\n\x87\n" + _ftyp(b"jxl ", b"jxl "),
        "image/jxl",
    ),
    "pdf": (b"%PDF-1.7\n" + PAD, None),
    "zip": (b"PK\x03\x04" + PAD * 2, None),
    "gzip": (b"\x1f\x8b\x08" + PAD, None),
    "sqlite": (b"SQLite format 3\x00" + PAD, None),
    "svg": (b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', None),
    "xmp": (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', None),
    "text": (b"hello world, plain text", None),
    "bytes 0-255": (bytes(range(256)) * 4, None),
}

# What filetype 1.2.0 said where the answer changed on purpose.
CHANGED = {
    # A Canon RAW, not a video: detect_file_type made it a VIDEO photo.
    "cr3": "video/mp4",
    # Formats the scanner indexes that filetype did not know.
    "bigtiff, little-endian": None,
    "bigtiff, big-endian": None,
    "jpeg xl codestream": None,
    "jpeg xl container": None,
    # No longer sniffed: not media, so no consumer asks; mime_type() and
    # original_mime_type() fall back to the extension for them.
    "pdf": "application/pdf",
    "zip": "application/zip",
    "gzip": "application/gzip",
    "sqlite": "application/x-sqlite3",
}


def _write(directory, name, data):
    path = os.path.join(directory, name)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


class SignatureTableTest(unittest.TestCase):
    def test_every_format(self):
        for name, (header, answer) in SIGNATURES.items():
            with self.subTest(name):
                self.assertEqual(sniff(header), answer)

    def test_the_same_from_a_file(self):
        with tempfile.TemporaryDirectory() as directory:
            for index, (name, (header, answer)) in enumerate(SIGNATURES.items()):
                with self.subTest(name):
                    path = _write(directory, f"{index}.bin", header)
                    self.assertEqual(sniffed_mime_type(path), answer)

    def test_every_change_is_listed(self):
        for name, before in CHANGED.items():
            with self.subTest(name):
                self.assertNotEqual(SIGNATURES[name][1], before)


class BoundedReadTest(unittest.TestCase):
    def test_only_the_first_sniff_bytes_are_read(self):
        doctype = b"\x42\x82\x88matroska"
        with tempfile.TemporaryDirectory() as directory:
            inside = (
                b"\x1a\x45\xdf\xa3"
                + b"\x00" * (SNIFF_BYTES - 4 - len(doctype))
                + doctype
            )
            self.assertEqual(
                sniffed_mime_type(_write(directory, "in.mkv", inside)),
                "video/x-matroska",
            )
            past = b"\x1a\x45\xdf\xa3" + b"\x00" * SNIFF_BYTES + doctype
            self.assertIsNone(sniffed_mime_type(_write(directory, "past.mkv", past)))

    def test_unreadable_paths_are_none(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(sniffed_mime_type(os.path.join(directory, "missing.jpg")))
            self.assertIsNone(sniffed_mime_type(directory))


class RealFilesTest(unittest.TestCase):
    """Files written by Pillow (and pillow-heif), and the repository's fixtures."""

    PILLOW = {
        "a.jpg": ("JPEG", {}, "image/jpeg"),
        "a.png": ("PNG", {}, "image/png"),
        "a.gif": ("GIF", {}, "image/gif"),
        "a.webp": ("WEBP", {}, "image/webp"),
        "lossless.webp": ("WEBP", {"lossless": True}, "image/webp"),
        "a.tif": ("TIFF", {}, "image/tiff"),
        "a.bmp": ("BMP", {}, "image/bmp"),
        "a.ico": ("ICO", {}, "image/x-icon"),
        "a.jp2": ("JPEG2000", {}, "image/jpx"),
        "a.avif": ("AVIF", {}, "image/avif"),
    }

    def test_pillow_files(self):
        image = Image.new("RGB", (32, 24), (200, 40, 90))
        with tempfile.TemporaryDirectory() as directory:
            for name, (kind, options, answer) in self.PILLOW.items():
                with self.subTest(name):
                    path = os.path.join(directory, name)
                    try:
                        image.save(path, kind, **options)
                    except (KeyError, OSError) as error:
                        self.skipTest(f"Pillow cannot write {kind}: {error}")
                    self.assertEqual(sniffed_mime_type(path), answer)

    def test_animated_png_and_heic(self):
        frames = [
            Image.new("RGB", (16, 16), colour) for colour in ((255, 0, 0), (0, 255, 0))
        ]
        with tempfile.TemporaryDirectory() as directory:
            apng = os.path.join(directory, "anim.png")
            frames[0].save(apng, "PNG", save_all=True, append_images=frames[1:])
            self.assertEqual(sniffed_mime_type(apng), "image/apng")
            try:
                import pillow_heif
            except ImportError:
                self.skipTest("pillow-heif is not installed")
            pillow_heif.register_heif_opener()
            heic = os.path.join(directory, "a.heic")
            frames[0].save(heic, "HEIF")
            self.assertEqual(sniffed_mime_type(heic), "image/heic")

    def test_repository_fixtures(self):
        for name in ("iptc_test.jpg", "niaz.jpg"):
            with self.subTest(name):
                self.assertEqual(
                    sniffed_mime_type(os.path.join(FIXTURES, name)), "image/jpeg"
                )
