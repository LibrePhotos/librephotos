"""The Windows app's built-in updater as the web app drives it (#2788): its
states, when it is not offered, and ``/api/updates/install/`` and
``/api/updates/restart/`` (admins only)."""

import tempfile
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models.long_running_job import LongRunningJob
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.updates.release_fixtures import release_files, release_session
from api.tests.updates.test_update_check import session_answering
from api.tests.utils import create_test_job, create_test_user
from api.updates import install
from api.updates.check import check_for_updates
from api.updates.download import DownloadError
from api.updates.install import (
    DATA_IN_PROGRAM_FOLDER,
    FAILED,
    NOT_WINDOWS_APP,
    READ_ONLY,
    READY,
    RESTARTING,
    Installer,
    InstallError,
    blocked_reason,
    enable,
    install_state,
    running_job,
)
from api.updates.stage import ProgramFolder

VERSION = "1.4.0"


def program_folder(test):
    folder = tempfile.TemporaryDirectory()
    test.addCleanup(folder.cleanup)
    program = Path(folder.name) / "librephotos"
    program.mkdir()
    return program


class Settled:
    """Waits for the installer to leave the busy states."""

    def __init__(self, updater):
        self.done = threading.Event()
        self.states = []
        updater.subscribe(self.heard)

    def heard(self, state):
        self.states.append(state["state"])
        if state["state"] in (READY, FAILED):
            self.done.set()

    def wait(self):
        assert self.done.wait(10), self.states


def make_installer(test, files=None, restart=None):
    program = program_folder(test)
    session = release_session(VERSION, files or release_files(VERSION))
    return Installer(
        ProgramFolder(program), restart or MagicMock(), session_factory=lambda: session
    )


class InstallerTest(SimpleTestCase):
    def test_download_check_unpack_then_ready(self):
        updater = make_installer(self)
        settled = Settled(updater)
        state = updater.start(VERSION)
        self.assertEqual(state["state"], "downloading")
        self.assertTrue(state["supported"])
        settled.wait()
        self.assertEqual(
            [s for s in settled.states if s != "downloading"],
            ["verifying", "extracting", "ready"],
        )
        now = updater.state()
        self.assertEqual(now["state"], READY)
        self.assertEqual(now["received_bytes"], now["total_bytes"])
        self.assertFalse(now["signature_checked"])

    def test_starting_again_is_harmless_and_another_version_waits(self):
        updater = make_installer(self)
        with patch.object(install.threading, "Thread"):
            updater.start(VERSION)
            self.assertEqual(updater.start(VERSION)["state"], "downloading")
            with self.assertRaises(InstallError) as raised:
                updater.start("1.5.0")
        self.assertEqual(raised.exception.code, "update_in_progress")

    def test_a_failure_is_kept_with_its_code_and_can_be_retried(self):
        files = release_files(VERSION)
        del files["SHA256SUMS"]
        updater = make_installer(self, files)
        settled = Settled(updater)
        updater.start(VERSION)
        settled.wait()
        state = updater.state()
        self.assertEqual(
            (state["state"], state["error"]), (FAILED, "missing_sha256sums")
        )
        with patch.object(install.threading, "Thread"):
            self.assertEqual(updater.start(VERSION)["error"], None)

    def test_a_disk_error_is_reported_without_a_path(self):
        updater = make_installer(self)
        settled = Settled(updater)
        with patch.object(
            install, "stage_release", side_effect=PermissionError(13, "x")
        ):
            updater.start(VERSION)
            settled.wait()
        self.assertEqual(updater.state()["error"], "disk_error")

    def test_a_release_prepared_before_a_restart_is_ready_at_once(self):
        updater = make_installer(self)
        settled = Settled(updater)
        updater.start(VERSION)
        settled.wait()
        again = Installer(updater.folder, MagicMock())
        self.assertEqual(again.state()["state"], "idle")
        self.assertEqual(again.state("1.5.0")["state"], "idle")
        self.assertEqual(again.state(VERSION)["state"], READY)

    def test_restart_hands_the_prepared_folder_over(self):
        restart = MagicMock()
        updater = make_installer(self, restart=restart)
        with self.assertRaises(InstallError) as raised:
            updater.restart()
        self.assertEqual(raised.exception.code, "update_not_ready")
        settled = Settled(updater)
        updater.start(VERSION)
        settled.wait()
        self.assertEqual(updater.restart()["state"], RESTARTING)
        restart.assert_called_once_with(updater.folder.staged(VERSION))

    def test_a_failed_restart_keeps_the_update_ready(self):
        updater = make_installer(self, restart=MagicMock(side_effect=OSError(2, "x")))
        settled = Settled(updater)
        updater.start(VERSION)
        settled.wait()
        with self.assertRaises(InstallError) as raised:
            updater.restart()
        self.assertEqual(raised.exception.code, "restart_failed")
        state = updater.state()
        self.assertEqual((state["state"], state["error"]), (READY, "restart_failed"))


class EnableTest(SimpleTestCase):
    def setUp(self):
        patcher = patch.object(install, "_registry", install._Registry())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.program = program_folder(self)

    def test_not_enabled_means_not_the_windows_app(self):
        state = install_state(VERSION)
        self.assertFalse(state["supported"])
        self.assertEqual(state["reason"], NOT_WINDOWS_APP)
        self.assertIsNone(install.installer())

    def test_enabled_for_a_program_folder_it_may_replace(self):
        data = self.program.parent / "data"
        updater = enable(self.program, [data], MagicMock())
        self.assertIs(install.installer(), updater)
        self.assertTrue(install_state(None)["supported"])

    def test_data_inside_the_program_folder_blocks_it(self):
        self.assertEqual(
            blocked_reason(self.program, [self.program / "data"]),
            DATA_IN_PROGRAM_FOLDER,
        )
        self.assertIsNone(enable(self.program, [self.program], MagicMock()))
        self.assertEqual(install_state(VERSION)["reason"], DATA_IN_PROGRAM_FOLDER)

    def test_a_folder_it_cannot_write_next_to_blocks_it(self):
        with patch.object(install.tempfile, "mkdtemp", side_effect=PermissionError):
            self.assertEqual(blocked_reason(self.program, []), READ_ONLY)
        self.assertIsNone(blocked_reason(self.program, []))
        self.assertEqual(
            [p.name for p in self.program.parent.iterdir()], ["librephotos"]
        )


class RunningJobTest(TestCase):
    def test_upload_imports_do_not_count(self):
        user = create_test_user()
        self.assertIsNone(running_job())
        create_test_job(user, job_type=LongRunningJob.JOB_IMPORT_UPLOADS)
        self.assertIsNone(running_job())
        create_test_job(user)
        self.assertEqual(running_job(), "Scan Photos")


INSTALL_ROUTES = (
    ("post", "/api/updates/install/"),
    ("post", "/api/updates/restart/"),
)


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="windows", UPDATE_CHECK_ALLOWED=True)
class InstallApiTest(DeclaredResponseTestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        check_for_updates(session_answering())
        patcher = patch.object(install, "_registry", install._Registry())
        patcher.start()
        self.addCleanup(patcher.stop)

    def enable(self):
        self.restart = MagicMock()
        updater = make_installer(self, restart=self.restart)
        install._registry.installer = updater
        return updater

    def install(self, version=VERSION, status=202):
        if status != 202:
            # The error envelope (api/views/exception_handler.py).
            response = self.client.post(
                "/api/updates/install/", {"version": version}, format="json"
            )
            self.assertEqual(response.status_code, status)
            return response.json()
        return self.assert_declared(
            "/api/updates/install/",
            "/api/updates/install/",
            status=status,
            method="post",
            data={"version": version},
        )

    def test_the_status_says_what_the_updater_can_do(self):
        body = self.assert_declared("/api/updates/", "/api/updates/")
        self.assertEqual(body["install"]["reason"], NOT_WINDOWS_APP)
        self.enable()
        body = self.assert_declared("/api/updates/", "/api/updates/")
        self.assertTrue(body["install"]["supported"])
        self.assertEqual(body["install"]["state"], "idle")

    def test_not_the_windows_app(self):
        body = self.install(status=409)
        self.assertEqual(body["errors"][0]["code"], "not_supported")

    def test_only_the_newest_release(self):
        self.enable()
        for version in ("1.3.0", "1.5.0"):
            body = self.install(version, status=409)
            self.assertEqual(body["errors"][0]["code"], "not_the_newest_release")

    def test_download_then_restart(self):
        updater = self.enable()
        settled = Settled(updater)
        body = self.install()
        self.assertEqual(body["install"]["version"], VERSION)
        settled.wait()
        body = self.assert_declared("/api/updates/", "/api/updates/")
        self.assertEqual(body["install"]["state"], READY)
        body = self.assert_declared(
            "/api/updates/restart/",
            "/api/updates/restart/",
            status=202,
            method="post",
            data={},
        )
        self.assertEqual(body["install"]["state"], RESTARTING)
        self.restart.assert_called_once_with(updater.folder.staged(VERSION))
        # A second request while it restarts is refused.
        response = self.client.post("/api/updates/restart/", {}, format="json")
        self.assertEqual(response.json()["errors"][0]["code"], "update_not_ready")

    def test_a_download_in_progress_refuses_another(self):
        updater = self.enable()
        with patch.object(
            updater, "start", side_effect=InstallError("update_in_progress")
        ):
            body = self.install(status=409)
        self.assertEqual(body["errors"][0]["code"], "update_in_progress")
        self.assertEqual(
            body["errors"][0]["message"], "Another release is being downloaded."
        )

    def test_a_running_job_asks_first(self):
        updater = self.enable()
        updater._staged = updater.folder.staged(VERSION)
        updater._now = install._Progress(state=READY, version=VERSION)
        create_test_job(self.admin)
        response = self.client.post("/api/updates/restart/", {}, format="json")
        self.assertEqual(response.status_code, 409)
        error = response.json()["errors"][0]
        self.assertEqual(error["code"], "job_running")
        self.assertIn("Scan Photos", error["message"])
        self.restart.assert_not_called()
        response = self.client.post(
            "/api/updates/restart/", {"force": True}, format="json"
        )
        self.assertEqual(response.status_code, 202)
        self.restart.assert_called_once_with(updater.folder.staged(VERSION))

    def test_force_must_be_a_json_boolean(self):
        self.enable()
        response = self.client.post(
            "/api/updates/restart/", {"force": "yes"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_non_admins_and_anonymous_get_nothing(self):
        self.enable()
        user = APIClient()
        user.force_authenticate(create_test_user())
        for method, url in INSTALL_ROUTES:
            with self.subTest(url=url):
                self.assertEqual(getattr(user, method)(url, {}).status_code, 403)
                self.assertIn(
                    getattr(APIClient(), method)(url, {}).status_code, (401, 403)
                )


class DownloadErrorTest(SimpleTestCase):
    def test_the_code_is_the_message(self):
        self.assertEqual(str(DownloadError("disk_full")), "disk_full")
