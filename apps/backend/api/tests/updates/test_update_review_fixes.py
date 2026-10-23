"""The findings of the security review of #2847, as tests of the fixed
behaviour: zips zipfile chokes on fail the update instead of leaving it busy,
a photo folder inside the program folder blocks updating and is never
deleted, versions are ASCII digits only, and folders on different drives
neither stop LibrePhotos from starting nor kill the finisher."""

import io
import json
import os
import tempfile
import threading
import zipfile
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.tests.updates.release_fixtures import (
    ZIP_NAME,
    checksums_for,
    release_session,
)
from api.updates import extract, install
from api.updates.download import GITHUB, DownloadError
from api.updates.extract import entry_parts
from api.updates.install import Installer
from api.updates.stage import MARKER_NAME, ProgramFolder
from api.updates.versions import is_newer, parse_version
from librephotos import standalone, updater

VERSION = "1.5.0"


def _zip_with(name, data=b"x"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("librephotos/", b"")
        archive.writestr("librephotos/librephotos.exe", b"MZ")
        archive.writestr(name, data)
    return buffer.getvalue()


def bad_utf8_name_zip():
    # "é" sets the UTF-8 flag; replace its bytes with invalid UTF-8.
    return _zip_with("librephotos/\u00e9.dll").replace(b"\xc3\xa9", b"\xff\xfe")


def unknown_compression_zip():
    # Compression method 99 (AES) in both headers: zipfile raises
    # NotImplementedError on open().
    raw = bytearray(_zip_with("librephotos/zz.dll", b"payload"))
    name = b"librephotos/zz.dll"
    for signature, method_offset in ((b"PK\x03\x04", 8), (b"PK\x01\x02", 10)):
        start = 0
        while (at := raw.find(signature, start)) != -1:
            name_at = at + (30 if signature == b"PK\x03\x04" else 46)
            if raw[name_at : name_at + len(name)] == name:
                raw[at + method_offset : at + method_offset + 2] = (99).to_bytes(
                    2, "little"
                )
            start = at + 4
    return bytes(raw)


class UnexpectedZipErrorTest(SimpleTestCase):
    """A zip that passes the SHA-256 check but makes zipfile raise something
    unusual fails the update with a code; the updater can be retried."""

    def run_update(self, zip_bytes):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        program = Path(folder.name) / "librephotos"
        program.mkdir()
        files = {
            ZIP_NAME: zip_bytes,
            "SHA256SUMS": checksums_for({ZIP_NAME: zip_bytes}),
        }
        session = release_session(VERSION, files)
        updater_ = Installer(
            ProgramFolder(program), MagicMock(), session_factory=lambda: session
        )
        done = threading.Event()
        updater_.subscribe(
            lambda state: done.set() if state["state"] in ("failed", "ready") else None
        )
        updater_.start(VERSION)
        self.assertTrue(done.wait(10))
        return updater_

    def test_an_invalid_utf8_name_fails_as_a_bad_zip(self):
        updater_ = self.run_update(bad_utf8_name_zip())
        state = updater_.state(VERSION)
        self.assertEqual((state["state"], state["error"]), ("failed", "bad_zip"))
        with patch.object(install.threading, "Thread") as thread:
            self.assertEqual(updater_.start(VERSION)["state"], "downloading")
        thread.assert_called_once()

    def test_unknown_compression_fails_as_a_bad_zip(self):
        updater_ = self.run_update(unknown_compression_zip())
        self.assertEqual(updater_.state(VERSION)["error"], "bad_zip")

    def test_anything_else_fails_as_unexpected(self):
        with (
            patch.object(install, "stage_release", side_effect=KeyError("x")),
            self.assertLogs("api.updates.install", "ERROR"),
        ):
            updater_ = self.run_update(b"")
        self.assertEqual(updater_.state(VERSION)["error"], "unexpected")


class LibraryInsideProgramFolderTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)

    def test_photos_inside_the_program_folder_block_the_update(self):
        program = self.root / "librephotos"
        (program / "photos").mkdir(parents=True)
        data = self.root / "data"
        startup = standalone.Startup()
        startup.launch = updater.Launch(("run",), {}, str(self.root))
        env = {"BASE_DATA": str(data), "BASE_LOGS": str(data / "logs")}
        with (
            patch.dict(os.environ, env),
            patch.object(standalone, "standalone_executable", return_value="x.exe"),
            patch.object(standalone, "install_root", return_value=str(program)),
            patch.object(install, "_registry", install._Registry()),
            patch.object(install, "library_dirs", lambda: [program / "photos"]),
        ):
            standalone.enable_updater(startup, "http://127.0.0.1:8000/")
            state = install.install_state(VERSION)
        self.assertFalse(state["supported"])
        self.assertEqual(state["reason"], "library_in_program_folder")

    def release(self, name, version):
        folder = self.root / name
        folder.mkdir()
        (folder / "librephotos.exe").write_bytes(b"MZ")
        (folder / "lib.dll").write_bytes(b"x")
        info = {
            "version": version,
            "files": ["build_info.json", "lib.dll", "librephotos.exe"],
        }
        (folder / "build_info.json").write_text(json.dumps(info))
        return folder

    def update_twice(self):
        log = MagicMock()
        current = self.root / "librephotos"
        for n, version in enumerate(("1.5.0", "1.6.0")):
            staged = self.release(f"librephotos-{version}", version)
            plan = updater.plan_swap(current, staged, f"2026010100000{n}")
            updater.apply_swap(plan, log)
            updater.remove_superseded(plan, log)
        return log

    def test_a_folder_with_more_than_the_release_is_never_deleted(self):
        current = self.release("librephotos", "1.4.0")
        (current / "photos").mkdir()
        (current / "photos" / "only-copy.jpg").write_bytes(b"jpeg")
        log = self.update_twice()
        self.assertEqual(len(list(self.root.rglob("only-copy.jpg"))), 1)
        self.assertIn("also holds photos", log.call_args.args[0])

    def test_a_folder_without_the_list_of_its_files_is_never_deleted(self):
        current = self.root / "librephotos"
        current.mkdir()
        (current / "librephotos.exe").write_bytes(b"MZ")
        log = self.update_twice()
        self.assertTrue(
            any(p.name.startswith("librephotos-old.") for p in self.root.iterdir())
        )
        self.assertIn("does not list", log.call_args.args[0])

    def test_a_release_with_its_links_and_marker_is_deleted(self):
        current = self.release("librephotos", "1.4.0")
        (current / "librephotos-worker.exe").write_bytes(b"MZ")
        (current / MARKER_NAME).write_text("{}")
        self.update_twice()
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()),
            ["librephotos", "librephotos-old"],
        )

    def test_the_marker_names_agree(self):
        self.assertEqual(MARKER_NAME, updater.UPDATE_MARKER)


class VersionDigitsTest(SimpleTestCase):
    def test_only_ascii_digits_are_versions(self):
        tag = "\u0669.\u0660.\u0660"  # Arabic-Indic 9.0.0
        self.assertIsNone(parse_version(tag))
        self.assertFalse(is_newer(tag, "1.4.0"))
        with self.assertRaises(DownloadError):
            GITHUB.asset_url(tag, ZIP_NAME)


class DeviceNamesTest(SimpleTestCase):
    def test_more_windows_device_names_are_refused(self):
        for name in (
            "CONIN$",
            "conout$",
            "COM\u00b9",
            "lpt\u00b3.txt",
            "nul .txt",
            "COM0",
        ):
            with self.subTest(name=name), self.assertRaises(DownloadError):
                entry_parts(f"librephotos/{name}")


class CrossDriveTest(SimpleTestCase):
    """os.path.commonpath raises ValueError on Windows for paths on different
    drives: "not inside", never a crash. Exercised with ntpath everywhere."""

    PROGRAM = PureWindowsPath("D:/LibrePhotos-app/librephotos")
    DATA = PureWindowsPath("C:/Users/x/AppData/Local/LibrePhotos")

    def test_inside_is_false_for_another_drive(self):
        import ntpath

        with patch.object(updater.os, "path", ntpath):
            self.assertFalse(updater.inside(r"D:\Games\game.exe", r"C:\x\librephotos"))
            self.assertTrue(
                updater.inside(r"C:\x\librephotos\a.exe", r"C:\x\librephotos")
            )
        with patch.object(install.os, "path", ntpath):
            self.assertFalse(install._inside(self.DATA, self.PROGRAM))
        with patch.object(extract.os, "path", ntpath):
            self.assertFalse(extract._inside(self.DATA, self.PROGRAM))

    def test_an_updater_error_never_stops_the_start(self):
        startup = standalone.Startup()
        startup.launch = updater.Launch(("run",), {}, "C:/")
        env = {"BASE_DATA": "C:/d", "BASE_LOGS": "C:/d/logs"}
        with (
            patch.dict(os.environ, env),
            patch.object(standalone, "standalone_executable", return_value="x.exe"),
            patch.object(standalone, "install_root", return_value="D:/p"),
            patch.object(install, "enable", side_effect=ValueError("drives")),
            self.assertLogs("librephotos.standalone", "ERROR"),
        ):
            standalone.enable_updater(startup, "http://127.0.0.1:8000/")

    def test_the_finisher_survives_a_process_on_another_drive(self):
        import ntpath

        other = SimpleNamespace(pid=4242, info={"exe": r"D:\Games\game.exe"})
        with (
            patch.object(updater.os, "path", ntpath),
            patch.object(updater.psutil, "process_iter", return_value=[other]),
        ):
            self.assertEqual(updater.processes_in(Path(r"C:\x\librephotos")), [])

    def test_an_unexpected_finisher_error_starts_librephotos_again(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        old = root / "librephotos"
        old.mkdir()
        (old / "librephotos.exe").write_bytes(b"MZ")
        request = updater.FinishRequest(
            old_pid=1,
            old_dir=old,
            staged=root / "librephotos-1.5.0",
            url="http://127.0.0.1:8000/",
            log=root / "update.log",
            cwd="",
            relaunch=(),
        )
        notify = MagicMock()
        with (
            patch.object(updater, "wait_for_exit", return_value=True),
            patch.object(updater, "stop_leftovers", side_effect=ValueError("drives")),
            patch.object(updater, "_answers_ready", return_value=False),
            patch.object(updater, "launch_release") as launch,
            self.assertLogs("librephotos.updater", "ERROR"),
        ):
            self.assertEqual(updater.finish_update(request, notify), 1)
        launch.assert_called_once_with(old, request)
        self.assertIn("Updating LibrePhotos failed", notify.call_args.args[0])
        self.assertIn("ValueError", (root / "update.log").read_text())

    def test_recovery_falls_back_to_librephotos_old(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        rollback = root / "librephotos-old"
        rollback.mkdir()
        (rollback / "librephotos.exe").write_bytes(b"MZ")
        request = SimpleNamespace(url="http://x/", old_dir=root / "librephotos")
        log = MagicMock()
        with (
            patch.object(updater, "_answers_ready", return_value=False),
            patch.object(updater, "launch_release", side_effect=[None]) as launch,
        ):
            updater.recover(request, log)
        launch.assert_called_once_with(rollback, request)
        with patch.object(updater, "_answers_ready", return_value=True):
            updater.recover(request, log)
        with (
            patch.object(updater, "_answers_ready", return_value=False),
            patch.object(updater, "launch_release", side_effect=OSError("x")),
        ):
            updater.recover(request, log)
        self.assertIn("found no LibrePhotos", log.call_args.args[0])
