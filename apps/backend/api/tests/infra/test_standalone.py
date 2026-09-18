"""The standalone build (librephotos/standalone.py) and how api.services starts
and stops sidecars from it.

Everything here runs from source: the compiled binary is recognised through
``__main__.__compiled__``, which these tests fake, so the behaviour the binary
relies on is covered without a Nuitka build.
"""

import os
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.test import SimpleTestCase

from api import services
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
        for name in services.SERVICES:
            module = standalone.service_module_name(name)
            path = os.path.join(
                standalone.BACKEND_ROOT, *module.split(".")[:-1], "main.py"
            )
            with open(path, encoding="utf-8") as handle:
                self.assertIn("def serve():", handle.read(), module)


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


@patch("api.services.is_service_compatible", return_value=True)
@patch("api.services.subprocess.Popen")
class SidecarCommandTest(SimpleTestCase):
    def test_from_source_the_script_runs_under_python(self, popen, _compatible):
        services.start_service("thumbnail")
        self.assertEqual(
            popen.call_args.args[0], ["python", "service/thumbnail/main.py"]
        )

    def test_image_similarity_lives_outside_service(self, popen, _compatible):
        services.start_service("image_similarity")
        self.assertEqual(
            popen.call_args.args[0], ["python", "image_similarity/main.py"]
        )

    def test_compiled_the_binary_runs_the_sidecar_itself(self, popen, _compatible):
        with as_compiled():
            services.start_service("thumbnail")
        self.assertEqual(
            popen.call_args.args[0],
            [os.path.abspath(FAKE_COMPILED.original_argv0), "service", "thumbnail"],
        )


class ServiceProcessMatchTest(SimpleTestCase):
    def test_matches_both_ways_of_running_a_sidecar(self):
        self.assertTrue(
            services._is_service_process(["python", "service/exif/main.py"], "exif")
        )
        self.assertTrue(
            services._is_service_process(
                [r"C:\venv\Scripts\python.exe", r"C:\code\service\exif\main.py"], "exif"
            )
        )
        self.assertTrue(
            services._is_service_process(
                [r"C:\LibrePhotos\librephotos.exe", "service", "exif"], "exif"
            )
        )

    def test_does_not_match_other_services_or_unrelated_processes(self):
        self.assertFalse(
            services._is_service_process(["python", "service/tags/main.py"], "exif")
        )
        self.assertFalse(
            services._is_service_process(["librephotos.exe", "service", "tags"], "exif")
        )
        self.assertFalse(
            services._is_service_process(["vim", "service/exif/main.py"], "exif")
        )
        self.assertFalse(services._is_service_process(None, "exif"))
        self.assertFalse(services._is_service_process(["python"], "exif"))


class StopServiceTest(SimpleTestCase):
    def _process(self, pid, cmdline):
        return SimpleNamespace(info={"pid": pid, "cmdline": cmdline}, kill=lambda: None)

    def test_kills_every_matching_process_but_itself(self):
        killed = []
        running = [
            self._process(os.getpid(), ["librephotos.exe", "service", "exif"]),
            self._process(41, ["python", "service/exif/main.py"]),
            self._process(42, ["python", "service/tags/main.py"]),
        ]
        running[1].kill = lambda: killed.append(41)
        running[2].kill = lambda: killed.append(42)
        with patch("psutil.process_iter", return_value=running):
            self.assertTrue(services.stop_service("exif"))
        self.assertEqual(killed, [41])

    def test_reports_a_service_that_is_not_running(self):
        with patch("psutil.process_iter", return_value=[]):
            self.assertFalse(services.stop_service("exif"))


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
        self.assertEqual(named, set(services.SERVICES) | {"jobs", "worker"})
        self.assertEqual(
            len(set(standalone.PROCESS_NAMES.values())), len(standalone.PROCESS_NAMES)
        )

    def test_sidecars_start_under_their_name(self):
        with (
            patch("api.services.is_service_compatible", return_value=True),
            patch("api.services.subprocess.Popen") as popen,
        ):
            services.start_service("face_recognition")
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
