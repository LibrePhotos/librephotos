"""Where the generated Django secret key lives (#2381).

It used to be BASE_LOGS/secret.key, next to the log people zip for bug
reports. It now lives in MEDIA_ROOT (the protected_media volume), and an old
key in BASE_LOGS is moved there rather than regenerated, which would log every
user out.
"""

import contextlib
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase

from librephotos import secret_key
from librephotos.logging_bootstrap import take_deferred_warnings

BACKEND_ROOT = Path(__file__).resolve().parents[3]

OLD_KEY = "old-key-from-the-logs-folder"


class LoadOrCreateSecretKeyTest(SimpleTestCase):
    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = Path(scratch.name)
        self.key_file = root / "protected_media" / "secret.key"
        self.legacy_file = root / "logs" / "secret.key"
        self.legacy_file.parent.mkdir()
        take_deferred_warnings()
        self.addCleanup(take_deferred_warnings)

    def load(self) -> str:
        return secret_key.load_or_create_secret_key(
            str(self.key_file), legacy_path=str(self.legacy_file)
        )

    def leftover_files(self) -> list[str]:
        return sorted(p.name for p in self.key_file.parent.iterdir())

    def test_fresh_install_writes_outside_the_logs_folder(self) -> None:
        key = self.load()

        self.assertGreaterEqual(len(key), 50)
        self.assertEqual(self.key_file.read_text(), key)
        self.assertFalse(self.legacy_file.exists())
        self.assertEqual(self.leftover_files(), ["secret.key"])
        if os.name == "posix":
            self.assertEqual(self.key_file.stat().st_mode & 0o777, 0o600)
        warnings = take_deferred_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn("Generated a new Django secret key", warnings[0])

    def test_existing_key_is_reused(self) -> None:
        first = self.load()
        take_deferred_warnings()

        self.assertEqual(self.load(), first)
        self.assertEqual(take_deferred_warnings(), [])

    def test_old_key_is_moved_not_regenerated(self) -> None:
        self.legacy_file.write_text(OLD_KEY + "\n")

        self.assertEqual(self.load(), OLD_KEY)

        self.assertEqual(self.key_file.read_text(), OLD_KEY)
        self.assertFalse(self.legacy_file.exists())
        warnings = take_deferred_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn("Moved the Django secret key", warnings[0])
        self.assertIn(str(self.legacy_file), warnings[0])

    def test_both_present_prefers_the_new_file_and_keeps_the_old(self) -> None:
        self.key_file.parent.mkdir()
        self.key_file.write_text("new-key")
        self.legacy_file.write_text(OLD_KEY)

        self.assertEqual(self.load(), "new-key")

        self.assertEqual(self.legacy_file.read_text(), OLD_KEY)
        warnings = take_deferred_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn("Both", warnings[0])
        self.assertIn("a different, unused key", warnings[0])

    def test_empty_old_file_is_not_a_key(self) -> None:
        self.legacy_file.write_text("")

        key = self.load()

        self.assertTrue(key)
        self.assertEqual(self.key_file.read_text(), key)

    def test_old_file_that_cannot_be_removed_is_reported(self) -> None:
        self.legacy_file.write_text(OLD_KEY)

        with mock.patch.object(
            secret_key.os, "remove", side_effect=PermissionError("in use")
        ):
            self.assertEqual(self.load(), OLD_KEY)

        self.assertEqual(self.key_file.read_text(), OLD_KEY)
        self.assertEqual(self.legacy_file.read_text(), OLD_KEY)
        warnings = take_deferred_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn("could not remove the old file", warnings[0])

    def test_without_hard_links_the_key_is_created_exclusively(self) -> None:
        self.legacy_file.write_text(OLD_KEY)

        with mock.patch.object(
            secret_key.os, "link", side_effect=OSError("not supported")
        ):
            self.assertEqual(self.load(), OLD_KEY)

        self.assertEqual(self.key_file.read_text(), OLD_KEY)
        self.assertFalse(self.legacy_file.exists())
        self.assertEqual(self.leftover_files(), ["secret.key"])

    def test_empty_key_file_is_an_error_not_a_new_key(self) -> None:
        self.key_file.parent.mkdir()
        self.key_file.write_text("")

        with mock.patch.object(secret_key, "EMPTY_FILE_WAIT_SECONDS", 0.1):
            with self.assertRaisesRegex(secret_key.SecretKeyError, "is empty"):
                self.load()
        self.assertEqual(self.key_file.read_text(), "")

    def test_concurrent_first_starts_agree_on_one_key(self) -> None:
        for link_works in (True, False):
            with self.subTest(link_works=link_works):
                if self.key_file.exists():
                    self.key_file.unlink()
                keys = self._load_in_threads(link_works)
                self.assertEqual(len(set(keys)), 1)
                self.assertEqual(self.key_file.read_text(), keys[0])
                self.assertEqual(self.leftover_files(), ["secret.key"])
                generated = [w for w in take_deferred_warnings() if "Generated" in w]
                self.assertEqual(len(generated), 1)

    def _load_in_threads(self, link_works: bool) -> list[str]:
        threads_count = 8
        barrier = threading.Barrier(threads_count)
        keys: list[str] = []
        errors: list[BaseException] = []

        def start() -> None:
            barrier.wait()
            try:
                keys.append(self.load())
            except BaseException as error:  # reported by the assertion below
                errors.append(error)

        patcher = (
            contextlib.nullcontext()
            if link_works
            else mock.patch.object(secret_key.os, "link", side_effect=OSError("no"))
        )
        with patcher:
            threads = [threading.Thread(target=start) for _ in range(threads_count)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(errors, [])
        return keys


class SettingsSecretKeyTest(SimpleTestCase):
    """The settings module, imported in fresh processes as the server does."""

    PROBE = (
        "from librephotos.settings import production as s; print('KEY=' + s.SECRET_KEY)"
    )

    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.data = Path(scratch.name)
        self.logs = self.data / "logs"
        self.key_file = self.data / "protected_media" / "secret.key"
        self.legacy_file = self.logs / "secret.key"

    def _start(self, **extra_env: str) -> subprocess.Popen[str]:
        env = {
            **{k: v for k, v in os.environ.items() if k != "SECRET_KEY"},
            "BASE_DATA": str(self.data),
            "BASE_LOGS": str(self.logs),
            **extra_env,
        }
        return subprocess.Popen(
            [sys.executable, "-c", self.PROBE],
            cwd=BACKEND_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def _keys(self, processes: list[subprocess.Popen[str]]) -> list[str]:
        keys = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=300)
            self.assertEqual(process.returncode, 0, stderr)
            keys.append(stdout.rsplit("KEY=", 1)[1].strip())
        return keys

    def test_environment_variable_wins_and_writes_no_file(self) -> None:
        self.logs.mkdir()
        self.legacy_file.write_text(OLD_KEY)

        (key,) = self._keys([self._start(SECRET_KEY="from-the-environment")])

        self.assertEqual(key, "from-the-environment")
        self.assertFalse(self.key_file.exists())
        self.assertEqual(self.legacy_file.read_text(), OLD_KEY)

    def test_processes_starting_together_move_the_old_key(self) -> None:
        self.logs.mkdir()
        self.legacy_file.write_text(OLD_KEY)

        keys = self._keys([self._start() for _ in range(4)])

        self.assertEqual(keys, [OLD_KEY] * 4)
        self.assertEqual(self.key_file.read_text(), OLD_KEY)
        self.assertFalse(self.legacy_file.exists())

    def test_processes_starting_together_on_a_fresh_install_share_one_key(
        self,
    ) -> None:
        keys = self._keys([self._start() for _ in range(4)])

        self.assertEqual(len(set(keys)), 1)
        self.assertEqual(self.key_file.read_text(), keys[0])
        self.assertFalse(self.legacy_file.exists())
