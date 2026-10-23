"""Unpacking the release zip (#2788): nothing may land outside the target
folder (zip slip), and a zip bomb stops early."""

import io
import json
import stat
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from api.tests.updates.release_fixtures import release_zip
from api.updates import extract
from api.updates.download import DownloadError
from api.updates.extract import check_release, entry_parts, extract_release


class EntryPartsTest(SimpleTestCase):
    def test_entries_under_the_program_folder(self):
        self.assertEqual(
            entry_parts("librephotos/static/app.js"),
            ("librephotos", "static", "app.js"),
        )
        self.assertEqual(entry_parts("librephotos/"), ("librephotos",))

    def test_anything_that_could_leave_the_folder_is_refused(self):
        for name in (
            "../evil.exe",
            "librephotos/../../evil.exe",
            "/etc/passwd",
            "C:/Windows/evil.dll",
            "librephotos\\..\\evil.exe",
            "librephotos/file.txt:stream",
            "other/librephotos.exe",
            "librephotos/./x",
            "librephotos//x",
            "librephotos/con",
            "librephotos/NUL.txt",
            "librephotos/com1.py",
            "librephotos/trailing.",
            "librephotos/trailing ",
        ):
            with self.subTest(name=name), self.assertRaises(DownloadError) as raised:
                entry_parts(name)
            self.assertEqual(raised.exception.code, "unsafe_zip")

    def test_ordinary_names_with_device_like_parts_are_fine(self):
        self.assertEqual(entry_parts("librephotos/console.txt")[-1], "console.txt")
        self.assertEqual(entry_parts("librephotos/aux_data/x")[1], "aux_data")


class ExtractReleaseTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.target = self.root / "unpacked"
        self.target.mkdir()

    def zip_file(self, data):
        path = self.root / "release.zip"
        path.write_bytes(data)
        return path

    def raw_zip(self, entries):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for info, data in entries:
                archive.writestr(info, data)
        return self.zip_file(buffer.getvalue())

    def test_a_release_unpacks_into_its_folder(self):
        program = extract_release(self.zip_file(release_zip("1.5.0")), self.target)
        self.assertEqual(program, self.target / "librephotos")
        self.assertEqual((program / "librephotos.exe").read_bytes(), b"MZ fake program")
        self.assertTrue((program / "frontend_build" / "index.html").is_file())
        check_release(program, "1.5.0")

    def test_zip_slip_writes_nothing_outside(self):
        path = self.zip_file(release_zip(entries={"librephotos/../../evil.txt": b"x"}))
        with self.assertRaises(DownloadError) as raised:
            extract_release(path, self.target)
        self.assertEqual(raised.exception.code, "unsafe_zip")
        self.assertFalse((self.root / "evil.txt").exists())

    def test_links_and_duplicates_are_refused(self):
        link = zipfile.ZipInfo("librephotos/link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(DownloadError):
            extract_release(self.raw_zip([(link, b"/etc/passwd")]), self.target)
        twice = [
            (zipfile.ZipInfo("librephotos/a"), b"1"),
            (zipfile.ZipInfo("librephotos/a"), b"2"),
        ]
        target = self.root / "second"
        target.mkdir()
        with self.assertRaises(DownloadError) as raised:
            extract_release(self.raw_zip(twice), target)
        self.assertEqual(raised.exception.code, "unsafe_zip")
        self.assertEqual((target / "librephotos" / "a").read_bytes(), b"1")

    def test_a_folder_entry_that_points_outside_is_refused(self):
        outside = self.root / "outside"
        with (
            patch.object(extract, "_inside", return_value=False),
            self.assertRaises(DownloadError),
        ):
            extract_release(self.zip_file(release_zip()), self.target)
        self.assertFalse(outside.exists())

    def test_too_many_entries_or_bytes_stop_before_unpacking(self):
        path = self.zip_file(release_zip())
        for limit in ("MAX_ENTRIES", "MAX_UNPACKED_BYTES"):
            with (
                self.subTest(limit=limit),
                patch.object(extract, limit, 2),
                self.assertRaises(DownloadError) as raised,
            ):
                extract_release(path, self.target)
            self.assertEqual(raised.exception.code, "too_large_unpacked")
        self.assertEqual(list(self.target.iterdir()), [])

    def test_a_damaged_zip_fails(self):
        with self.assertRaises(DownloadError) as raised:
            extract_release(self.zip_file(b"not a zip"), self.target)
        self.assertEqual(raised.exception.code, "bad_zip")
        data = bytearray(release_zip())
        data[60:80] = b"\0" * 20
        with self.assertRaises(DownloadError):
            extract_release(self.zip_file(bytes(data)), self.root / "x")


class CheckReleaseTest(SimpleTestCase):
    def test_the_folder_must_be_that_release(self):
        with tempfile.TemporaryDirectory() as folder:
            program = Path(folder)
            with self.assertRaises(DownloadError):
                check_release(program, "1.5.0")
            (program / "build_info.json").write_text(json.dumps({"version": "1.4.0"}))
            (program / "librephotos.exe").write_bytes(b"MZ")
            with self.assertRaises(DownloadError) as raised:
                check_release(program, "1.5.0")
            self.assertEqual(raised.exception.code, "wrong_release")
            (program / "build_info.json").write_text(json.dumps(["1.5.0"]))
            with self.assertRaises(DownloadError):
                check_release(program, "1.5.0")
            (program / "build_info.json").write_text(json.dumps({"version": "1.5.0"}))
            check_release(program, "1.5.0")
