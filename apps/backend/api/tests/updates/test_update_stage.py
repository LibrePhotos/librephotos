"""Preparing a release next to the program folder (#2788): SHA256SUMS is
required, the signature is checked once a key is built in, and the folder is
only there once every check passed."""

import json
import tempfile
from collections import namedtuple
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from api.tests.updates.release_fixtures import (
    ZIP_NAME,
    checksums_for,
    release_files,
    release_session,
    release_zip,
)
from api.tests.updates.test_update_signature import key_pair, minisign
from api.updates import stage
from api.updates.download import DownloadError
from api.updates.stage import (
    MARKER_NAME,
    ProgramFolder,
    Reporter,
    is_staged,
    stage_release,
)

Usage = namedtuple("Usage", "total used free")


class StageReleaseTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.parent = Path(folder.name)
        program = self.parent / "librephotos"
        program.mkdir()
        self.folder = ProgramFolder(program)
        self.phases = []
        self.reporter = Reporter(phase=self.phases.append)

    def stage(self, session, version="1.5.0"):
        return stage_release(session, self.folder, version, self.reporter)

    def test_the_release_is_prepared_next_to_the_program_folder(self):
        staged = self.stage(release_session(files=release_files()))
        self.assertEqual(staged, self.parent / "librephotos-1.5.0")
        self.assertTrue((staged / "librephotos.exe").is_file())
        marker = json.loads((staged / MARKER_NAME).read_text())
        self.assertEqual(marker["version"], "1.5.0")
        self.assertFalse(marker["signed"])
        self.assertTrue(is_staged(staged, "1.5.0"))
        self.assertFalse(is_staged(staged, "1.6.0"))
        self.assertFalse((self.parent / "librephotos-1.5.0.partial").exists())
        self.assertEqual(self.phases, ["verifying", "extracting"])
        # The program folder itself is untouched.
        self.assertEqual(list((self.parent / "librephotos").iterdir()), [])

    def test_a_prepared_release_is_not_downloaded_again(self):
        self.stage(release_session(files=release_files()))
        session = release_session(files=release_files())
        self.stage(session)
        self.assertEqual(session.requests, [])

    def test_a_folder_it_did_not_make_is_left_alone(self):
        (self.parent / "librephotos-1.5.0").mkdir()
        with self.assertRaises(DownloadError) as raised:
            self.stage(release_session(files=release_files()))
        self.assertEqual(raised.exception.code, "folder_in_the_way")

    def test_no_checksums_no_update(self):
        files = release_files()
        del files["SHA256SUMS"]
        with self.assertRaises(DownloadError) as raised:
            self.stage(release_session(files=files))
        self.assertEqual(raised.exception.code, "missing_sha256sums")
        self.assertFalse((self.parent / "librephotos-1.5.0").exists())

    def test_a_damaged_download_is_deleted_and_nothing_prepared(self):
        files = release_files()
        files["SHA256SUMS"] = checksums_for({ZIP_NAME: b"something else"})
        with self.assertRaises(DownloadError) as raised:
            self.stage(release_session(files=files))
        self.assertEqual(raised.exception.code, "checksum_mismatch")
        partial = self.parent / "librephotos-1.5.0.partial"
        self.assertFalse((partial / f"{ZIP_NAME}.part").exists())
        self.assertFalse((self.parent / "librephotos-1.5.0").exists())

    def test_a_zip_of_another_release_is_refused(self):
        files = release_files(zip_bytes=release_zip(build_version="1.4.0"))
        with self.assertRaises(DownloadError) as raised:
            self.stage(release_session(files=files))
        self.assertEqual(raised.exception.code, "wrong_release")

    def test_an_interrupted_download_resumes_on_the_next_try(self):
        files = release_files()
        with self.assertRaises(DownloadError):
            self.stage(release_session(files=files, break_after=100))
        session = release_session(files=files)
        self.stage(session)
        self.assertIn(
            {"Range": "bytes=100-"}, [headers for _, headers in session.requests]
        )

    def test_an_earlier_unpacked_attempt_is_replaced(self):
        leftover = self.parent / "librephotos-1.5.0.partial" / "unpacked" / "junk"
        leftover.mkdir(parents=True)
        self.stage(release_session(files=release_files()))
        self.assertFalse(leftover.exists())

    def test_too_little_disk_space_stops_before_downloading(self):
        session = release_session(files=release_files())
        with (
            patch.object(stage.shutil, "disk_usage", return_value=Usage(1, 1, 10)),
            self.assertRaises(DownloadError) as raised,
        ):
            self.stage(session)
        self.assertEqual(raised.exception.code, "disk_full")
        self.assertEqual(session.requests, [])


class SignedStageTest(SimpleTestCase):
    """Once a public key is built in (#2317), SHA256SUMS must be signed by it."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        program = Path(folder.name) / "librephotos"
        program.mkdir()
        self.folder = ProgramFolder(program)
        self.private, public = key_pair()
        patcher = patch.object(stage.signature, "PUBLIC_KEY", public)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_signed_release_is_prepared(self):
        files = release_files()
        files["SHA256SUMS.minisig"] = minisign(
            self.private, files["SHA256SUMS"]
        ).encode()
        staged = stage_release(release_session(files=files), self.folder, "1.5.0")
        marker = json.loads((staged / MARKER_NAME).read_text())
        self.assertTrue(marker["signed"])

    def test_a_missing_or_wrong_signature_is_refused(self):
        files = release_files()
        with self.assertRaises(DownloadError) as raised:
            stage_release(release_session(files=files), self.folder, "1.5.0")
        self.assertEqual(raised.exception.code, "missing_sha256sums_minisig")
        other, _ = key_pair()
        files["SHA256SUMS.minisig"] = minisign(other, files["SHA256SUMS"]).encode()
        with self.assertRaises(DownloadError) as raised:
            stage_release(release_session(files=files), self.folder, "1.5.0")
        self.assertEqual(raised.exception.code, "bad_signature")
