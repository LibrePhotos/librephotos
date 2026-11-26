import io
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path
from unittest import skipIf
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.tests.updates.release_fixtures import checksums_for, release_session
from api.updates import check
from api.updates.download import DownloadError
from api.updates.extract import check_release, extract_release
from api.updates.stage import ProgramFolder, is_staged, stage_release
from librephotos import release_layout, updater
from librephotos.release_layout import MACOS_ARM64, WINDOWS
from librephotos.updater import FinishRequest, finish_update

APP = "LibrePhotos Server.app"
BINARY = "Contents/Resources/librephotos/librephotos"
LAUNCHER = "Contents/MacOS/LibrePhotos Server"
URL = "http://127.0.0.1:8000/"


def add(archive, name, data, mode=0o644):
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | mode) << 16
    archive.writestr(info, data)


def mac_release_zip(version="1.7.0"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        add(archive, f"{APP}/Contents/Info.plist", b"<plist/>")
        add(archive, f"{APP}/{LAUNCHER}", b"\xcf\xfa\xed\xfe launcher", 0o755)
        add(archive, f"{APP}/{BINARY}", b"\xcf\xfa\xed\xfe binary", 0o755)
        add(
            archive,
            f"{APP}/Contents/Resources/librephotos/build_info.json",
            json.dumps(
                {"version": version, "files": ["build_info.json", "librephotos"]}
            ),
        )
    return buffer.getvalue()


def mac_release_files(version="1.7.0"):
    data = mac_release_zip(version)
    return {
        MACOS_ARM64.archive_name: data,
        MACOS_ARM64.checksums_name: checksums_for({MACOS_ARM64.archive_name: data}),
    }


def mac_app(folder, version, extra=()):
    binary = folder / BINARY
    binary.parent.mkdir(parents=True)
    binary.write_text(version)
    (folder / LAUNCHER).parent.mkdir(parents=True)
    (folder / LAUNCHER).write_text("launcher")
    (folder / "Contents" / "Info.plist").write_text("<plist/>")
    info = {"version": version, "files": ["build_info.json", "librephotos"]}
    (binary.parent / "build_info.json").write_text(json.dumps(info))
    for name in extra:
        (folder / name).write_text("extra")
    return folder


class ReleaseLayoutTest(SimpleTestCase):
    def test_the_mac_layout(self):
        layout = release_layout.layout_for("darwin", "arm64")
        self.assertEqual(layout, MACOS_ARM64)
        self.assertEqual(layout.archive_name, "librephotos-macos-arm64.zip")
        self.assertEqual(layout.checksums_name, "SHA256SUMS-macos-arm64")
        self.assertEqual(layout.signature_name, "SHA256SUMS-macos-arm64.minisig")
        self.assertEqual(layout.install_type, "macos")
        self.assertTrue(layout.docs_url.endswith("/installation/macos"))
        app = Path("/Applications") / APP
        self.assertEqual(layout.binary(app), app / BINARY)
        self.assertEqual(layout.launcher(app), app / LAUNCHER)
        self.assertEqual(layout.program_folder((app / BINARY).parent), app)
        self.assertEqual(
            layout.marker(app.with_name(f"{APP}-1.7.0")).name,
            f"{APP}-1.7.0.librephotos-update.json",
        )

    def test_everything_else_keeps_the_windows_layout(self):
        self.assertEqual(release_layout.layout_for("win32", "AMD64"), WINDOWS)
        self.assertEqual(release_layout.layout_for("linux", "x86_64"), WINDOWS)
        self.assertEqual(WINDOWS.archive_name, "librephotos-windows-x64.zip")
        self.assertEqual(WINDOWS.checksums_name, "SHA256SUMS")
        self.assertEqual(WINDOWS.signature_name, "SHA256SUMS.minisig")
        program = Path("C:/LibrePhotos/librephotos")
        self.assertEqual(WINDOWS.program_folder(program), program)
        self.assertEqual(WINDOWS.marker(program), program / ".librephotos-update.json")

    def test_skeleton_extras_name_what_a_release_does_not_have(self):
        with tempfile.TemporaryDirectory() as directory:
            app = mac_app(Path(directory) / APP, "1.7.0")
            self.assertEqual(release_layout.skeleton_extras(MACOS_ARM64, app), [])
            (app / "Contents" / "Resources" / "notes.txt").write_text("mine")
            self.assertEqual(
                release_layout.skeleton_extras(MACOS_ARM64, app),
                ["Contents/Resources/notes.txt"],
            )
            self.assertIsNone(
                release_layout.skeleton_extras(MACOS_ARM64, Path(directory) / "gone")
            )


class MacStageTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.parent = Path(folder.name)
        (self.parent / APP).mkdir()
        self.folder = ProgramFolder(self.parent / APP, MACOS_ARM64)

    def test_the_app_is_prepared_next_to_the_running_one(self):
        session = release_session("1.7.0", mac_release_files())
        staged = stage_release(session, self.folder, "1.7.0")
        self.assertEqual(staged, self.parent / f"{APP}-1.7.0")
        self.assertTrue((staged / BINARY).is_file())
        marker = self.parent / f"{APP}-1.7.0.librephotos-update.json"
        self.assertEqual(json.loads(marker.read_text())["version"], "1.7.0")
        self.assertFalse((staged / ".librephotos-update.json").exists())
        self.assertTrue(is_staged(staged, "1.7.0", MACOS_ARM64))
        self.assertFalse(is_staged(staged, "1.7.1", MACOS_ARM64))
        self.assertEqual(
            sorted(path.name for path in self.parent.iterdir()),
            [APP, f"{APP}-1.7.0", f"{APP}-1.7.0.librephotos-update.json"],
        )

    @skipIf(os.name == "nt", "file modes are a POSIX matter")
    def test_programs_stay_executable(self):
        session = release_session("1.7.0", mac_release_files())
        staged = stage_release(session, self.folder, "1.7.0")
        self.assertTrue(os.access(staged / BINARY, os.X_OK))
        self.assertTrue(os.access(staged / LAUNCHER, os.X_OK))
        self.assertFalse(os.access(staged / "Contents" / "Info.plist", os.X_OK))

    def test_the_mac_checksums_are_required(self):
        files = mac_release_files()
        del files[MACOS_ARM64.checksums_name]
        with self.assertRaises(DownloadError) as caught:
            stage_release(release_session("1.7.0", files), self.folder, "1.7.0")
        self.assertEqual(caught.exception.code, "missing_sha256sums")

    def test_a_windows_zip_is_not_a_mac_release(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "release.zip"
            archive.write_bytes(mac_release_zip())
            program = extract_release(archive, Path(directory), MACOS_ARM64)
            check_release(program, "1.7.0", MACOS_ARM64)
            with self.assertRaises(DownloadError):
                check_release(program, "1.7.0", WINDOWS)
            with self.assertRaises(DownloadError):
                extract_release(archive, Path(directory) / "other", WINDOWS)


class MacUpdateCheckTest(SimpleTestCase):
    def release(self, tag, assets):
        return {"tag_name": tag, "assets": [{"name": name} for name in assets]}

    def test_a_mac_is_offered_only_releases_with_its_zip(self):
        releases = [
            self.release("1.8.0", ["librephotos-windows-x64.zip"]),
            self.release("1.7.0", ["librephotos-macos-arm64.zip"]),
        ]
        asset = check.STANDALONE_ASSETS[check.MACOS]
        self.assertEqual(check.newest_release(releases, asset).latest, "1.7.0")
        windows = check.STANDALONE_ASSETS[check.WINDOWS]
        self.assertEqual(check.newest_release(releases, windows).latest, "1.8.0")
        self.assertTrue(
            check.HOW_TO_UPDATE_URLS[check.MACOS].endswith("macos#updating")
        )


class MacFinisherTest(SimpleTestCase):
    def setUp(self):
        patcher = patch.object(updater, "LAYOUT", MACOS_ARM64)
        patcher.start()
        self.addCleanup(patcher.stop)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.parent = Path(folder.name)
        self.current = mac_app(self.parent / APP, "1.6.0")
        self.staged = mac_app(self.parent / f"{APP}-1.7.0", "1.7.0")
        self.marker = self.parent / f"{APP}-1.7.0.librephotos-update.json"
        self.marker.write_text("{}")

    def request(self):
        return FinishRequest(
            old_pid=4242,
            old_dir=self.current,
            staged=self.staged,
            url=URL,
            log=self.parent / "update.log",
            cwd=str(self.parent),
            relaunch=("run",),
        )

    def test_the_finisher_runs_the_new_binary_inside_the_app(self):
        launch = updater.Launch(("run",), {}, "/")
        command = updater.finisher_command(
            self.staged, self.current, URL, self.parent / "u.log", launch
        )
        self.assertEqual(command[0], str(self.staged / BINARY))
        self.assertEqual(command[1], "finish-update")

    def test_an_app_opened_by_launch_services_is_opened_again(self):
        environ = {"__CFBundleIdentifier": release_layout.BUNDLE_ID}
        self.assertEqual(
            updater.relaunch_command(self.current, ["run"], environ),
            ["/usr/bin/open", "-n", "-a", str(self.current), "--args", "run"],
        )
        self.assertEqual(
            updater.relaunch_command(self.current, ["run"], {}),
            [str(self.current / LAUNCHER), "run"],
        )

    def test_the_apps_swap_and_the_marker_goes(self):
        with (
            patch.object(updater, "wait_for_exit", return_value=True),
            patch.object(updater, "stop_leftovers"),
            patch.object(updater, "launch_release", return_value=MagicMock(pid=9)),
            patch.object(updater, "wait_ready", return_value=True),
        ):
            self.assertEqual(finish_update(self.request(), [].append), 0)
        self.assertEqual((self.current / BINARY).read_text(), "1.7.0")
        rollback = self.parent / f"{APP}-old"
        self.assertEqual((rollback / BINARY).read_text(), "1.6.0")
        self.assertFalse(self.staged.exists())
        self.assertFalse(self.marker.exists())
        self.assertIn("/installation/macos#going-back", updater.going_back_url())

    def test_only_a_clean_old_app_is_deleted(self):
        self.assertEqual(updater.unexpected_entries(self.current), [])
        (self.current / "Contents" / "MacOS" / "helper").write_text("mine")
        self.assertEqual(
            updater.unexpected_entries(self.current), ["Contents/MacOS/helper"]
        )

    def test_an_opened_release_counts_as_running_while_it_starts(self):
        opener = MagicMock(pid=5)
        opener.poll.return_value = 0
        with patch.object(updater.time, "monotonic", side_effect=[0.0, 1.0, 120.0]):
            started = updater.OpenedRelease(opener, self.current)
            self.assertIsNone(started.poll())
            with patch.object(updater, "processes_in", return_value=[]):
                self.assertEqual(started.poll(), 0)
        opener.poll.return_value = 1
        self.assertEqual(started.poll(), 1)
