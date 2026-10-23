"""The Windows app's folder swap on Restart to update (#2788,
librephotos/updater.py) and how librephotos/standalone.py starts it.

Real folders in a temporary directory stand in for the program folders; the
processes are mocked (the manual run against two dummy program folders is in
the PR description)."""

import dataclasses
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import psutil
from django.test import SimpleTestCase

from librephotos import standalone, updater
from librephotos.updater import (
    FinishRequest,
    Launch,
    SwapPlan,
    apply_swap,
    finish_update,
    plan_swap,
)

URL = "http://127.0.0.1:8000/"


def program(folder, version):
    """A release's program folder, with the build's list of its files."""
    folder.mkdir(parents=True)
    (folder / "librephotos.exe").write_text(version)
    files = ["build_info.json", "librephotos.exe"]
    (folder / "build_info.json").write_text(json.dumps({"files": files}))
    return folder


class Folders:
    """librephotos (old) and librephotos-1.5.0 (new) in a temporary parent."""

    def __init__(self, test, with_rollback=False):
        directory = tempfile.TemporaryDirectory()
        test.addCleanup(directory.cleanup)
        self.parent = Path(directory.name)
        self.current = program(self.parent / "librephotos", "1.4.0")
        self.staged = program(self.parent / "librephotos-1.5.0", "1.5.0")
        self.rollback = self.parent / "librephotos-old"
        if with_rollback:
            program(self.rollback, "1.3.0")
        self.log = self.parent / "update.log"

    def request(self, relaunch=("--data-dir", "D:\\LP")):
        return FinishRequest(
            old_pid=4242,
            old_dir=self.current,
            staged=self.staged,
            url=URL,
            log=self.log,
            cwd=str(self.parent),
            relaunch=tuple(relaunch),
        )

    def version(self, folder):
        return (folder / "librephotos.exe").read_text()

    def names(self):
        return sorted(path.name for path in self.parent.iterdir() if path.is_dir())


class LaunchTest(SimpleTestCase):
    def test_capture_keeps_argv_environment_and_folder(self):
        with patch.dict(os.environ, {"LP_TEST": "1"}):
            launch = Launch.capture(["--data-dir", "D:\\LP"])
        self.assertEqual(launch.argv, ("--data-dir", "D:\\LP"))
        self.assertEqual(launch.environ["LP_TEST"], "1")
        self.assertEqual(launch.cwd, os.getcwd())

    def test_the_finisher_command_is_a_contract_between_releases(self):
        launch = Launch(("run", "--port", "8001"), {}, "C:\\Users\\me")
        command = updater.finisher_command(
            Path("P/librephotos-1.5.0"),
            Path("P/librephotos"),
            URL,
            Path("L/u.log"),
            launch,
        )
        self.assertEqual(command[0], str(Path("P/librephotos-1.5.0/librephotos.exe")))
        self.assertEqual(command[1], "finish-update")
        args = standalone.parse_args(command[1:])
        request = FinishRequest.from_arguments(args, Path("P/librephotos-1.5.0"))
        self.assertEqual(request.old_pid, os.getpid())
        self.assertEqual(request.old_dir, Path("P/librephotos"))
        self.assertEqual(request.url, URL)
        self.assertEqual(request.cwd, "C:\\Users\\me")
        self.assertEqual(request.relaunch, ("run", "--port", "8001"))

    def test_a_bad_relaunch_list_stops_the_finisher(self):
        args = standalone.parse_args(
            ["finish-update", "--old-pid", "1", "--old-dir", "x", "--url", URL,
             "--log", "l", "--relaunch", json.dumps({"a": 1})]
        )  # fmt: skip
        with self.assertRaises(SystemExit):
            FinishRequest.from_arguments(args, Path("y"))


class StartFinisherTest(SimpleTestCase):
    def start(self, popen, breakaway=0x01000000):
        launch = Launch(("run",), {"PATH": "x"}, "C:\\")
        with (
            patch.object(updater.subprocess, "Popen", popen),
            patch.object(
                updater.subprocess, "CREATE_BREAKAWAY_FROM_JOB", breakaway, create=True
            ),
        ):
            left = updater.start_finisher(
                Path("P/librephotos-1.5.0"),
                Path("P/librephotos"),
                URL,
                Path("u.log"),
                launch,
            )
        return left, popen

    def test_the_finisher_leaves_this_instances_job(self):
        left, popen = self.start(MagicMock())
        self.assertTrue(left)
        options = popen.call_args.kwargs
        self.assertEqual(options["creationflags"], 0x01000000)
        self.assertEqual(options["env"], {"PATH": "x"})
        # Not inside the folder it renames.
        self.assertEqual(options["cwd"], "P")

    def test_without_breakaway_the_caller_must_lift_kill_on_close(self):
        left, popen = self.start(MagicMock(side_effect=[OSError(5, "denied"), None]))
        self.assertFalse(left)
        self.assertEqual(popen.call_args.kwargs["creationflags"], 0)
        left, popen = self.start(MagicMock(), breakaway=0)
        self.assertFalse(left)
        popen.assert_called_once()


class PlanSwapTest(SimpleTestCase):
    def test_the_renames_in_order(self):
        folders = Folders(self)
        plan = plan_swap(folders.current, folders.staged, "20261022")
        self.assertIsNone(plan.superseded)
        self.assertEqual(
            plan.renames(),
            [(folders.current, folders.rollback), (folders.staged, folders.current)],
        )

    def test_an_earlier_rollback_moves_aside_first(self):
        folders = Folders(self, with_rollback=True)
        plan = plan_swap(folders.current, folders.staged, "20261022")
        aside = folders.parent / "librephotos-old.superseded-20261022"
        self.assertEqual(plan.superseded, aside)
        self.assertEqual(plan.renames()[0], (folders.rollback, aside))

    def test_the_new_release_must_sit_next_to_the_program_folder(self):
        folders = Folders(self)
        with self.assertRaises(ValueError):
            plan_swap(folders.current, folders.parent / "x" / "librephotos-1.5.0", "1")
        with self.assertRaises(ValueError):
            plan_swap(folders.current, folders.current, "1")


class ApplySwapTest(SimpleTestCase):
    def test_the_folders_trade_places(self):
        folders = Folders(self, with_rollback=True)
        plan = plan_swap(folders.current, folders.staged, "1")
        apply_swap(plan, MagicMock())
        self.assertEqual(folders.version(folders.current), "1.5.0")
        self.assertEqual(folders.version(folders.rollback), "1.4.0")
        self.assertEqual(folders.version(plan.superseded), "1.3.0")

    def test_a_failed_rename_is_undone(self):
        folders = Folders(self, with_rollback=True)
        plan = plan_swap(folders.current, folders.staged, "1")
        real_rename = os.rename
        calls = []

        def rename(source, target):
            calls.append(source)
            if len(calls) == 3:
                raise PermissionError(5, "in use")
            real_rename(source, target)

        log = MagicMock()
        with patch.object(updater.os, "rename", rename), self.assertRaises(OSError):
            apply_swap(plan, log)
        self.assertEqual(folders.version(folders.current), "1.4.0")
        self.assertEqual(folders.version(folders.rollback), "1.3.0")
        self.assertEqual(folders.version(folders.staged), "1.5.0")
        self.assertEqual(
            folders.names(), ["librephotos", "librephotos-1.5.0", "librephotos-old"]
        )

    def test_an_undo_that_fails_is_logged(self):
        folders = Folders(self)
        plan = plan_swap(folders.current, folders.staged, "1")
        real_rename = os.rename
        calls = []

        def rename(source, target):
            calls.append(source)
            if len(calls) == 1:
                real_rename(source, target)
                return
            raise PermissionError(5, "in use")

        log = MagicMock()
        with patch.object(updater.os, "rename", rename), self.assertRaises(OSError):
            apply_swap(plan, log)
        self.assertIn("could not undo", log.call_args.args[0])


class ProcessesTest(SimpleTestCase):
    def test_wait_for_exit(self):
        with patch.object(updater.psutil, "Process") as process:
            self.assertTrue(updater.wait_for_exit(1, 1))
            process.return_value.wait.side_effect = psutil.TimeoutExpired(1)
            self.assertFalse(updater.wait_for_exit(1, 1))
            process.side_effect = psutil.NoSuchProcess(1)
            self.assertTrue(updater.wait_for_exit(1, 1))

    def test_processes_from_the_old_folder_are_found_and_ended(self):
        folders = Folders(self)
        inside = SimpleNamespace(
            pid=10, info={"exe": str(folders.current / "librephotos-worker.exe")}
        )
        outside = SimpleNamespace(
            pid=11, info={"exe": str(folders.staged / "librephotos.exe")}
        )
        unknown = SimpleNamespace(pid=12, info={"exe": None})
        me = SimpleNamespace(
            pid=os.getpid(), info={"exe": str(folders.current / "x.exe")}
        )
        with patch.object(
            updater.psutil, "process_iter", return_value=[inside, outside, unknown, me]
        ):
            self.assertEqual(updater.processes_in(folders.current), [inside])
        stuck = MagicMock(pid=10)
        gone = MagicMock(pid=13)
        gone.kill.side_effect = psutil.NoSuchProcess(13)
        log = MagicMock()
        with (
            patch.object(updater, "processes_in", return_value=[stuck, gone]),
            patch.object(
                updater.psutil, "wait_procs", return_value=([], [stuck, gone])
            ) as wait,
        ):
            updater.stop_leftovers(folders.current, 60, log)
        stuck.kill.assert_called_once_with()
        self.assertEqual(wait.call_args_list[0], call([stuck, gone], timeout=60))
        self.assertIn("ending process 10", log.call_args_list[0].args[0])


class WaitReadyTest(SimpleTestCase):
    def wait(self, answers, exits=None, timeout=10.0):
        process = MagicMock()
        process.poll.side_effect = exits or (lambda: None)
        clock = iter(range(1000))
        with (
            patch.object(updater, "_answers_ready", side_effect=answers),
            patch.object(updater.time, "monotonic", lambda: next(clock)),
        ):
            return updater.wait_ready(URL, process, timeout, sleep=lambda s: None)

    def test_ready_once_it_answers(self):
        self.assertTrue(self.wait([False, False, True]))

    def test_not_ready_when_it_exits_or_times_out(self):
        self.assertFalse(self.wait(lambda url: False, exits=[None, 1]))
        self.assertFalse(self.wait(lambda url: False, timeout=3))

    def test_the_ready_probe(self):
        response = MagicMock(status_code=200)
        with patch.object(updater.requests, "get", return_value=response) as get:
            self.assertTrue(updater._answers_ready(URL))
        get.assert_called_once_with(f"{URL}api/healthz/ready", timeout=5)
        response.status_code = 503
        with patch.object(updater.requests, "get", return_value=response):
            self.assertFalse(updater._answers_ready(URL))
        with patch.object(
            updater.requests, "get", side_effect=updater.requests.ConnectionError
        ):
            self.assertFalse(updater._answers_ready(URL))


class RemoveSupersededTest(SimpleTestCase):
    def test_only_a_librephotos_folder_is_deleted(self):
        folders = Folders(self)
        log = MagicMock()
        updater.remove_superseded(
            SwapPlan(folders.current, folders.staged, folders.rollback, None), log
        )
        log.assert_not_called()
        other = folders.parent / "librephotos-old.superseded-1"
        other.mkdir()
        (other / "my notes.txt").write_text("keep")
        plan = SwapPlan(folders.current, folders.staged, folders.rollback, other)
        updater.remove_superseded(plan, log)
        self.assertTrue((other / "my notes.txt").exists())
        (other / "my notes.txt").unlink()
        other.rmdir()
        program(other, "1.3.0")
        updater.remove_superseded(plan, log)
        self.assertFalse(other.exists())
        self.assertIn("deleted", log.call_args.args[0])

    def test_a_folder_that_cannot_be_deleted_is_logged(self):
        folders = Folders(self, with_rollback=True)
        plan = SwapPlan(
            folders.current, folders.staged, folders.rollback, folders.rollback
        )
        log = MagicMock()
        with patch.object(updater.shutil, "rmtree"):
            updater.remove_superseded(plan, log)
        self.assertIn("could not delete", log.call_args.args[0])


class FinishUpdateTest(SimpleTestCase):
    def finish(self, folders, ready=True, exited=True, swap_error=None):
        self.launched = []
        self.notified = []

        def launch(folder, request):
            self.launched.append(folders.version(folder))
            return MagicMock(pid=99)

        patches = [
            patch.object(updater, "wait_for_exit", return_value=exited),
            patch.object(updater, "stop_leftovers"),
            patch.object(updater, "launch_release", side_effect=launch),
            patch.object(updater, "wait_ready", return_value=ready),
        ]
        if swap_error is not None:
            patches.append(patch.object(updater, "apply_swap", side_effect=swap_error))
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        return finish_update(folders.request(), self.notified.append)

    def test_the_new_release_replaces_the_old_one(self):
        folders = Folders(self, with_rollback=True)
        self.assertEqual(self.finish(folders), 0)
        self.assertEqual(folders.version(folders.current), "1.5.0")
        self.assertEqual(folders.version(folders.rollback), "1.4.0")
        self.assertEqual(folders.names(), ["librephotos", "librephotos-old"])
        self.assertEqual(self.launched, ["1.5.0"])
        self.assertEqual(self.notified, [])
        log = folders.log.read_text()
        self.assertIn("the update is done", log)

    def test_an_old_instance_that_does_not_stop_changes_nothing(self):
        folders = Folders(self)
        self.assertEqual(self.finish(folders, exited=False), 1)
        self.assertEqual(folders.version(folders.current), "1.4.0")
        self.assertEqual(self.launched, [])
        self.assertIn("did not stop", self.notified[0])

    def test_a_failed_swap_starts_the_old_release_again(self):
        folders = Folders(self)
        self.assertEqual(
            self.finish(folders, swap_error=PermissionError(5, "in use")), 1
        )
        self.assertEqual(self.launched, ["1.4.0"])
        self.assertIn("could not replace its program folder", self.notified[0])

    def test_a_new_release_that_does_not_start_keeps_everything(self):
        folders = Folders(self, with_rollback=True)
        self.assertEqual(self.finish(folders, ready=False), 1)
        self.assertEqual(
            len([n for n in folders.names() if n.startswith("librephotos-old.")]), 1
        )
        self.assertIn(str(folders.rollback), self.notified[0])
        self.assertIn("#going-back", self.notified[0])

    def test_launch_uses_the_old_working_folder_when_it_still_exists(self):
        folders = Folders(self)
        with patch.object(updater, "_spawn") as spawn:
            updater.launch_release(folders.current, folders.request())
            self.assertEqual(spawn.call_args.args[2], folders.parent)
            self.assertEqual(
                spawn.call_args.args[0],
                [str(folders.current / "librephotos.exe"), "--data-dir", "D:\\LP"],
            )
            gone = dataclasses.replace(
                folders.request(), cwd=str(folders.parent / "gone")
            )
            updater.launch_release(folders.current, gone)
            self.assertEqual(spawn.call_args.args[2], folders.parent)

    def test_the_log_never_raises(self):
        updater.Log(Path(tempfile.gettempdir()) / "missing" / "dir" / "u.log")("x")

    def test_the_finisher_tells_without_a_console_in_a_message_box(self):
        with (
            patch.object(standalone, "_has_console_window", return_value=True),
            patch("builtins.print") as printed,
        ):
            standalone._tell("x")
        printed.assert_called_once_with("x", flush=True)
        if sys.platform != "win32":
            return
        with (
            patch.object(standalone, "_has_console_window", return_value=False),
            patch("builtins.print"),
            patch("ctypes.windll.user32.MessageBoxW") as box,
        ):
            standalone._tell("x")
        box.assert_called_once_with(None, "x", "LibrePhotos", 0x10)


class StandaloneHookTest(SimpleTestCase):
    def test_main_runs_the_finisher_before_preparing_anything(self):
        argv = [
            "finish-update",
            "--old-pid",
            "1",
            "--old-dir",
            "old",
            "--url",
            URL,
            "--log",
            "l",
        ]
        with (
            patch.object(standalone, "prepare_environment") as prepare,
            patch.object(updater, "finish_update", return_value=0) as finish,
            self.assertRaises(SystemExit) as raised,
        ):
            standalone.main(argv)
        self.assertEqual(raised.exception.code, 0)
        prepare.assert_not_called()
        request, notify = finish.call_args.args
        self.assertIs(notify, standalone._tell)
        self.assertEqual(request.staged, Path(standalone.install_root()))
        self.assertEqual(request.relaunch, ())

    def test_main_remembers_how_it_was_started(self):
        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "run_server") as run,
        ):
            standalone.main(["--data-dir", "D:\\LP"])
        startup = run.call_args.args[4]
        self.assertEqual(startup.launch.argv, ("--data-dir", "D:\\LP"))

    def test_the_updater_is_only_enabled_in_the_compiled_app(self):
        startup = standalone.Startup()
        startup.launch = Launch((), {}, ".")
        program_dir = Path("P", "librephotos")
        data, logs = Path("D"), Path("D", "logs")
        with patch("api.updates.install.enable") as enable:
            standalone.enable_updater(startup, URL)
            enable.assert_not_called()
            with (
                patch.object(
                    standalone,
                    "standalone_executable",
                    return_value=str(program_dir / "librephotos.exe"),
                ),
                patch.dict(
                    os.environ, {"BASE_DATA": str(data), "BASE_LOGS": str(logs)}
                ),
                patch.object(standalone.Startup, "restart_to_update") as restart,
            ):
                standalone.enable_updater(startup, URL)
                enabled_dir, data_dirs, hook = enable.call_args.args
                hook(Path("P", "librephotos-1.5.0"))
        self.assertEqual(enabled_dir, program_dir)
        self.assertEqual(data_dirs, [data, logs])
        restart.assert_called_once_with(Path("P", "librephotos-1.5.0"), URL)

    def test_restart_starts_the_finisher_then_quits(self):
        startup = standalone.Startup()
        with self.assertRaises(OSError):
            startup.restart_to_update(Path("new"), URL)
        startup.launch = Launch((), {}, ".")
        with (
            patch.dict(os.environ, {"BASE_LOGS": "logs"}),
            patch.object(updater, "start_finisher", return_value=False) as start,
            patch.object(standalone.threading, "Timer") as timer,
        ):
            startup.restart_to_update(Path("new"), URL)
        self.assertEqual(start.call_args.args[0], Path("new"))
        self.assertEqual(start.call_args.args[3], Path("logs") / "update.log")
        self.assertTrue(startup.release_job_on_exit)
        timer.assert_called_once_with(standalone.RESTART_DELAY_SECONDS, startup.quit)
        timer.return_value.start.assert_called_once_with()

    def test_the_job_is_released_after_the_shutdown_when_asked(self):
        startup = standalone.Startup()
        startup.release_job_on_exit = True
        server = SimpleNamespace(
            run=lambda: None, started=True, config=SimpleNamespace(host="h", port=1)
        )
        with (
            patch.object(standalone, "_shutdown") as shutdown,
            patch.object(standalone, "_release_job") as release,
            patch.object(standalone.threading, "Thread"),
        ):
            standalone._serve(server, MagicMock(), URL, startup)
        shutdown.assert_called_once()
        release.assert_called_once_with()

    def test_job_limits_are_windows_only(self):
        if sys.platform == "win32":
            self.skipTest("Windows creates a real job")
        self.assertIsNone(standalone._set_job_limits(0))
        with patch.object(standalone, "_job_handles", [1]):
            standalone._release_job()


@unittest.skipUnless(sys.platform == "win32", "a real Windows job object")
class WindowsJobTest(SimpleTestCase):
    def test_a_job_is_created_and_its_limits_lifted(self):
        job = standalone._set_job_limits(
            standalone._JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | standalone._JOB_OBJECT_LIMIT_BREAKAWAY_OK
        )
        self.assertIsInstance(job, int)
        self.assertEqual(standalone._set_job_limits(0, job), job)
        with patch.object(standalone, "_job_handles", [job]):
            standalone._release_job()
        self.assertIsNone(standalone._set_job_limits(0, 0))
        self.assertEqual(subprocess.CREATE_BREAKAWAY_FROM_JOB, 0x01000000)
