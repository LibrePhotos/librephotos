"""One standalone LibrePhotos per data folder, a tray icon from the first
second, and the previous start's log kept (#2316).

A second double-click while the first start was still migrating (minutes
after an update, with no icon yet) started a full second instance: it
truncated console.log, ran migrate on the same SQLite file, started duplicate
sidecars and a job cluster, and on its way out stopped the first instance's
sidecars.
"""

import os
import sys
import tempfile
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase

from api.runtime import supervisor
from api.tests.stubs import stub_modules
from librephotos import instance_lock, standalone

URL = "http://127.0.0.1:8000/"


def temporary_data_dir(test: SimpleTestCase) -> str:
    directory = tempfile.TemporaryDirectory()
    test.addCleanup(directory.cleanup)
    data = directory.name
    os.makedirs(os.path.join(data, "logs"))
    patcher = patch.dict(
        os.environ, {"BASE_DATA": data, "BASE_LOGS": os.path.join(data, "logs")}
    )
    patcher.start()
    test.addCleanup(patcher.stop)
    return data


class InstanceLockTest(SimpleTestCase):
    def setUp(self):
        self.data = temporary_data_dir(self)

    def test_only_one_holder_per_data_folder(self):
        first = instance_lock.acquire(self.data, URL)
        self.addCleanup(first.release)
        self.assertIsNotNone(first)
        self.assertIsNone(instance_lock.acquire(self.data, "http://127.0.0.1:9000/"))

    def test_the_second_start_reads_where_the_holder_serves(self):
        first = instance_lock.acquire(self.data, "http://127.0.0.1:8080/")
        self.addCleanup(first.release)
        self.assertIsNone(instance_lock.acquire(self.data, URL))
        # The failed attempt wrote nothing over the holder's record.
        self.assertEqual(instance_lock.holder_url(self.data), "http://127.0.0.1:8080/")

    def test_a_released_lock_can_be_taken_again(self):
        instance_lock.acquire(self.data, URL).release()
        again = instance_lock.acquire(self.data, URL)
        self.addCleanup(again.release)
        self.assertIsNotNone(again)

    def test_no_or_a_broken_lock_file_has_no_url(self):
        self.assertIsNone(instance_lock.holder_url(self.data))
        with open(instance_lock.lock_path(self.data), "w") as handle:
            handle.write("not json")
        self.assertIsNone(instance_lock.holder_url(self.data))


class SecondStartTest(SimpleTestCase):
    """A start while another holds the folder only waits and opens the browser."""

    def setUp(self):
        self.data = temporary_data_dir(self)
        self.first = instance_lock.acquire(self.data, "http://127.0.0.1:8080/")
        self.addCleanup(self.first.release)

    def second_start(self, answers, tray=False):
        startup = standalone.Startup()
        with (
            patch.object(standalone, "_already_running", side_effect=answers),
            patch.object(standalone, "_capture_console_output") as console_log,
            patch.object(standalone, "_take_children_down_with_us") as job,
            patch.object(standalone, "run_teed") as teed,
            patch.object(standalone, "_OTHER_INSTANCE_POLL_SECONDS", 0),
            patch.object(startup, "show_tray") as show_tray,
            patch.object(startup, "notify") as notify,
            patch("django.setup") as setup,
            patch("webbrowser.open") as browser,
        ):
            standalone.run_server("127.0.0.1", 8000, True, tray, startup)
        teed.assert_not_called()
        console_log.assert_not_called()
        job.assert_not_called()
        setup.assert_not_called()
        return browser, show_tray, notify

    def test_it_waits_for_the_first_then_opens_the_browser_on_it(self):
        browser, show_tray, notify = self.second_start([False, False, True], True)
        browser.assert_called_once_with("http://127.0.0.1:8080/")
        show_tray.assert_called_once_with(
            "http://127.0.0.1:8080/", standalone.STATUS_WAITING
        )
        notify.assert_called_once_with(*standalone.NOTICE_ALREADY_STARTING)

    def test_a_running_first_instance_opens_at_once_without_a_notification(self):
        browser, show_tray, notify = self.second_start([True], True)
        browser.assert_called_once_with("http://127.0.0.1:8080/")
        show_tray.assert_not_called()
        notify.assert_not_called()

    def test_a_first_instance_that_never_answers_is_reported(self):
        with (
            patch.object(standalone, "OTHER_INSTANCE_TIMEOUT_SECONDS", 0),
            self.assertRaisesMessage(standalone.StartupError, "has not answered"),
        ):
            self.second_start(lambda url: False)

    def test_quit_while_waiting_stops_waiting(self):
        startup = standalone.Startup()
        startup.quit()
        with (
            patch.object(standalone, "_already_running", return_value=False),
            patch("webbrowser.open") as browser,
        ):
            standalone.run_server("127.0.0.1", 8000, True, False, startup)
        browser.assert_not_called()


def fake_process(pid, cmdline):
    process = MagicMock()
    process.info = {"pid": pid, "cmdline": cmdline}
    return process


class ShutdownOnlyOwnProcessesTest(SimpleTestCase):
    def test_another_instances_sidecar_is_left_running(self):
        own = fake_process(101, ["librephotos-thumbnails.exe", "service", "thumbnail"])
        foreign = fake_process(
            202, ["librephotos-thumbnails.exe", "service", "thumbnail"]
        )
        with (
            patch.object(standalone, "own_process_ids", return_value={101}),
            patch("psutil.process_iter", return_value=[own, foreign]),
            patch("psutil.wait_procs", return_value=([own], [])),
        ):
            standalone._shutdown(None)
        own.terminate.assert_called_once_with()
        foreign.terminate.assert_not_called()

    def test_without_a_job_the_descendants_are_ours(self):
        children = [SimpleNamespace(pid=5), SimpleNamespace(pid=6)]
        with (
            patch.object(standalone, "_job_process_ids", return_value=None),
            patch("psutil.Process") as process,
        ):
            process.return_value.children.return_value = children
            self.assertEqual(standalone.own_process_ids(), {5, 6})

    def test_the_job_lists_them_on_windows(self):
        with patch.object(
            standalone, "_job_process_ids", return_value={os.getpid(), 7, 8}
        ):
            self.assertEqual(standalone.own_process_ids(), {7, 8})

    def test_no_job_no_list(self):
        with patch.object(standalone, "_job_handles", []):
            self.assertIsNone(standalone._job_process_ids())

    def test_stop_service_without_a_filter_still_stops_every_copy(self):
        processes = [
            fake_process(pid, ["python", "service/exif/main.py"]) for pid in (1, 2)
        ]
        with (
            patch("psutil.process_iter", return_value=processes),
            patch("psutil.wait_procs", return_value=(processes, [])),
        ):
            self.assertTrue(supervisor.stop_service("exif"))
        for process in processes:
            process.terminate.assert_called_once_with()


BACKUP_BEFORE_UPDATE = [
    "Backed up the database to C:\\data\\db\\backups\\x.sqlite3 before applying "
    "7 pending migrations"
]


class StartupStatusTest(SimpleTestCase):
    """The tray is there before migrate and says what is happening."""

    def setUp(self):
        temporary_data_dir(self)

    def start(self, backup_lines, migrate_lines, quit_during_migrate=False):
        order = []
        startup = standalone.Startup()

        def teed(argv, startup_arg=None, on_line=None):
            step = argv[-2] if argv[-1].startswith("--") else argv[-1]
            order.append(step)
            if "backup_database" in argv:
                return 0, backup_lines
            for line in migrate_lines:
                on_line(line)
            if quit_during_migrate:
                startup_arg.quit()
                return 1, []
            return 0, migrate_lines

        with (
            patch.object(standalone, "_already_running", return_value=False),
            patch.object(instance_lock, "acquire", return_value=MagicMock()),
            patch.object(standalone, "_capture_console_output"),
            patch.object(standalone, "check_port"),
            patch.object(standalone, "_take_children_down_with_us"),
            patch.object(
                startup, "show_tray", side_effect=lambda url: order.append("tray")
            ),
            patch.object(
                startup,
                "show_page",
                side_effect=lambda host, port: order.append("page"),
            ),
            patch("webbrowser.open", side_effect=lambda url: order.append("browser")),
            patch.object(
                startup,
                "set_phase",
                side_effect=lambda *phase: order.append(phase),
            ),
            patch.object(startup, "notify") as notify,
            patch.object(startup, "status") as status,
            patch.object(standalone, "run_teed", side_effect=teed),
            patch("django.setup", side_effect=RuntimeError("stop here")) as setup,
            patch.object(standalone, "_shutdown"),
        ):
            try:
                standalone.run_server(
                    "127.0.0.1", 8000, self.open_browser, True, startup
                )
            except RuntimeError:
                pass
        return order, notify, status, setup

    open_browser = False

    def test_the_icon_comes_before_the_backup_and_migrate(self):
        order, _, _, _ = self.start([], [])
        self.assertEqual(order[0], "tray")
        self.assertEqual(
            order[1:], ["page", "backup_database", "migrate", ("starting",)]
        )

    def test_the_browser_opens_on_the_start_up_page_at_once(self):
        # #2310: before migrate, not once the server answers.
        self.open_browser = True
        order, _, _, _ = self.start([], [])
        self.assertEqual(order[:4], ["tray", "page", "browser", "backup_database"])

    def test_the_page_says_updating_while_migrations_run(self):
        applying = ["  Applying api.0160_x... OK\n", "  Applying api.0161_x... OK\n"]
        order, _, _, _ = self.start(BACKUP_BEFORE_UPDATE, applying)
        phases = [step for step in order if isinstance(step, tuple)]
        # Once for the backup's report, once for the first migration.
        self.assertEqual(phases, [("updating",), ("updating",), ("starting",)])

    def test_a_first_start_says_updating_from_its_first_migration(self):
        order, _, _, _ = self.start(
            ["The database is new: nothing to back up."],
            ["  Applying api.0001_squashed_0100... OK\n"],
        )
        self.assertLess(order.index(("updating",)), order.index(("starting",)))

    def test_nothing_to_migrate_stays_starting(self):
        order, _, _, _ = self.start([], ["No migrations to apply.\n"])
        phases = [step for step in order if isinstance(step, tuple)]
        self.assertEqual(phases, [("starting",)])

    def test_an_update_says_so_once_and_counts(self):
        applying = [f"  Applying api.016{n}_x... OK\n" for n in range(3)]
        _, notify, status, _ = self.start(BACKUP_BEFORE_UPDATE, applying)
        notify.assert_called_once_with(*standalone.NOTICE_UPDATE)
        statuses = [c.args[0] for c in status.call_args_list]
        self.assertEqual(statuses[0], "Updating the database (0 of 7)")
        self.assertIn("Updating the database (3 of 7)", statuses)
        self.assertEqual(statuses[-1], standalone.STATUS_SERVICES)

    def test_a_first_start_says_it_sets_the_database_up(self):
        _, notify, status, _ = self.start(
            ["The database is new: nothing to back up."],
            ["Running migrations:\n", "  Applying api.0001_squashed_0100... OK\n"],
        )
        notify.assert_called_once_with(*standalone.NOTICE_SETUP)
        self.assertIn(
            call("Setting up the database (1 steps done)"), status.call_args_list
        )

    def test_nothing_to_migrate_means_no_notification(self):
        _, notify, _, _ = self.start(
            ["No pending migrations: no backup needed."], ["No migrations to apply.\n"]
        )
        notify.assert_not_called()

    def test_quit_during_migrate_starts_nothing_else(self):
        with self.assertRaises(standalone.StartupCancelledError):
            self.start(BACKUP_BEFORE_UPDATE, [], quit_during_migrate=True)

    def test_quit_is_quiet(self):
        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(
                standalone,
                "run_server",
                side_effect=standalone.StartupCancelledError,
            ),
            patch.object(standalone, "_report_failure") as report,
        ):
            standalone.main(["run"])
        report.assert_not_called()


class QuitTest(SimpleTestCase):
    def test_quit_terminates_the_running_child_and_stops_the_server(self):
        startup = standalone.Startup()
        child = MagicMock()
        child.poll.return_value = None
        startup.track(child)
        startup.server = SimpleNamespace(should_exit=False)
        startup.quit()
        child.terminate.assert_called_once_with()
        self.assertTrue(startup.server.should_exit)
        with self.assertRaises(standalone.StartupCancelledError):
            startup.check()

    def test_a_child_started_after_quit_is_terminated_at_once(self):
        startup = standalone.Startup()
        startup.quit()
        child = MagicMock()
        startup.track(child)
        child.terminate.assert_called_once_with()


class PendingMigrationCountTest(SimpleTestCase):
    def test_reads_the_backup_report(self):
        self.assertEqual(standalone.pending_migration_count(BACKUP_BEFORE_UPDATE), 7)
        self.assertEqual(
            standalone.pending_migration_count(
                ["Backed up the database to x before applying 1 pending migrations"]
            ),
            1,
        )

    def test_none_without_one(self):
        self.assertIsNone(standalone.pending_migration_count(["No pending migrations"]))


class KeptLogTest(SimpleTestCase):
    def test_the_previous_console_log_is_kept(self):
        data = temporary_data_dir(self)
        logs = os.path.join(data, "logs")
        with open(os.path.join(logs, "console.log"), "w") as handle:
            handle.write("why the last start failed")
        with (
            patch.object(
                standalone,
                "__compiled__",
                SimpleNamespace(standalone=True),
                create=True,
            ),
            patch.object(standalone, "_output_is_discarded", return_value=True),
            patch.object(standalone, "_redirect_output") as redirect,
            patch.dict(os.environ),
        ):
            standalone._capture_console_output()
        with open(os.path.join(logs, "console.previous.log")) as handle:
            self.assertEqual(handle.read(), "why the last start failed")
        redirect.assert_called_once_with(os.path.join(logs, "console.log"), "w")

    def test_a_first_start_has_nothing_to_keep(self):
        data = temporary_data_dir(self)
        with (
            patch.object(
                standalone,
                "__compiled__",
                SimpleNamespace(standalone=True),
                create=True,
            ),
            patch.object(standalone, "_output_is_discarded", return_value=True),
            patch.object(standalone, "_redirect_output") as redirect,
            patch.dict(os.environ),
        ):
            standalone._capture_console_output()
        redirect.assert_called_once()
        self.assertFalse(
            os.path.exists(os.path.join(data, "logs", "console.previous.log"))
        )


class FakeIcon:
    def __init__(self, name, image, title, menu):
        self.title = title
        self.menu = menu
        self.updates = 0
        self.notified = []

    def run(self, setup=None):
        if setup is not None:
            setup(self)

    def update_menu(self):
        self.updates += 1

    def notify(self, message, title=None):
        self.notified.append((title, message))

    def stop(self):
        pass


def fake_pystray():
    module = types.ModuleType("pystray")
    module.Icon = FakeIcon
    module.MenuItem = lambda text, action, **kwargs: SimpleNamespace(
        text=text, action=action, **kwargs
    )
    menu = lambda *items: list(items)  # noqa: E731
    menu.SEPARATOR = None
    module.Menu = menu
    return module


class TrayTest(SimpleTestCase):
    def tray(self, on_quit=lambda: None):
        from librephotos.tray import Tray

        with stub_modules({"pystray": fake_pystray()}):
            tray = Tray(URL, MagicMock(), "Starting...", on_quit, ("d", "l"))
        tray._shown.wait(1)
        return tray

    def test_the_first_menu_line_is_the_greyed_status(self):
        tray = self.tray()
        status_item = tray.icon.menu[0]
        self.assertFalse(status_item.enabled)
        self.assertEqual(status_item.text(status_item), "Starting...")
        self.assertEqual(tray.icon.title, "LibrePhotos: Starting...")

    def test_a_new_status_reaches_tooltip_and_menu(self):
        tray = self.tray()
        tray.set_status("Updating the database (3 of 7)")
        self.assertEqual(tray.icon.title, "LibrePhotos: Updating the database (3 of 7)")
        self.assertEqual(tray.icon.menu[0].text(None), "Updating the database (3 of 7)")
        self.assertEqual(tray.icon.updates, 1)

    def test_quit_calls_back(self):
        quit_app = MagicMock()
        tray = self.tray(quit_app)
        tray.icon.menu[-1].action(tray.icon, None)
        quit_app.assert_called_once_with()

    def test_notify(self):
        tray = self.tray()
        tray.notify(*standalone.NOTICE_UPDATE)
        self.assertEqual(tray.icon.notified, [standalone.NOTICE_UPDATE])

    def test_show_tray_is_windows_only_and_survives_a_missing_pystray(self):
        startup = standalone.Startup()
        temporary_data_dir(self)
        with patch("librephotos.tray.Tray", side_effect=ImportError("no pystray")):
            startup.show_tray(URL)
        self.assertIsNone(startup.tray)
        if sys.platform != "win32":
            with patch("librephotos.tray.Tray") as tray:
                startup.show_tray(URL)
            tray.assert_not_called()
