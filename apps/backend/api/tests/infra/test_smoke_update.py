"""scripts/smoke_update.py, which runs Restart to update's folder swap in a
built binary in CI (#2788). Only standalone-windows.yml runs it end to end;
these tests cover its decisions with fakes."""

import json
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.tests.stubs import load_backend_file, unique_module_name
from api.tests.updates.release_fixtures import release_zip
from librephotos import standalone
from librephotos.updater import FinishRequest

smoke = load_backend_file(
    "scripts/smoke_standalone.py", name=unique_module_name("smoke_standalone")
)
update_smoke = load_backend_file(
    "scripts/smoke_update.py",
    name=unique_module_name("smoke_update"),
    stubs={"smoke_standalone": smoke},
)


class SmokeUpdateTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        self.zip = self.work / "librephotos-windows-x64.zip"
        self.zip.write_bytes(release_zip("1.5.0"))
        self.layout = smoke.Layout(self.work)
        self.layout.create()

    def test_the_zip_becomes_the_program_folder_and_the_download(self):
        current, staged = update_smoke.unpack_twice(self.zip, self.work)
        self.assertEqual(current, self.work / "app" / "librephotos")
        self.assertEqual(staged, self.work / "app" / "librephotos-next")
        self.assertEqual(update_smoke.side(current), "old")
        self.assertEqual(update_smoke.side(staged), "new")
        self.assertTrue((staged / "librephotos.exe").is_file())

    def test_the_finisher_is_started_as_the_old_release_starts_it(self):
        current, staged = update_smoke.unpack_twice(self.zip, self.work)
        command = update_smoke.finish_command(current, staged, self.layout, 8123)
        self.assertEqual(command[0], str(staged / "librephotos.exe"))
        request = FinishRequest.from_arguments(
            standalone.parse_args(command[1:]), staged
        )
        self.assertEqual(request.old_dir, current)
        self.assertEqual(request.url, "http://127.0.0.1:8123/")
        relaunch = standalone.parse_args(list(request.relaunch))
        self.assertEqual(
            (relaunch.command, relaunch.port, relaunch.no_browser, relaunch.no_tray),
            ("run", 8123, True, True),
        )
        self.assertEqual(relaunch.data_dir, str(self.layout.data))
        self.assertEqual(json.loads(command[-1]), list(request.relaunch))

    def test_the_old_instance_is_a_process_that_has_exited(self):
        with patch.object(update_smoke.subprocess, "Popen") as popen:
            popen.return_value.pid = 4242
            self.assertEqual(update_smoke.exited_pid(), 4242)
        popen.return_value.wait.assert_called_once_with()

    def swap(self, *args, **kwargs):
        app = self.work / "app"
        (app / "librephotos").rename(app / "librephotos-old")
        (app / "librephotos-next").rename(app / "librephotos")
        return subprocess.CompletedProcess(args, 0)

    def test_a_swap_that_worked_passes(self):
        with (
            patch.object(update_smoke.subprocess, "run", side_effect=self.swap) as run,
            patch.object(update_smoke, "exited_pid", return_value=1),
        ):
            update_smoke.run(self.zip, self.layout)
        self.assertEqual(
            run.call_args.kwargs["timeout"], update_smoke.FINISH_TIMEOUT_SECONDS
        )
        environment = run.call_args.kwargs["env"]
        self.assertNotIn("BASE_DATA", environment)
        self.assertEqual(environment["WORKER_CONCURRENCY"], "1")

    def test_a_failed_finisher_or_no_swap_fails(self):
        failed = subprocess.CompletedProcess([], 1)
        with (
            patch.object(update_smoke.subprocess, "run", return_value=failed),
            patch.object(update_smoke, "exited_pid", return_value=1),
            self.assertRaisesRegex(smoke.SmokeError, "exited with 1"),
        ):
            update_smoke.run(self.zip, self.layout)
        with self.assertRaisesRegex(smoke.SmokeError, "did not trade places"):
            update_smoke.check_swap(self.work / "app")

    def test_main_reports_and_cleans_up(self):
        stray = MagicMock()
        with (
            patch.object(update_smoke, "run", side_effect=smoke.SmokeError("no")),
            patch.object(update_smoke, "processes_in", return_value=[stray]),
            patch.object(update_smoke, "dump_logs") as dump,
            patch("sys.stderr"),
        ):
            self.assertEqual(
                update_smoke.main([str(self.zip), "--work-dir", str(self.work)]), 1
            )
        dump.assert_called_once_with(self.layout.logs)
        self.assertEqual(stray.kill.call_count, len(update_smoke.FOLDERS))
        with (
            patch.object(update_smoke, "run"),
            patch.object(update_smoke, "processes_in", return_value=[]),
            patch("builtins.print"),
        ):
            self.assertEqual(
                update_smoke.main([str(self.zip), "--work-dir", str(self.work)]), 0
            )
