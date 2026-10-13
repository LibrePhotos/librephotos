"""The standalone build (librephotos/standalone.py) and how api.runtime.supervisor starts
and stops sidecars from it.

Everything here runs from source: the compiled binary is recognised through
``__main__.__compiled__``, which these tests fake, so the behaviour the binary
relies on is covered without a Nuitka build.
"""

import os
import subprocess
import sys
import tempfile
from io import StringIO
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.runtime import supervisor
from librephotos import standalone

FAKE_COMPILED = SimpleNamespace(
    standalone=True, original_argv0=r"C:\LibrePhotos\librephotos.exe"
)


def as_compiled():
    """Make librephotos.standalone look compiled by Nuitka in standalone mode."""
    return patch.object(standalone, "__compiled__", FAKE_COMPILED, create=True)


class StandaloneExecutableTest(SimpleTestCase):
    def test_none_from_source(self):
        self.assertIsNone(standalone.standalone_executable())

    def test_the_binary_when_compiled(self):
        with as_compiled():
            self.assertEqual(
                standalone.standalone_executable(),
                os.path.abspath(FAKE_COMPILED.original_argv0),
            )

    def test_a_compiled_module_that_is_not_standalone_counts_as_source(self):
        not_standalone = SimpleNamespace(standalone=False, original_argv0="x")
        with patch.object(standalone, "__compiled__", not_standalone, create=True):
            self.assertIsNone(standalone.standalone_executable())

    def test_child_command_runs_the_binary_or_the_script(self):
        self.assertEqual(
            standalone.child_command("manage", "qcluster")[1:],
            [
                os.path.join(standalone.BACKEND_ROOT, "librephotos_standalone.py"),
                "manage",
                "qcluster",
            ],
        )
        with as_compiled():
            self.assertEqual(
                standalone.child_command("manage", "qcluster"),
                [os.path.abspath(FAKE_COMPILED.original_argv0), "manage", "qcluster"],
            )


class ArgumentsTest(SimpleTestCase):
    def test_bare_invocation_means_run(self):
        args = standalone.parse_args([])
        self.assertEqual(args.command, "run")
        self.assertEqual(args.port, standalone.DEFAULT_PORT)

    def test_global_options_alone_still_mean_run(self):
        args = standalone.parse_args(["--data-dir", "D:\\lp"])
        self.assertEqual((args.command, args.data_dir), ("run", "D:\\lp"))

    def test_manage_keeps_every_argument_for_django(self):
        args = standalone.parse_args(["manage", "migrate", "--noinput"])
        self.assertEqual(args.argv, ["migrate", "--noinput"])

    def test_service_names_the_sidecar(self):
        self.assertEqual(standalone.parse_args(["service", "exif"]).name, "exif")

    def test_every_sidecar_has_a_module_that_serves(self):
        for name in supervisor.SERVICES:
            module = standalone.service_module_name(name)
            path = os.path.join(
                standalone.BACKEND_ROOT, *module.split(".")[:-1], "main.py"
            )
            with open(path, encoding="utf-8") as handle:
                self.assertRegex(
                    handle.read(), r"(?m)^def serve\(\)( -> None)?:", module
                )


class PrepareEnvironmentTest(SimpleTestCase):
    def test_defaults_derive_from_the_data_dir(self):
        with (
            patch.dict(os.environ, {}, clear=False),
            patch("os.makedirs") as makedirs,
        ):
            for key in ("BASE_DATA", "BASE_LOGS", "PHOTOS", "DJANGO_SETTINGS_MODULE"):
                os.environ.pop(key, None)
            data = standalone.prepare_environment("/tmp/lp-data", "/tmp/pictures")

            self.assertEqual(data, os.path.abspath("/tmp/lp-data"))
            self.assertEqual(os.environ["BASE_DATA"], data)
            self.assertEqual(os.environ["BASE_LOGS"], os.path.join(data, "logs"))
            self.assertEqual(os.environ["PHOTOS"], os.path.abspath("/tmp/pictures"))
            self.assertEqual(
                os.environ["DJANGO_SETTINGS_MODULE"], "librephotos.settings.standalone"
            )
            makedirs.assert_called_once_with(os.environ["BASE_LOGS"], exist_ok=True)

    def test_explicit_environment_wins_over_defaults(self):
        with (
            patch.dict(
                os.environ,
                {
                    "BASE_LOGS": "/var/log/lp",
                    "DJANGO_SETTINGS_MODULE": "librephotos.settings.production",
                },
            ),
            patch("os.makedirs"),
        ):
            standalone.prepare_environment("/tmp/lp-data")
            self.assertEqual(os.environ["BASE_LOGS"], "/var/log/lp")
            self.assertEqual(
                os.environ["DJANGO_SETTINGS_MODULE"], "librephotos.settings.production"
            )

    def test_bundled_binaries_lead_the_path(self):
        with (
            patch.dict(os.environ, {"PATH": "/usr/bin"}),
            patch("os.makedirs"),
            patch.object(standalone, "install_root", return_value="/opt/lp"),
            patch("os.path.isdir", return_value=True),
        ):
            standalone.prepare_environment("/tmp/lp-data")
            head = os.environ["PATH"].split(os.pathsep)[:2]
            self.assertEqual(
                head,
                [
                    os.path.join("/opt/lp", "exiftool_bin"),
                    os.path.join("/opt/lp", "ffmpeg_bin", "bin"),
                ],
            )

    def _prepare_with_build_info(self, content, environ=None):
        """prepare_environment in a distribution whose build_info.json says ``content``."""
        with tempfile.TemporaryDirectory() as root:
            if content is not None:
                with open(
                    os.path.join(root, standalone.BUILD_INFO_NAME),
                    "w",
                    encoding="utf-8",
                ) as handle:
                    handle.write(content)
            with (
                patch.dict(os.environ, environ or {}),
                patch("os.makedirs"),
                patch.object(standalone, "install_root", return_value=root),
            ):
                if not environ:
                    os.environ.pop("IMAGE_TAG", None)
                    os.environ.pop("GIT_HASH", None)
                standalone.prepare_environment("/tmp/lp-data")
                return os.environ.get("IMAGE_TAG"), os.environ.get("GIT_HASH")

    def test_a_release_build_reports_its_version(self):
        """Otherwise the sidebar says "dev": only the images set IMAGE_TAG."""
        self.assertEqual(
            self._prepare_with_build_info(
                '{"version": "1.3.0", "git_hash": "abc1234"}'
            ),
            ("1.3.0", "abc1234"),
        )

    def test_the_environment_wins_over_the_build_info(self):
        self.assertEqual(
            self._prepare_with_build_info(
                '{"version": "1.3.0", "git_hash": "abc1234"}',
                {"IMAGE_TAG": "custom", "GIT_HASH": "def5678"},
            ),
            ("custom", "def5678"),
        )

    def test_no_or_a_broken_build_info_changes_nothing(self):
        for content in (None, "not json", "[]", '{"version": ""}'):
            self.assertEqual(self._prepare_with_build_info(content), (None, None))


@patch("api.runtime.supervisor.subprocess.Popen")
class SidecarCommandTest(SimpleTestCase):
    def test_from_source_the_script_runs_under_python(self, popen):
        supervisor.start_service("thumbnail")
        self.assertEqual(
            popen.call_args.args[0], ["python", "service/thumbnail/main.py"]
        )

    def test_image_similarity_lives_outside_service(self, popen):
        supervisor.start_service("image_similarity")
        self.assertEqual(
            popen.call_args.args[0], ["python", "image_similarity/main.py"]
        )

    def test_compiled_the_binary_runs_the_sidecar_itself(self, popen):
        with as_compiled():
            supervisor.start_service("thumbnail")
        self.assertEqual(
            popen.call_args.args[0],
            [os.path.abspath(FAKE_COMPILED.original_argv0), "service", "thumbnail"],
        )


class ServiceProcessMatchTest(SimpleTestCase):
    def test_matches_both_ways_of_running_a_sidecar(self):
        self.assertTrue(
            supervisor._is_service_process(["python", "service/exif/main.py"], "exif")
        )
        self.assertTrue(
            supervisor._is_service_process(
                [r"C:\venv\Scripts\python.exe", r"C:\code\service\exif\main.py"], "exif"
            )
        )
        self.assertTrue(
            supervisor._is_service_process(
                [r"C:\LibrePhotos\librephotos.exe", "service", "exif"], "exif"
            )
        )

    def test_does_not_match_other_services_or_unrelated_processes(self):
        self.assertFalse(
            supervisor._is_service_process(["python", "service/tags/main.py"], "exif")
        )
        self.assertFalse(
            supervisor._is_service_process(
                ["librephotos.exe", "service", "tags"], "exif"
            )
        )
        self.assertFalse(
            supervisor._is_service_process(["vim", "service/exif/main.py"], "exif")
        )
        self.assertFalse(supervisor._is_service_process(None, "exif"))
        self.assertFalse(supervisor._is_service_process(["python"], "exif"))


# stop_service itself: api/tests/ml_services/test_service_watchdog.py


class WorkerDefaultTest(SimpleTestCase):
    """The settings import has side effects (directories, secret key), so it is
    read in a child process pointed at a scratch directory."""

    def _workers(self, **extra_env):
        with tempfile.TemporaryDirectory() as scratch:
            env = {
                **{k: v for k, v in os.environ.items() if k != "WORKER_CONCURRENCY"},
                "BASE_DATA": scratch,
                "BASE_LOGS": os.path.join(scratch, "logs"),
                "SECRET_KEY": "test",
                **extra_env,
            }
            output = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "from librephotos.settings import standalone as s;"
                    "print('workers=%d' % s.Q_CLUSTER['workers'])",
                ],
                cwd=standalone.BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        return int(output.rsplit("workers=", 1)[1])

    def test_two_workers_unless_told_otherwise(self):
        self.assertEqual(self._workers(), 2)

    def test_worker_concurrency_still_overrides(self):
        self.assertEqual(self._workers(WORKER_CONCURRENCY="5"), 5)


class NamedExecutableTest(SimpleTestCase):
    """Process names are hard links to the one binary, made on first use."""

    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.exe = os.path.join(self.root.name, "librephotos.exe")
        with open(self.exe, "wb") as handle:
            handle.write(b"binary")
        compiled = SimpleNamespace(standalone=True, original_argv0=self.exe)
        patcher = patch.object(standalone, "__compiled__", compiled, create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_none_from_source(self):
        with patch.object(standalone, "standalone_executable", return_value=None):
            self.assertIsNone(standalone.named_executable("tags"))

    def test_links_the_binary_under_the_role_name(self):
        named = standalone.named_executable("exif")
        self.assertEqual(os.path.basename(named), "librephotos-metadata.exe")
        self.assertTrue(os.path.samefile(named, self.exe))
        # A second call reuses the link.
        self.assertEqual(standalone.named_executable("exif"), named)

    def test_a_role_without_a_name_is_the_binary_itself(self):
        self.assertEqual(standalone.named_executable(None), os.path.abspath(self.exe))
        self.assertEqual(
            standalone.named_executable("nonsense"), os.path.abspath(self.exe)
        )

    def test_a_link_to_a_previous_version_is_replaced(self):
        stale = os.path.join(self.root.name, "librephotos-tags.exe")
        with open(stale, "wb") as handle:
            handle.write(b"last version")
        named = standalone.named_executable("tags")
        self.assertEqual(named, stale)
        self.assertTrue(os.path.samefile(named, self.exe))

    def test_falls_back_to_the_binary_when_linking_fails(self):
        with patch("os.link", side_effect=PermissionError("read-only")):
            self.assertEqual(
                standalone.named_executable("tags"), os.path.abspath(self.exe)
            )

    def test_every_sidecar_and_the_cluster_have_a_name(self):
        named = set(standalone.PROCESS_NAMES)
        self.assertEqual(named, set(supervisor.SERVICES) | {"jobs", "worker"})
        self.assertEqual(
            len(set(standalone.PROCESS_NAMES.values())), len(standalone.PROCESS_NAMES)
        )

    def test_sidecars_start_under_their_name(self):
        with (
            # Whether face detection is switched on is not this test's
            # business, and reading the site setting needs the database.
            patch("api.runtime.supervisor.is_service_enabled", return_value=True),
            patch("api.runtime.supervisor.subprocess.Popen") as popen,
        ):
            supervisor.start_service("face_recognition")
        argv = popen.call_args.args[0]
        self.assertEqual(os.path.basename(argv[0]), "librephotos-faces.exe")
        self.assertEqual(argv[1:], ["service", "face_recognition"])

    def test_the_cluster_spawns_its_children_under_the_worker_name(self):
        with (
            patch("multiprocessing.set_executable") as set_executable,
            patch("django.core.management.execute_from_command_line"),
        ):
            standalone.run_manage(["qcluster"])
        (path,), _ = set_executable.call_args
        self.assertEqual(os.path.basename(path), "librephotos-worker.exe")

    def test_other_commands_leave_multiprocessing_alone(self):
        with (
            patch("multiprocessing.set_executable") as set_executable,
            patch("django.core.management.execute_from_command_line"),
        ):
            standalone.run_manage(["migrate"])
        set_executable.assert_not_called()


class SidecarHostTest(SimpleTestCase):
    def test_sidecars_default_to_loopback(self):
        with patch.dict(os.environ), patch("os.makedirs"):
            os.environ.pop("SERVICE_HOST", None)
            standalone.prepare_environment("/tmp/lp-data")
            self.assertEqual(os.environ["SERVICE_HOST"], "127.0.0.1")

    def test_an_explicit_host_wins(self):
        with patch.dict(os.environ, {"SERVICE_HOST": "0.0.0.0"}), patch("os.makedirs"):
            standalone.prepare_environment("/tmp/lp-data")
            self.assertEqual(os.environ["SERVICE_HOST"], "0.0.0.0")


class BackgroundModeTest(SimpleTestCase):
    """Without a console the binary lives in the notification area."""

    def test_from_source_the_process_setup_changes_nothing(self):
        before = subprocess.Popen.__init__
        standalone.bootstrap_process()
        self.assertIs(subprocess.Popen.__init__, before)

    def test_output_bound_to_nul_counts_as_discarded(self):
        with patch.object(sys, "stdout", SimpleNamespace(name="NUL:")):
            self.assertTrue(standalone._output_is_discarded())
        with patch.object(sys, "stdout", SimpleNamespace(name="<stdout>")):
            self.assertFalse(standalone._output_is_discarded())

    def test_no_tray_is_an_option_of_run(self):
        self.assertFalse(standalone.parse_args([]).no_tray)
        self.assertTrue(standalone.parse_args(["run", "--no-tray"]).no_tray)

    def test_a_second_start_shows_the_running_instance(self):
        with (
            patch.object(standalone, "_already_running", return_value=True),
            patch.object(standalone, "_take_children_down_with_us") as job,
            patch("webbrowser.open") as browser,
        ):
            standalone.run_server("127.0.0.1", 8000, open_browser=True)
        browser.assert_called_once_with("http://127.0.0.1:8000/")
        job.assert_not_called()

    def test_a_failed_start_is_reported_not_swallowed(self):
        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "run_server", side_effect=RuntimeError("port")),
            patch.object(standalone, "_report_failure") as report,
            patch("traceback.print_exc"),
            self.assertRaises(SystemExit) as raised,
        ):
            standalone.main(["run"])
        self.assertEqual(raised.exception.code, 1)
        self.assertIn("port", report.call_args.args[0])


DISK_FULL = (
    "There is not enough free disk space to back up the database before "
    "updating it: 400 MB is needed on drive C: and 12 MB is free. Free some "
    "disk space on drive C: and start LibrePhotos again."
)
NEWER_DATABASE_OUTPUT = [
    "Operations to perform:",
    "SystemCheckError: System check identified some issues:",
    "",
    "ERRORS:",
    "?: (librephotos.E002) The database 'default' was last used by a newer "
    "LibrePhotos release (it has migration api.0170_x, which this release "
    "does not know). Running this older release on it could damage it.",
    "\tHINT: Start the newer release again, or restore the backup made before "
    "that upgrade.",
]


class StartupStepTest(SimpleTestCase):
    """backup_database and migrate run as children before the server (#2314, #2315)."""

    def start(self, *results):
        with (
            patch.object(standalone, "_already_running", return_value=False),
            patch.object(standalone, "_take_children_down_with_us"),
            patch.object(standalone, "run_teed", side_effect=list(results)) as teed,
            patch("django.setup") as setup,
            self.assertRaises(standalone.StartupError) as raised,
        ):
            standalone.run_server("127.0.0.1", 8000, open_browser=False, tray=False)
        setup.assert_not_called()
        return str(raised.exception), [call.args[0] for call in teed.call_args_list]

    def test_no_backup_means_no_migration(self):
        message, commands = self.start(
            (1, ["Traceback ...", f"CommandError: {DISK_FULL}"])
        )

        self.assertEqual(len(commands), 1)
        self.assertEqual(
            commands[0][-3:], ["manage", "backup_database", "--if-pending-migrations"]
        )
        self.assertTrue(
            message.startswith(
                "LibrePhotos could not back up your database before updating it, "
                "so it did not start."
            )
        )
        self.assertIn(
            "Free some disk space on drive C: and start LibrePhotos again.", message
        )

    def test_a_refused_migration_names_the_check(self):
        message, commands = self.start(
            (0, ["No pending migrations"]), (1, NEWER_DATABASE_OUTPUT)
        )

        self.assertEqual(commands[1][-3:], ["manage", "migrate", "--noinput"])
        self.assertIn("could not update its database", message)
        self.assertIn("was last used by a newer LibrePhotos release", message)
        self.assertIn("Start the newer release again", message)
        self.assertNotIn("HINT", message)

    def test_a_failure_without_a_known_reason_still_says_what_failed(self):
        message, _ = self.start((0, []), (1, ["Segmentation fault"]))
        self.assertEqual(
            message, "LibrePhotos could not update its database, so it did not start."
        )

    def test_the_message_box_gets_the_plain_reason(self):
        error = standalone.StartupError("LibrePhotos could not back up your database.")
        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "run_server", side_effect=error),
            patch.object(standalone, "_report_failure") as report,
            self.assertRaises(SystemExit) as raised,
        ):
            standalone.main(["run"])
        self.assertEqual(raised.exception.code, 1)
        report.assert_called_once_with("LibrePhotos could not back up your database.")


class ServeTest(SimpleTestCase):
    def serve(self, started):
        server = SimpleNamespace(
            run=lambda: None,
            started=started,
            config=SimpleNamespace(host="127.0.0.1", port=8000),
        )
        cluster = object()
        icon = MagicMock()
        with (
            patch.object(standalone, "_set_console_title"),
            patch.object(standalone, "_start_tray", return_value=icon) as tray,
            patch.object(standalone, "_open_browser_when_up") as browser,
            patch.object(standalone, "_shutdown") as shutdown,
        ):
            try:
                standalone._serve(server, cluster, "http://x/", True, True)
            finally:
                shutdown.assert_called_once_with(cluster)
        browser.assert_called_once_with("http://x/")
        return tray, icon

    def test_runs_until_the_server_stops_then_shuts_down(self):
        tray, icon = self.serve(started=True)
        if sys.platform == "win32":
            tray.assert_called_once()
            icon.stop.assert_called_once_with()
        else:
            tray.assert_not_called()

    def test_a_server_that_never_started_is_an_error(self):
        with self.assertRaisesMessage(RuntimeError, "127.0.0.1:8000"):
            self.serve(started=False)


class CaptureConsoleOutputTest(SimpleTestCase):
    def test_without_a_console_output_goes_to_console_log(self):
        with (
            tempfile.TemporaryDirectory() as logs,
            patch.dict(os.environ, {"BASE_LOGS": logs}),
            as_compiled(),
            patch.object(standalone, "_output_is_discarded", return_value=True),
            patch.object(standalone, "_redirect_output") as redirect,
        ):
            standalone._capture_console_output()
            expected = os.path.join(logs, standalone.CONSOLE_LOG_NAME)
            self.assertEqual(os.environ[standalone.CONSOLE_LOG_ENV], expected)
        redirect.assert_called_once_with(expected, "w")

    def test_from_source_output_stays_where_it_is(self):
        with patch.object(standalone, "_redirect_output") as redirect:
            standalone._capture_console_output()
        redirect.assert_not_called()


class FailureDetailTest(SimpleTestCase):
    def test_a_check_error_with_its_hint(self):
        detail = standalone.failure_detail(NEWER_DATABASE_OUTPUT)
        self.assertTrue(detail.startswith("The database 'default' was last used"))
        self.assertTrue(detail.endswith("restore the backup made before that upgrade."))

    def test_a_check_error_without_a_hint(self):
        detail = standalone.failure_detail(
            ["?: (librephotos.E001) Too old.", "", "WARNINGS:"]
        )
        self.assertEqual(detail, "Too old.")

    def test_the_last_reason_wins(self):
        detail = standalone.failure_detail(
            ["?: (librephotos.E001) Too old.", "CommandError: Disk full."]
        )
        self.assertEqual(detail, "Disk full.")

    def test_nothing_recognisable(self):
        self.assertIsNone(standalone.failure_detail(["Traceback", "KeyError: 'x'"]))
        self.assertIsNone(standalone.failure_detail([]))


class RunTeedTest(SimpleTestCase):
    def test_output_is_copied_and_kept_for_the_failure_message(self):
        script = (
            "import sys; print('applying caf\u00e9'); "
            "print('CommandError: no room', file=sys.stderr); sys.exit(3)"
        )
        copied = StringIO()
        with patch.object(sys, "stdout", copied):
            returncode, lines = standalone.run_teed([sys.executable, "-c", script])

        self.assertEqual(returncode, 3)
        self.assertEqual(lines, ["applying café", "CommandError: no room"])
        self.assertEqual(copied.getvalue().splitlines(), lines)


@skipUnless(sys.platform == "win32", "console windows are a Windows matter")
class HideChildConsolesTest(SimpleTestCase):
    def setUp(self):
        self.calls = []

        def recorder(popen, *args, **kwargs):
            popen._child_created = False  # keeps Popen.__del__ quiet
            self.calls.append(kwargs)

        patcher = patch.object(subprocess.Popen, "__init__", recorder)
        patcher.start()
        self.addCleanup(patcher.stop)
        standalone._hide_child_consoles()

    def test_children_get_no_console_window(self):
        subprocess.Popen(["ffmpeg"])
        self.assertTrue(self.calls[0]["creationflags"] & subprocess.CREATE_NO_WINDOW)

    def test_other_flags_are_kept(self):
        subprocess.Popen(["ffmpeg"], creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        flags = self.calls[0]["creationflags"]
        self.assertTrue(flags & subprocess.CREATE_NEW_PROCESS_GROUP)
        self.assertTrue(flags & subprocess.CREATE_NO_WINDOW)

    def test_a_child_that_asks_for_its_own_console_keeps_it(self):
        subprocess.Popen(["cmd"], creationflags=subprocess.CREATE_NEW_CONSOLE)
        self.assertEqual(self.calls[0]["creationflags"], subprocess.CREATE_NEW_CONSOLE)

    def test_applying_it_twice_wraps_once(self):
        wrapped = subprocess.Popen.__init__
        standalone._hide_child_consoles()
        self.assertIs(subprocess.Popen.__init__, wrapped)


@skipUnless(sys.platform == "win32", "standard handles are a Windows matter")
class RepairStandardHandlesTest(SimpleTestCase):
    """Without a console a GUI process has no valid standard handles, and
    capturing a child's output then fails with WinError 6."""

    STDIN = -10 & 0xFFFFFFFF

    def setUp(self):
        import ctypes
        from ctypes import wintypes

        self.kernel32 = ctypes.WinDLL("kernel32")
        self.kernel32.GetStdHandle.restype = wintypes.HANDLE
        self.kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
        self.kernel32.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
        self.kernel32.GetFileType.restype = wintypes.DWORD
        self.kernel32.GetFileType.argtypes = [wintypes.HANDLE]
        original = self.kernel32.GetStdHandle(self.STDIN)
        self.addCleanup(self.kernel32.SetStdHandle, self.STDIN, original)

    def test_an_invalid_handle_is_replaced_and_output_can_be_captured(self):
        self.kernel32.SetStdHandle(self.STDIN, 0xDEAD0)
        self.assertEqual(self.kernel32.GetFileType(0xDEAD0), 0)

        self.assertIn("stdin", standalone._repair_standard_handles())

        handle = self.kernel32.GetStdHandle(self.STDIN)
        self.assertNotEqual(self.kernel32.GetFileType(handle), 0)
        done = subprocess.run(
            ["cmd.exe", "/c", "echo hi"], capture_output=True, text=True, check=True
        )
        self.assertEqual(done.stdout.strip(), "hi")

    def test_valid_handles_are_left_alone(self):
        before = self.kernel32.GetStdHandle(self.STDIN)
        if not before or self.kernel32.GetFileType(before) == 0:
            self.skipTest("this runner has no valid stdin to begin with")
        self.assertNotIn("stdin", standalone._repair_standard_handles())
        self.assertEqual(self.kernel32.GetStdHandle(self.STDIN), before)
