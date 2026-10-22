"""The update check in the Windows app's tray (#2311): the menu items, and a
notification once per new release.

pystray is faked (it is only installed for the standalone build); the manual
check on Windows is in the PR description.
"""

import threading
from unittest.mock import MagicMock, patch

from constance import config as site_config
from django.test import TestCase, override_settings

from api.tests.infra.test_standalone_single_instance import URL, fake_pystray
from api.tests.stubs import stub_modules
from api.tests.updates.test_update_check import RELEASES, release, session_answering
from api.updates import tray as tray_updates
from api.updates.check import check_for_updates, skip_release, update_status
from api.updates.tray import (
    TrayUpdates,
    check_answer,
    menu_label,
    release_to_announce,
    watch_updates,
)
from librephotos import standalone

WINDOWS_DOCS = (
    "https://docs.librephotos.com/docs/installation/windows-standalone#updating"
)


class RecordingTray:
    """What TrayUpdates needs of librephotos.tray.Tray."""

    def __init__(self):
        self.update = None
        self.notified = []
        self.on_check = None

    def set_update(self, label, url):
        self.update = (label, url)

    def notify(self, title, message):
        self.notified.append((title, message))

    def enable_update_check(self, on_check):
        self.on_check = on_check


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="windows", UPDATE_CHECK_ALLOWED=True)
class TrayUpdatesTest(TestCase):
    def setUp(self):
        self.tray = RecordingTray()
        self.updates = TrayUpdates(self.tray)

    def test_nothing_known_hides_the_item_and_says_nothing(self):
        self.updates.refresh()
        self.assertEqual(self.tray.update, (None, WINDOWS_DOCS))
        self.assertEqual(self.tray.notified, [])

    def test_a_new_release_is_announced_once(self):
        check_for_updates(session_answering())
        self.updates.refresh()
        self.updates.refresh()
        self.assertEqual(
            self.tray.update, ("Update to 1.4.0 available...", WINDOWS_DOCS)
        )
        self.assertEqual(
            self.tray.notified,
            [
                (
                    "LibrePhotos 1.4.0 is available",
                    "Right-click the LibrePhotos icon to update.",
                )
            ],
        )
        # A restart reads what was announced.
        TrayUpdates(self.tray).refresh()
        self.assertEqual(len(self.tray.notified), 1)

    def test_the_next_release_is_announced_again(self):
        check_for_updates(session_answering())
        self.updates.refresh()
        check_for_updates(session_answering([release("1.6.0"), *RELEASES]))
        self.updates.refresh()
        self.assertEqual(
            [title for title, _ in self.tray.notified],
            ["LibrePhotos 1.4.0 is available", "LibrePhotos 1.6.0 is available"],
        )

    def test_a_skipped_release_is_not_announced_but_still_in_the_menu(self):
        check_for_updates(session_answering())
        skip_release("1.4.0")
        self.updates.refresh()
        self.assertEqual(self.tray.notified, [])
        self.assertEqual(self.tray.update[0], "Update to 1.4.0 available...")

    def test_check_now_answers_with_what_it_found(self):
        with patch.object(
            tray_updates,
            "check_for_updates",
            side_effect=lambda: check_for_updates(session_answering()),
        ):
            self.updates.check_now()
        self.assertEqual(self.tray.notified[0][0], "LibrePhotos 1.4.0 is available")
        self.assertEqual(str(site_config.UPDATE_CHECK_NOTIFIED_RELEASE), "1.4.0")
        # That was the announcement: the hourly read does not repeat it.
        self.updates.refresh()
        self.assertEqual(len(self.tray.notified), 1)

    @override_settings(IMAGE_TAG="1.4.0")
    def test_check_now_says_up_to_date(self):
        with patch.object(
            tray_updates,
            "check_for_updates",
            side_effect=lambda: check_for_updates(session_answering()),
        ):
            self.updates.check_now()
        self.assertEqual(
            self.tray.notified,
            [("LibrePhotos is up to date", "You have 1.4.0, the newest release.")],
        )

    def test_check_now_survives_a_failure(self):
        with patch.object(tray_updates, "check_for_updates", side_effect=RuntimeError):
            self.updates.check_now()
        self.assertEqual(self.tray.notified, [])

    def test_refresh_survives_a_failure(self):
        with patch.object(tray_updates, "update_status", side_effect=RuntimeError):
            self.updates.refresh()
        self.assertIsNone(self.tray.update)

    def test_watch_adds_check_for_updates_and_polls_until_stopped(self):
        stop = threading.Event()
        stop.set()
        with patch.object(tray_updates.threading, "Thread") as thread:
            updates = watch_updates(self.tray, stop)
        self.assertEqual(self.tray.on_check, updates.check_in_thread)
        self.assertEqual(thread.call_args.kwargs["target"], updates.poll)
        thread.return_value.start.assert_called_once_with()
        # The thread's own database connection is let go after each round.
        with (
            patch.object(TrayUpdates, "refresh") as refresh,
            patch.object(tray_updates, "close_old_connections") as close,
        ):
            updates.poll(stop)
        refresh.assert_called_once_with()
        close.assert_called_once_with()

    def test_check_in_thread_lets_its_connection_go(self):
        with (
            patch.object(TrayUpdates, "check_now") as check_now,
            patch.object(tray_updates, "close_old_connections") as close,
        ):
            self.updates.check_in_thread()
        check_now.assert_called_once_with()
        close.assert_called_once_with()


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="docker", UPDATE_CHECK_ALLOWED=True)
class CheckAnswerTest(TestCase):
    def answer(self):
        return check_answer(update_status())

    def test_each_state_has_an_answer(self):
        self.assertEqual(self.answer()[0], "Could not check for updates")
        with override_settings(UPDATE_CHECK_ALLOWED=False):
            self.assertIn("UPDATE_CHECK", self.answer()[1])
        site_config.UPDATE_CHECK = False
        self.assertIn("site settings", self.answer()[1])
        site_config.UPDATE_CHECK = True
        with override_settings(IMAGE_TAG="dev"):
            self.assertIn("development build", self.answer()[1])

    def test_a_skipped_release_is_still_named_when_asked(self):
        check_for_updates(session_answering())
        skip_release("1.5.0")
        status = update_status()
        self.assertIsNone(release_to_announce(status))
        self.assertEqual(self.answer()[0], "LibrePhotos 1.5.0 is available")
        self.assertEqual(menu_label(status), "Update to 1.5.0 available...")


class TrayMenuTest(TestCase):
    def tray(self):
        from librephotos.tray import Tray

        with stub_modules({"pystray": fake_pystray()}):
            tray = Tray(URL, MagicMock(), "Running", lambda: None, ("d", "l"))
        tray._shown.wait(1)
        return tray

    def item(self, tray, index):
        return tray.icon.menu[index]

    def test_the_update_items_are_hidden_until_there_is_something(self):
        tray = self.tray()
        update, check = self.item(tray, 3), self.item(tray, 4)
        self.assertFalse(update.visible(update))
        self.assertFalse(check.visible(check))
        self.assertEqual(self.item(tray, -1).text, "Quit LibrePhotos")

    def test_the_update_item_opens_the_update_steps(self):
        tray = self.tray()
        tray.set_update("Update to 1.5.0 available...", WINDOWS_DOCS)
        update = self.item(tray, 3)
        self.assertTrue(update.visible(update))
        self.assertEqual(update.text(update), "Update to 1.5.0 available...")
        with patch("librephotos.tray.webbrowser.open") as browser:
            update.action(tray.icon, update)
        browser.assert_called_once_with(WINDOWS_DOCS)
        tray.set_update(None, WINDOWS_DOCS)
        self.assertFalse(update.visible(update))
        self.assertEqual(update.text(update), "")

    def test_check_for_updates_runs_off_the_menu_thread(self):
        tray = self.tray()
        done = threading.Event()
        tray.enable_update_check(done.set)
        check = self.item(tray, 4)
        self.assertTrue(check.visible(check))
        check.action(tray.icon, check)
        self.assertTrue(done.wait(5))

    def test_the_server_start_hooks_the_tray_up(self):
        startup = standalone.Startup()
        stop = threading.Event()
        with patch("api.updates.tray.watch_updates") as watch:
            startup.watch_updates(stop)
            watch.assert_not_called()
            startup.tray = MagicMock()
            startup.watch_updates(stop)
        watch.assert_called_once_with(startup.tray, stop)

    def test_running_starts_the_watch(self):
        startup = MagicMock()
        server = MagicMock(started=True)
        stopped = threading.Event()
        standalone._say_when_running(server, URL, startup, stopped)
        startup.watch_updates.assert_called_once_with(stopped)
