import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.tests.infra.test_installation import FakeRegistry, make_program
from librephotos import move_to_installed, standalone
from librephotos.installation import read_move_record
from librephotos.move_to_installed import (
    MoveRequest,
    MoveStart,
    MoveTools,
    finish_move,
    move_finisher_command,
    start_move_finisher,
)
from librephotos.updater import Launch

URL = "http://127.0.0.1:8000/"
RELAUNCH = ["--data-dir", "D:\\Lib", "run", "--port", "8000"]


class MoveFolders(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        self.old = make_program(root / "LibrePhotos-app")
        self.app = root / "Programs" / "LibrePhotos"
        self.data = root / "data"
        (self.data / "logs").mkdir(parents=True)
        self.setup_file = self.data / "updates" / "LibrePhotos-Setup-1.7.0.exe"
        self.setup_file.parent.mkdir()
        self.setup_file.write_bytes(b"MZ setup")
        self.registry = FakeRegistry(InstallLocation=str(self.app))
        self.request = MoveRequest(
            old_pid=4242,
            old_dir=self.old,
            setup=self.setup_file,
            data_dir=self.data,
            url=URL,
            log=self.data / "logs" / "update.log",
            cwd=str(root),
            relaunch=tuple(RELAUNCH),
        )
        self.notify = MagicMock()
        self.launched = []

    def install(self, command, timeout):
        make_program(self.app)
        self.commands = [command, timeout]
        return 0

    def launch(self, folder, request):
        self.launched.append(folder)
        return MagicMock(pid=99)

    def finish(self, runner=None, ready=True, exited=True):
        tools = MoveTools(self.registry, runner or self.install, standalone.SUBCOMMANDS)
        with (
            patch.object(move_to_installed, "wait_for_exit", return_value=exited),
            patch.object(move_to_installed, "stop_leftovers") as leftovers,
            patch.object(move_to_installed, "launch_release", side_effect=self.launch),
            patch.object(move_to_installed, "wait_ready", return_value=ready),
        ):
            code = finish_move(self.request, self.notify, tools)
        self.leftovers = leftovers
        return code


class FinishMoveTest(MoveFolders):
    def test_it_installs_starts_the_installed_copy_and_keeps_the_old_one(self):
        self.assertEqual(self.finish(), 0)
        command, timeout = self.commands
        self.assertEqual(command[0], str(self.setup_file))
        self.assertIn("/VERYSILENT", command)
        self.assertIn("/SKIPRUNNINGCHECK", command)
        data_dir = os.path.abspath(os.path.join(self.request.cwd, RELAUNCH[1]))
        self.assertIn(f"/DATADIR={data_dir}", command)
        self.assertEqual(timeout, move_to_installed.SETUP_TIMEOUT_SECONDS)
        self.assertEqual(self.launched, [self.app / "librephotos"])
        self.leftovers.assert_called_once()
        record = read_move_record(self.data)
        self.assertEqual(record.moved_from, str(self.old))
        self.assertEqual(record.moved_to, str(self.app / "librephotos"))
        self.assertEqual(record.version, "1.7.0")
        self.assertTrue((self.old / "librephotos.exe").is_file())
        self.assertFalse(self.setup_file.parent.exists())
        self.notify.assert_not_called()
        self.assertIn("the move is done", self.request.log.read_text())

    def test_a_failed_installer_starts_the_old_copy_again(self):
        self.assertEqual(self.finish(runner=lambda command, timeout: 2), 1)
        self.assertEqual(self.launched, [self.old])
        self.assertIn("exit code 2", self.notify.call_args.args[0])
        self.assertIsNone(read_move_record(self.data))
        self.assertTrue(self.setup_file.is_file())

    def test_an_installer_that_cannot_run_starts_the_old_copy_again(self):
        def broken(command, timeout):
            raise OSError("no such file")

        self.assertEqual(self.finish(runner=broken), 1)
        self.assertEqual(self.launched, [self.old])
        self.assertIn("it could not run", self.notify.call_args.args[0])

    def test_an_install_without_a_program_folder_is_a_failure(self):
        self.assertEqual(self.finish(runner=lambda command, timeout: 0), 1)
        self.assertEqual(self.launched, [self.old])

    def test_an_installed_copy_that_does_not_start_is_stopped(self):
        with patch.object(move_to_installed, "_stop") as stop:
            self.assertEqual(self.finish(ready=False), 1)
        stop.assert_called_once()
        self.assertEqual(self.launched, [self.app / "librephotos", self.old])
        self.assertIsNone(read_move_record(self.data))

    def test_nothing_happens_while_the_old_copy_runs(self):
        runner = MagicMock()
        self.assertEqual(self.finish(runner=runner, exited=False), 1)
        runner.assert_not_called()
        self.assertEqual(self.launched, [])
        self.notify.assert_called_once()

    def test_anything_unexpected_starts_the_old_copy_again(self):
        def boom(command, timeout):
            raise RuntimeError("boom")

        self.assertEqual(self.finish(runner=boom), 1)
        self.assertEqual(self.launched, [self.old])
        self.assertIn("boom", self.notify.call_args.args[0])
        self.assertIn("RuntimeError", self.request.log.read_text())


class MoveFinisherContractTest(MoveFolders):
    def start(self):
        return MoveStart(
            executable=self.old / "librephotos.exe",
            setup=self.setup_file,
            data_dir=self.data,
            url=URL,
            log=self.request.log,
        )

    def test_the_command_is_what_finish_move_parses(self):
        launch = Launch(tuple(RELAUNCH), {}, "C:\\Users\\me")
        command = move_finisher_command(self.start(), launch)
        self.assertEqual(
            command[:2], [str(self.old / "librephotos.exe"), "finish-move"]
        )
        request = MoveRequest.from_arguments(standalone.parse_args(command[1:]))
        self.assertEqual(request.old_dir, self.old)
        self.assertEqual(request.setup, self.setup_file)
        self.assertEqual(request.data_dir, self.data)
        self.assertEqual(request.url, URL)
        self.assertEqual(request.cwd, "C:\\Users\\me")
        self.assertEqual(request.relaunch, tuple(RELAUNCH))

    def test_a_relaunch_that_is_not_a_list_of_strings_is_refused(self):
        command = move_finisher_command(self.start(), Launch((), {}, ""))
        args = standalone.parse_args(command[1:])
        args.relaunch = json.dumps({"run": 1})
        with self.assertRaises(SystemExit):
            MoveRequest.from_arguments(args)

    def test_the_finisher_leaves_the_job_and_works_outside_the_old_folder(self):
        launch = Launch(tuple(RELAUNCH), {"A": "1"}, "C:\\")
        with patch.object(
            move_to_installed, "spawn_outside_job", return_value=True
        ) as spawn:
            self.assertTrue(start_move_finisher(self.start(), launch))
        command, environ, cwd = spawn.call_args.args
        self.assertEqual(command[1], "finish-move")
        self.assertEqual(environ, {"A": "1"})
        self.assertEqual(cwd, self.data)

    def test_main_runs_the_move_before_anything_else(self):
        command = move_finisher_command(self.start(), Launch((), {}, ""))
        with (
            patch.object(move_to_installed, "finish_move", return_value=0) as finish,
            patch.object(standalone, "prepare_environment") as prepare,
            self.assertRaises(SystemExit) as exited,
        ):
            standalone.main(command[1:])
        self.assertEqual(exited.exception.code, 0)
        prepare.assert_not_called()
        self.assertEqual(finish.call_args.args[0].setup, self.setup_file)
        self.assertEqual(finish.call_args.args[2].stop_at, standalone.SUBCOMMANDS)


class StandaloneMoveTest(MoveFolders):
    def compiled(self, program):
        return patch.object(
            standalone,
            "standalone_executable",
            return_value=str(program / "librephotos.exe"),
        )

    def test_restart_to_move_starts_the_finisher_then_quits(self):
        startup = standalone.Startup()
        with self.assertRaises(OSError):
            startup.restart_to_move(self.setup_file, URL)
        startup.launch = Launch(tuple(RELAUNCH), {}, ".")
        with (
            self.compiled(self.old),
            patch.dict(
                standalone.os.environ,
                {"BASE_DATA": str(self.data), "BASE_LOGS": str(self.data / "logs")},
            ),
            patch.object(
                move_to_installed, "start_move_finisher", return_value=False
            ) as start,
            patch.object(standalone.threading, "Timer") as timer,
        ):
            startup.restart_to_move(self.setup_file, URL)
        begun = start.call_args.args[0]
        self.assertEqual(begun.executable, self.old / "librephotos.exe")
        self.assertEqual(begun.data_dir, self.data)
        self.assertEqual(begun.log, self.data / "logs" / "update.log")
        self.assertTrue(startup.release_job_on_exit)
        timer.assert_called_once_with(standalone.RESTART_DELAY_SECONDS, startup.quit)

    def test_a_start_of_the_old_copy_goes_to_the_installed_one(self):
        launch = Launch(tuple(RELAUNCH), {"A": "1"}, "C:\\")
        self.assertFalse(standalone.forward_to_installed(str(self.data), launch))
        target = self.app / "librephotos" / "librephotos.exe"
        with (
            self.compiled(self.old),
            patch.object(
                standalone.installation, "forward_target", return_value=target
            ),
            patch.object(standalone.subprocess, "Popen") as popen,
        ):
            self.assertTrue(standalone.forward_to_installed(str(self.data), launch))
        popen.assert_called_once_with(
            [str(target), *RELAUNCH], env={"A": "1"}, cwd="C:\\"
        )

    def test_main_hands_a_run_over_before_starting_anything(self):
        with (
            patch.object(
                standalone, "prepare_environment", return_value=str(self.data)
            ),
            patch.object(
                standalone, "forward_to_installed", return_value=True
            ) as forward,
            patch.object(standalone, "run_server") as run_server,
        ):
            standalone.main(["--data-dir", str(self.data)])
        forward.assert_called_once()
        run_server.assert_not_called()

    def test_the_installed_copy_keeps_its_version_in_installed_apps(self):
        program = make_program(self.app, version="1.8.0")
        registry = FakeRegistry(InstallLocation=str(self.app), DisplayVersion="1.7.0")
        standalone.sync_installed_version()
        with (
            self.compiled(program),
            patch.object(
                standalone.installation, "UninstallEntry", return_value=registry
            ),
        ):
            standalone.sync_installed_version()
        self.assertEqual(registry.values["DisplayVersion"], "1.8.0")

    def test_a_registry_error_never_stops_the_start(self):
        registry = MagicMock()
        registry.read.return_value = str(self.app)
        registry.write.side_effect = PermissionError(5, "denied")
        program = make_program(self.app)
        with (
            self.compiled(program),
            patch.object(
                standalone.installation, "UninstallEntry", return_value=registry
            ),
        ):
            standalone.sync_installed_version()

    def test_the_tray_says_once_where_the_old_folder_is(self):
        startup = standalone.Startup()
        startup.notify = MagicMock()
        record = MagicMock(moved_from=str(self.old))
        with (
            patch.dict(standalone.os.environ, {"BASE_DATA": str(self.data)}),
            patch.object(
                standalone.installation, "announce_move", side_effect=[record, None]
            ),
        ):
            startup.announce_move()
            startup.announce_move()
        startup.notify.assert_called_once()
        self.assertIn(str(self.old), startup.notify.call_args.args[1])
