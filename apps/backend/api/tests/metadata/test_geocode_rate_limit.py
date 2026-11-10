"""Tests for the per-provider geocoding rate limiter.

The rate limiter exists because LibrePhotos was firing reverse_geocode
calls faster than nominatim's 1-request-per-second courtesy limit
permits, causing slow/timed-out responses and a self-reinforcing
hammer-the-server loop. State is held in a SQLite database under BASE_DATA
so multiple django-q2 worker processes coordinate through one set of
timestamps instead of each independently respecting the delay.

These tests pin the sleep behaviour, provider configuration, and
cross-process coordination so regressions don't silently disable any
of those properties.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import psutil
from django.test import SimpleTestCase, override_settings

from api.geocode import rate_limit


class WaitBehaviourTest(SimpleTestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._override = override_settings(BASE_DATA=self._tmpdir.name)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        self._tmpdir.cleanup()

    def test_first_call_does_not_sleep(self):
        # Fresh cache: no prior timestamp, so the wait() short-circuits
        # without sleeping regardless of the configured delay.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch("api.geocode.rate_limit._now", return_value=1000.0):
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_immediate_second_call_sleeps_for_remaining_delay(self):
        # First call records last_call=1000.0. Second call's first iteration
        # sees now=1000.2 (elapsed 0.2 vs 1.1 nominatim delay), sleeps for
        # the 0.9s remaining, then the second iteration finds elapsed=1.1
        # and claims the slot.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1000.2, 1001.1],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_called_once()
        slept = mock_sleep.call_args.args[0]
        self.assertAlmostEqual(slept, 0.9, places=6)

    def test_call_after_delay_passes_through_without_sleep(self):
        # Two calls 2 seconds apart, with the 1.1s nominatim window — the
        # second must not sleep.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1002.0],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_zero_delay_provider_is_a_no_op(self):
        # All real providers have positive delays so we override the table
        # to verify the zero-delay fast path.
        with patch.dict(
            "api.geocode.rate_limit._MIN_DELAY_PER_PROVIDER",
            {"nominatim": 0.0},
        ):
            with patch("api.geocode.rate_limit._sleep") as mock_sleep:
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_providers_have_independent_timestamps(self):
        # Calling wait() on one provider must not delay calls on a different
        # provider — they share a cache but key by provider name.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1000.0001],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("mapbox")
        mock_sleep.assert_not_called()


class ProviderConfigTest(SimpleTestCase):
    def test_nominatim_has_explicit_one_per_second_delay(self):
        # Nominatim's terms of use require >= 1 request/sec. The exact value
        # is documented in the module; this test guards against accidentally
        # weakening it.
        self.assertGreaterEqual(rate_limit._delay_for("nominatim"), 1.0)

    def test_unknown_provider_gets_default_delay(self):
        self.assertGreater(rate_limit._delay_for("some-future-provider"), 0)


BACKEND = Path(__file__).resolve().parents[3]

# A worker: wait for the provider ``calls`` times, print the time the store
# recorded for each call.
WORKER = """
import sys
from api.geocode.rate_limit import RateLimitStore
store = RateLimitStore(sys.argv[1])
print("ready", flush=True)
sys.stdin.readline()  # start together
for _ in range(int(sys.argv[3])):
    print(repr(store.wait("nominatim", float(sys.argv[2]))), flush=True)
"""

# Takes the write lock and keeps it until killed.
HOLDER = """
import sqlite3, sys, time
connection = sqlite3.connect(sys.argv[1], isolation_level=None)
connection.execute("CREATE TABLE IF NOT EXISTS last_call (provider TEXT PRIMARY KEY, called_at REAL NOT NULL)")
connection.execute("BEGIN IMMEDIATE")
connection.execute("INSERT OR REPLACE INTO last_call VALUES ('nominatim', 1e12)")
print("locked", flush=True)
time.sleep(600)
"""


def kill_tree(process):
    """Kill ``process`` and its children: a venv's python.exe on Windows is a
    launcher that runs the interpreter as its child."""
    try:
        children = psutil.Process(process.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        children = []
    for child in children:
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    process.kill()
    process.wait(30)
    psutil.wait_procs(children, timeout=30)


class CrossProcessCoordinationTest(SimpleTestCase):
    """Worker processes share the timestamps: real processes, real SQLite."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.database = os.path.join(self._tmpdir.name, "rate.sqlite3")

    def python(self, code, *args):
        process = subprocess.Popen(
            [sys.executable, "-c", code, self.database, *args],
            cwd=BACKEND,
            env={**os.environ, "PYTHONPATH": str(BACKEND)},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(kill_tree, process)
        return process

    def test_concurrent_workers_keep_the_delay_between_all_their_calls(self):
        delay, workers, calls = 0.2, 4, 3
        processes = [
            self.python(WORKER, str(delay), str(calls)) for _ in range(workers)
        ]
        for process in processes:
            self.assertEqual(process.stdout.readline().strip(), "ready")
        for process in processes:
            process.stdin.write("go\n")
            process.stdin.flush()
        times = []
        for process in processes:
            output, _ = process.communicate(timeout=60)
            times.extend(float(line) for line in output.split())
        times.sort()
        self.assertEqual(len(times), workers * calls)
        # The times the store recorded, each taken inside its transaction:
        # no two calls by any of the workers are closer than the delay.
        self.assertEqual(len(set(times)), len(times))
        gaps = [later - earlier for earlier, later in zip(times, times[1:])]
        self.assertGreaterEqual(min(gaps), delay, gaps)

    def test_a_worker_killed_holding_the_lock_does_not_block_the_others(self):
        holder = self.python(HOLDER)
        self.assertEqual(holder.stdout.readline().strip(), "locked")
        kill_tree(holder)
        # Its uncommitted timestamp (far in the future) was rolled back.
        store = rate_limit.RateLimitStore(self.database)
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            store.wait("nominatim", 1.1)
        mock_sleep.assert_not_called()

    def test_a_restarted_process_sees_the_timestamp_another_wrote(self):
        rate_limit.RateLimitStore(self.database).wait("nominatim", 0.0001)
        claim = rate_limit.RateLimitStore(self.database).claim("nominatim", 600)
        self.assertIsNone(claim.at)
        self.assertGreater(claim.remaining, 590)


class LegacyCacheTest(SimpleTestCase):
    def test_the_old_diskcache_directory_is_removed_once(self):
        with tempfile.TemporaryDirectory() as base:
            legacy = os.path.join(base, "geocode_rate_limit")
            os.makedirs(legacy)
            with open(os.path.join(legacy, "cache.db"), "wb") as handle:
                handle.write(b"SQLite format 3")
            with (
                override_settings(BASE_DATA=base),
                patch("api.geocode.rate_limit._sleep"),
            ):
                rate_limit.wait("nominatim")
            self.assertEqual(os.listdir(base), ["geocode_rate_limit.sqlite3"])
