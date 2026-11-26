import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.updates.release_fixtures import checksums_for, release_session
from api.tests.updates.test_update_check import session_answering
from api.tests.updates.test_update_install import Settled
from api.tests.updates.test_update_tray import install_state
from api.tests.utils import create_test_user
from api.updates import install
from api.updates.check import check_for_updates
from api.updates.download import (
    GITHUB,
    DownloadError,
    ReleaseSource,
    release_source,
)
from api.updates.install import (
    ALREADY_INSTALLED,
    DATA_IN_PROGRAM_FOLDER,
    MOVE,
    NOT_A_RELEASE,
    NOT_WINDOWS_APP,
    READY,
    RESTARTING,
    Fetching,
    Installer,
    InstallError,
    Moves,
    Surroundings,
)
from api.updates.setup_file import setup_name, stage_setup
from api.updates.stage import ProgramFolder
from api.updates.tray import (
    MENU_MOVE,
    MENU_MOVE_RESTART,
    NOTICE_MOVE_READY,
    START_MOVE,
    TrayUpdates,
    install_notice,
    menu_entry,
)
from librephotos.installation import INSTALLED, PORTABLE

CURRENT = "1.3.0"
SETUP = b"MZ the installer of 1.3.0"


def setup_files(version=CURRENT, data=SETUP, listed=None):
    name = setup_name(version)
    return {name: data, "SHA256SUMS": checksums_for({name: listed or data})}


class MoveFolders(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.program = self.root / "LibrePhotos-app" / "librephotos"
        self.program.mkdir(parents=True)
        self.downloads = self.root / "data" / "updates"
        self.move = MagicMock()

    def installer(self, files=None, layout=PORTABLE, data_dirs=()):
        session = release_session(CURRENT, files or setup_files())
        return Installer(
            ProgramFolder(self.program),
            MagicMock(),
            Surroundings(tuple(data_dirs)),
            Fetching(lambda: session),
            Moves(layout, self.downloads, self.move),
        )


class StageSetupTest(MoveFolders):
    def test_the_checked_installer_lands_in_the_downloads_folder(self):
        session = release_session(CURRENT, setup_files())
        setup = stage_setup(session, self.downloads, CURRENT)
        self.assertEqual(setup, self.downloads / "LibrePhotos-Setup-1.3.0.exe")
        self.assertEqual(setup.read_bytes(), SETUP)
        self.assertEqual(stage_setup(session, self.downloads, CURRENT), setup)
        self.assertEqual(list(self.downloads.iterdir()), [setup])

    def test_a_damaged_download_is_deleted(self):
        session = release_session(CURRENT, setup_files(listed=b"something else"))
        with self.assertRaises(DownloadError) as raised:
            stage_setup(session, self.downloads, CURRENT)
        self.assertEqual(raised.exception.code, "checksum_mismatch")
        self.assertEqual(list(self.downloads.iterdir()), [])

    def test_a_release_without_an_installer_has_no_checksum_for_it(self):
        files = {"SHA256SUMS": checksums_for({"librephotos-windows-x64.zip": b"z"})}
        with self.assertRaises(DownloadError) as raised:
            stage_setup(release_session(CURRENT, files), self.downloads, CURRENT)
        self.assertEqual(raised.exception.code, "no_checksum")

    def test_no_room_for_it(self):
        session = release_session(CURRENT, setup_files())
        free = MagicMock(free=1)
        with patch("api.updates.stage.shutil.disk_usage", return_value=free):
            with self.assertRaises(DownloadError) as raised:
                stage_setup(session, self.downloads, CURRENT)
        self.assertEqual(raised.exception.code, "disk_full")


class InstallerMoveTest(MoveFolders):
    def test_download_then_hand_the_installer_over(self):
        updater = self.installer()
        settled = Settled(updater)
        started = updater.start_move(CURRENT)
        self.assertEqual((started["state"], started["kind"]), ("downloading", MOVE))
        settled.wait()
        state = updater.state(None, CURRENT)
        self.assertEqual((state["state"], state["kind"]), (READY, MOVE))
        self.assertEqual(state["layout"], PORTABLE)
        self.assertTrue(state["move_supported"])
        self.assertEqual(updater.restart()["state"], RESTARTING)
        expected = self.downloads / "LibrePhotos-Setup-1.3.0.exe"
        self.move.assert_called_once_with(expected)
        self.assertEqual(expected.read_bytes(), SETUP)

    def test_an_update_download_waits_while_the_move_downloads(self):
        updater = self.installer()
        with patch.object(install.threading, "Thread"):
            updater.start_move(CURRENT)
            self.assertEqual(updater.start_move(CURRENT)["state"], "downloading")
            with self.assertRaises(InstallError) as raised:
                updater.start("1.4.0")
        self.assertEqual(raised.exception.code, "update_in_progress")

    def test_a_failed_move_download_says_why(self):
        updater = self.installer(files={"SHA256SUMS": b""})
        settled = Settled(updater)
        updater.start_move(CURRENT)
        settled.wait()
        state = updater.state(None, CURRENT)
        self.assertEqual((state["state"], state["error"]), ("failed", "no_checksum"))

    def test_it_is_offered_only_to_a_portable_release(self):
        self.assertIsNone(self.installer().move_blocked(CURRENT))
        self.assertEqual(
            self.installer(layout=INSTALLED).move_blocked(CURRENT), ALREADY_INSTALLED
        )
        self.assertEqual(self.installer().move_blocked(""), NOT_A_RELEASE)
        self.assertEqual(self.installer().move_blocked("2026w20"), NOT_A_RELEASE)
        inside = self.installer(data_dirs=[self.program / "data"])
        self.assertEqual(inside.move_blocked(CURRENT), DATA_IN_PROGRAM_FOLDER)
        with self.assertRaises(InstallError) as raised:
            self.installer(layout=INSTALLED).start_move(CURRENT)
        self.assertEqual(raised.exception.code, ALREADY_INSTALLED)

    def test_a_read_only_folder_blocks_the_update_but_not_the_move(self):
        updater = self.installer()
        with patch.object(install.tempfile, "mkdtemp", side_effect=PermissionError):
            state = updater.state(None, CURRENT)
        self.assertEqual(state["reason"], "read_only")
        self.assertTrue(state["move_supported"])

    def test_without_moves_there_is_nothing_to_move(self):
        updater = Installer(ProgramFolder(self.program), MagicMock())
        self.assertEqual(updater.move_blocked(CURRENT), NOT_WINDOWS_APP)
        state = updater.state(None, CURRENT)
        self.assertIsNone(state["layout"])
        self.assertFalse(state["move_supported"])


class ReleaseSourceTest(SimpleTestCase):
    def test_github_unless_a_source_is_given(self):
        self.assertIs(release_source(""), GITHUB)

    def test_a_local_feed_over_http_on_this_machine(self):
        source = release_source("http://127.0.0.1:8123/releases/download/")
        self.assertEqual(
            source.asset_url("1.3.0", "SHA256SUMS"),
            "http://127.0.0.1:8123/releases/download/1.3.0/SHA256SUMS",
        )
        self.assertEqual(source.check("http://127.0.0.1:9/x"), "http://127.0.0.1:9/x")
        with self.assertRaises(DownloadError):
            source.check("https://github.com/x")

    def test_plain_http_elsewhere_is_refused(self):
        for url in ("http://example.com/feed", "ftp://127.0.0.1/", "file:///C:/x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                release_source(url)
        self.assertIsInstance(release_source("https://mirror.example/r"), ReleaseSource)

    @override_settings(UPDATE_RELEASE_SOURCE="http://localhost:1/r")
    def test_enable_reads_the_setting(self):
        with patch.object(install, "_registry", install._Registry()):
            updater = install.enable(Path("P", "librephotos"), [], MagicMock())
        self.assertEqual(updater._fetching.source.base_url, "http://localhost:1/r")


@override_settings(IMAGE_TAG=CURRENT, INSTALL_TYPE="windows", UPDATE_CHECK_ALLOWED=True)
class MoveApiTest(DeclaredResponseTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        self.program = root / "LibrePhotos-app" / "librephotos"
        self.program.mkdir(parents=True)
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        check_for_updates(session_answering())
        patcher = patch.object(install, "_registry", install._Registry())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.move = MagicMock()
        session = release_session(CURRENT, setup_files())
        self.updater = Installer(
            ProgramFolder(self.program),
            MagicMock(),
            fetching=Fetching(lambda: session),
            moves=Moves(PORTABLE, root / "data" / "updates", self.move),
        )

    def test_not_the_windows_app(self):
        response = self.client.post("/api/updates/move/", {}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["errors"][0]["code"], "not_supported")

    def test_the_status_offers_the_move(self):
        install._registry.installer = self.updater
        body = self.assert_declared("/api/updates/", "/api/updates/")
        self.assertEqual(body["install"]["layout"], PORTABLE)
        self.assertTrue(body["install"]["move_supported"])
        self.assertIsNone(body["install"]["move_reason"])

    def test_move_then_restart_hands_the_installer_over(self):
        install._registry.installer = self.updater
        settled = Settled(self.updater)
        body = self.assert_declared(
            "/api/updates/move/",
            "/api/updates/move/",
            status=202,
            method="post",
            data={},
        )
        self.assertEqual(
            (body["install"]["kind"], body["install"]["version"]), (MOVE, CURRENT)
        )
        settled.wait()
        response = self.client.post(
            "/api/updates/restart/", {"force": True}, format="json"
        )
        self.assertEqual(response.status_code, 202)
        self.move.assert_called_once()

    def test_an_installed_copy_is_not_moved(self):
        self.updater._moves = Moves(INSTALLED, self.program, self.move)
        install._registry.installer = self.updater
        response = self.client.post("/api/updates/move/", {}, format="json")
        self.assertEqual(response.status_code, 409)
        error = response.json()["errors"][0]
        self.assertEqual(error["code"], ALREADY_INSTALLED)
        self.assertIn("installed version", error["message"])

    def test_non_admins_and_anonymous_get_nothing(self):
        install._registry.installer = self.updater
        user = APIClient()
        user.force_authenticate(create_test_user())
        self.assertEqual(user.post("/api/updates/move/", {}).status_code, 403)
        self.assertIn(
            APIClient().post("/api/updates/move/", {}).status_code, (401, 403)
        )
        self.move.assert_not_called()


class TrayMoveTest(SimpleTestCase):
    def entry(self, install, available=False):
        status = {"update_available": available, "latest": "1.4.0", "install": install}
        return menu_entry(status)

    def test_a_portable_copy_offers_the_move_while_no_update_is_known(self):
        movable = install_state("idle", move_supported=True)
        self.assertEqual(self.entry(movable), (MENU_MOVE, START_MOVE))
        self.assertEqual(self.entry(install_state("idle")), (None, None))
        self.assertEqual(
            self.entry(movable, available=True),
            ("Download LibrePhotos 1.4.0", "download"),
        )

    def test_the_move_shows_its_progress_and_then_restart(self):
        def moving(state, **fields):
            return install_state(state, kind=MOVE, **fields)

        self.assertEqual(
            self.entry(moving("downloading", received_bytes=1, total_bytes=4), True),
            ("Downloading the installer (25 %)", None),
        )
        self.assertEqual(
            self.entry(moving("downloading")), ("Downloading the installer...", None)
        )
        self.assertEqual(
            self.entry(moving("verifying")), ("Checking the installer...", None)
        )
        self.assertEqual(
            self.entry(moving("ready"), True), (MENU_MOVE_RESTART, "restart")
        )
        self.assertEqual(
            self.entry(moving("restarting")),
            ("Moving to the installed version...", None),
        )

    def test_the_end_of_the_move_download_is_announced(self):
        self.assertEqual(
            install_notice(install_state("ready", kind=MOVE)), NOTICE_MOVE_READY
        )
        title, text = install_notice(
            install_state("failed", kind=MOVE, error="checksum_mismatch")
        )
        self.assertIn("could not move", title)
        self.assertIn("damaged", text)

    def test_choosing_it_starts_the_move(self):
        tray, updater = MagicMock(), MagicMock()
        updates = TrayUpdates(tray, updater)
        with patch("api.updates.tray.current_version", return_value=CURRENT):
            updates.move()
        updater.start_move.assert_called_once_with(CURRENT)
        tray.notify.assert_called_once()
        updater.start_move.side_effect = InstallError(ALREADY_INSTALLED)
        with patch("api.updates.tray.current_version", return_value=CURRENT):
            updates.move()
        self.assertIn("already runs", tray.notify.call_args.args[1])
        self.assertIsNone(TrayUpdates(tray).move())
