"""ownphotos.log becomes librephotos.log on the first start of a newer release
(#170), with its rotated backups, without ever stopping the start."""

import ast
import logging
import logging.config
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase

from librephotos import logging_bootstrap
from librephotos.logging_bootstrap import (
    LEGACY_LOG_FILENAME,
    LEGACY_LOG_NOTED_MARKER,
    LOG_FILENAME,
    build_logging_config,
    rename_legacy_log_file,
    take_deferred,
)

SETTINGS_DIR = Path(logging_bootstrap.__file__).resolve().parent / "settings"


def write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


class LogFileRenameTest(SimpleTestCase):
    def setUp(self):
        take_deferred()
        self.addCleanup(take_deferred)
        self.root = tempfile.mkdtemp(prefix="librephotos-logrename-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.legacy = os.path.join(self.root, LEGACY_LOG_FILENAME)
        self.current = os.path.join(self.root, LOG_FILENAME)

    def deferred(self, level: int) -> list[str]:
        return [message for lvl, message in take_deferred() if lvl == level]

    def test_the_new_name(self):
        self.assertEqual(LOG_FILENAME, "librephotos.log")
        self.assertEqual(LEGACY_LOG_FILENAME, "ownphotos.log")

    def test_renames_the_file_and_its_rotated_backups(self):
        write(self.legacy, "current\n")
        write(self.legacy + ".1", "older\n")
        write(self.legacy + ".10", "oldest\n")
        # Not a rotated backup: left alone.
        write(self.legacy + ".bak", "mine\n")

        self.assertTrue(rename_legacy_log_file(self.root))

        self.assertEqual(read(self.current), "current\n")
        self.assertEqual(read(self.current + ".1"), "older\n")
        self.assertEqual(read(self.current + ".10"), "oldest\n")
        self.assertFalse(os.path.exists(self.legacy))
        self.assertFalse(os.path.exists(self.legacy + ".1"))
        self.assertTrue(os.path.exists(self.legacy + ".bak"))
        [warning] = self.deferred(logging.WARNING)
        self.assertIn(self.legacy, warning)
        self.assertIn(self.current, warning)
        self.assertIn("fail2ban", warning)
        self.assertNotIn("Could not rename", warning)

    def test_nothing_to_do_without_an_old_file(self):
        self.assertFalse(rename_legacy_log_file(self.root))

        self.assertEqual(os.listdir(self.root), [])
        self.assertEqual(take_deferred(), [])

    def test_a_missing_logs_root_is_not_an_error(self):
        self.assertFalse(rename_legacy_log_file(os.path.join(self.root, "missing")))
        self.assertEqual(take_deferred(), [])

    def test_an_existing_new_file_wins_and_the_old_one_is_noted_once(self):
        write(self.legacy, "old\n")
        write(self.legacy + ".1", "older\n")
        write(self.current, "new\n")

        self.assertFalse(rename_legacy_log_file(self.root))
        [note] = self.deferred(logging.INFO)
        self.assertIn(self.legacy, note)
        self.assertIn(self.current, note)

        # The next start says nothing again.
        self.assertFalse(rename_legacy_log_file(self.root))
        self.assertEqual(take_deferred(), [])

        self.assertEqual(read(self.legacy), "old\n")
        self.assertEqual(read(self.legacy + ".1"), "older\n")
        self.assertEqual(read(self.current), "new\n")
        self.assertFalse(os.path.exists(self.current + ".1"))
        self.assertTrue(
            os.path.exists(os.path.join(self.root, LEGACY_LOG_NOTED_MARKER))
        )

    def test_an_unwritable_marker_only_repeats_the_note(self):
        write(self.legacy, "old\n")
        write(self.current, "new\n")

        with patch("builtins.open", side_effect=PermissionError("read-only")):
            self.assertFalse(rename_legacy_log_file(self.root))

        self.assertEqual(len(self.deferred(logging.INFO)), 1)
        self.assertFalse(
            os.path.exists(os.path.join(self.root, LEGACY_LOG_NOTED_MARKER))
        )

    def test_a_refused_rename_leaves_the_old_file_and_does_not_stop_the_start(self):
        write(self.legacy, "old\n")
        write(self.legacy + ".1", "older\n")
        refusal = PermissionError(32, "being used by another process")

        with patch("librephotos.logging_bootstrap.os.rename", side_effect=refusal):
            self.assertFalse(rename_legacy_log_file(self.root))

        self.assertEqual(read(self.legacy), "old\n")
        self.assertEqual(read(self.legacy + ".1"), "older\n")
        self.assertFalse(os.path.exists(self.current))
        [warning] = self.deferred(logging.WARNING)
        self.assertIn(self.legacy, warning)
        self.assertIn("being used by another process", warning)

    @unittest.skipUnless(os.name == "nt", "only Windows refuses to rename an open file")
    def test_a_file_held_open_on_windows_is_left_in_place(self):
        write(self.legacy, "old\n")

        with open(self.legacy, encoding="utf-8"):
            self.assertFalse(rename_legacy_log_file(self.root))

        self.assertEqual(read(self.legacy), "old\n")
        self.assertEqual(len(self.deferred(logging.WARNING)), 1)

    def test_another_process_moving_it_first_counts_as_done(self):
        write(self.legacy, "old\n")

        with patch(
            "librephotos.logging_bootstrap.os.rename",
            side_effect=FileNotFoundError(self.legacy),
        ):
            self.assertFalse(rename_legacy_log_file(self.root))

        self.assertEqual(take_deferred(), [])

    def test_backups_that_cannot_be_moved_are_named(self):
        write(self.legacy, "current\n")
        for n in (1, 2, 3):
            write(f"{self.legacy}.{n}", f"backup {n}\n")
        # .1 already has a new-name counterpart, .2 is refused, .3 disappears
        # under a process starting at the same time.
        write(self.current + ".1", "someone else's\n")
        real_rename = os.rename

        def rename(src: str, dst: str) -> None:
            if src.endswith(".2"):
                raise PermissionError(32, "in use")
            if src.endswith(".3"):
                os.remove(src)
                raise FileNotFoundError(src)
            real_rename(src, dst)

        with patch("librephotos.logging_bootstrap.os.rename", side_effect=rename):
            self.assertTrue(rename_legacy_log_file(self.root))

        self.assertEqual(read(self.current), "current\n")
        self.assertEqual(read(self.current + ".1"), "someone else's\n")
        self.assertEqual(read(self.legacy + ".1"), "backup 1\n")
        self.assertEqual(read(self.legacy + ".2"), "backup 2\n")
        [warning] = self.deferred(logging.WARNING)
        self.assertIn(f"Could not rename {self.legacy}.1, {self.legacy}.2", warning)
        self.assertNotIn(".3", warning)

    def test_an_unlistable_folder_still_renames_the_file(self):
        write(self.legacy, "current\n")
        write(self.legacy + ".1", "older\n")

        with patch(
            "librephotos.logging_bootstrap.os.listdir",
            side_effect=PermissionError("no list permission"),
        ):
            self.assertTrue(rename_legacy_log_file(self.root))

        self.assertEqual(read(self.current), "current\n")
        self.assertEqual(read(self.legacy + ".1"), "older\n")
        self.assertEqual(len(self.deferred(logging.WARNING)), 1)

    def test_the_handler_appends_to_the_renamed_file(self):
        write(self.legacy, "history\n")
        rename_legacy_log_file(self.root)
        take_deferred()

        logging.config.dictConfig(
            build_logging_config(
                logs_root=self.root, level="INFO", to_console=False, logger_levels={}
            )
        )
        try:
            logging.getLogger("api.test_log_file_rename").info("after the upgrade")
        finally:
            logging.config.dictConfig(settings.LOGGING)

        lines = read(self.current).splitlines()
        self.assertEqual(lines[0], "history")
        self.assertIn("after the upgrade", lines[-1])
        self.assertFalse(os.path.exists(self.legacy))


class SettingsRenameBeforeConfiguringTest(SimpleTestCase):
    """production.py moves the old file before LOGGING creates a new, empty one."""

    def test_rename_runs_between_ensure_logs_root_and_the_logging_config(self):
        tree = ast.parse((SETTINGS_DIR / "production.py").read_text(encoding="utf-8"))
        wanted = ("ensure_logs_root", "rename_legacy_log_file", "build_logging_config")
        calls = sorted(
            (node.lineno, node.func.id)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in wanted
        )
        order = [name for _, name in calls]
        self.assertEqual(
            order,
            ["ensure_logs_root", "rename_legacy_log_file", "build_logging_config"],
        )
