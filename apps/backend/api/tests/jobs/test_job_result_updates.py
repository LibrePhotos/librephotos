import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import Any

from django.db import connection
from django.test import TestCase, TransactionTestCase

import api
from api.directory_watcher.utils import update_job_result
from api.models import LongRunningJob
from api.tests.jobs import job_result_writers
from api.tests.utils import create_test_job, create_test_user
from librephotos.settings._sqlite import sqlite_database

WRITER = job_result_writers.__file__
BACKEND = Path(api.__file__).resolve().parent.parent
WRITERS = 4
WRITES = 40


class UpdateJobResultTest(TestCase):
    def setUp(self):
        self.job = create_test_job(create_test_user(), result={"n": 0})

    def test_a_write_between_the_read_and_the_write_does_not_make_it_give_up(self):
        calls: list[int] = []
        rows = LongRunningJob.objects.filter(pk=self.job.pk)

        def add_one_while_someone_writes(
            result: dict[str, Any], job: LongRunningJob
        ) -> None:
            calls.append(1)
            rows.update(result={"n": result["n"], "other": len(calls)})
            result["n"] += 1

        with self.assertNoLogs("api.directory_watcher.utils", "ERROR"):
            written = update_job_result(self.job.job_id, add_one_while_someone_writes)

        self.assertIsNotNone(written)
        self.assertEqual([1], calls)
        self.assertEqual(1, rows.get().result["n"])

    def test_a_cancelled_job_is_left_alone(self):
        self.job.cancel()

        self.assertIsNone(update_job_result(self.job.job_id, lambda result, job: None))

    def test_other_fields_are_written_with_the_result(self):
        def mark(result: dict[str, Any], job: LongRunningJob) -> dict[str, Any]:
            result["n"] = 5
            return {"progress_current": 7}

        update_job_result(self.job.job_id, mark)

        row = LongRunningJob.objects.get(pk=self.job.pk)
        self.assertEqual(({"n": 5}, 7), (row.result, row.progress_current))


@unittest.skipUnless(connection.vendor == "sqlite", "copies the SQLite test database")
class ConcurrentJobResultWritesTest(TransactionTestCase):
    def _run_writers(self, target: str, job: LongRunningJob) -> Path:
        path = Path(tempfile.mkdtemp()) / "jobs.sqlite3"
        with closing(sqlite3.connect(path)) as copy:
            connection.ensure_connection()
            connection.connection.backup(copy)
            copy.execute("PRAGMA journal_mode=WAL")
        database = json.dumps(sqlite_database(str(path)))
        writers = [
            subprocess.Popen(
                [sys.executable, WRITER, target, database, job.job_id, str(WRITES)],
                cwd=BACKEND,
                env={**os.environ, "PYTHONPATH": str(BACKEND)},
            )
            for _ in range(WRITERS)
        ]
        self.assertEqual([0] * WRITERS, [writer.wait(300) for writer in writers])
        return path

    def _stored(self, path: Path, job: LongRunningJob) -> tuple[dict[str, Any], int]:
        with closing(sqlite3.connect(path)) as copy:
            result, progress = copy.execute(
                "SELECT result, progress_current FROM api_longrunningjob "
                "WHERE job_id = ?",
                [job.job_id],
            ).fetchone()
        return json.loads(result), progress

    def test_writers_in_other_processes_lose_no_update(self):
        job = create_test_job(create_test_user(), result={"n": 0})

        path = self._run_writers("add_ones", job)

        self.assertEqual(WRITERS * WRITES, self._stored(path, job)[0]["n"])

    def test_errors_counted_in_other_processes_are_all_kept(self):
        job = create_test_job(create_test_user(), progress_target=10 * WRITERS * WRITES)

        path = self._run_writers("count_errors", job)

        result, progress = self._stored(path, job)
        self.assertEqual(WRITERS * WRITES, progress)
        self.assertEqual(WRITERS * WRITES, result["error_count"])
        self.assertEqual(100, len(result["errors"]))
