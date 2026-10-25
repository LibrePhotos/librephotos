"""``api.dataviz.stats.without_parallel_workers``: the stats run serial plans.

A parallel hash join keeps its hash table in Postgres' dynamic shared memory,
Docker's 64 MB /dev/shm, which a few stats requests at once ran out (#2868).
"""

from unittest import skipUnless

from django.db import connection
from django.test import TestCase

from api.dataviz.stats import get_count_stats, without_parallel_workers
from api.tests.utils import create_test_user


def _workers() -> str:
    with connection.cursor() as cursor:
        cursor.execute("SHOW max_parallel_workers_per_gather")
        row = cursor.fetchone()
    assert row is not None
    return str(row[0])


class WithoutParallelWorkersTest(TestCase):
    def test_runs_the_block_on_any_database(self):
        ran = []
        with without_parallel_workers():
            ran.append(True)
        self.assertEqual(ran, [True])

    @skipUnless(connection.vendor == "postgresql", "Postgres setting")
    def test_no_workers_inside_and_the_setting_back_after(self):
        before = _workers()
        self.assertNotEqual(before, "0")

        with without_parallel_workers():
            self.assertEqual(_workers(), "0")

        self.assertEqual(_workers(), before)

    @skipUnless(connection.vendor == "postgresql", "Postgres setting")
    def test_an_error_inside_leaves_the_setting_as_it_was(self):
        before = _workers()

        with self.assertRaises(RuntimeError), without_parallel_workers():
            raise RuntimeError

        self.assertEqual(_workers(), before)

    @skipUnless(connection.vendor == "postgresql", "Postgres setting")
    def test_the_count_stats_run_serial(self):
        seen = []

        def record(execute, sql, params, many, context):
            if sql.startswith('SELECT COUNT("api_face"'):
                seen.append(_workers())
            return execute(sql, params, many, context)

        with connection.execute_wrapper(record):
            get_count_stats(create_test_user())

        self.assertEqual(seen, ["0"])
