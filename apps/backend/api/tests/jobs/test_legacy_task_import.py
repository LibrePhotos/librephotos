import datetime
import pickle

from django.conf import settings
from django.core import signing
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from api.jobs import legacy_import, store
from api.jobs.worker import run_task
from api.models import LongRunningJob, QueuedTask, User
from api.models.task_queue import QUEUED, WAITING
from api.tests.utils import create_test_job, create_test_user

RAN: list[tuple[int, str]] = []


def legacy_step(user: User, job_id: str) -> None:
    RAN.append((user.pk, job_id))


def signed(
    task: object, key: str | None = None, swap: tuple[bytes, bytes] | None = None
) -> str:
    data = pickle.dumps(task, protocol=0)
    if swap is not None:
        data = data.replace(*swap)
    value = signing.b64_encode(data).decode()
    return signing.TimestampSigner(
        key=key or settings.SECRET_KEY, salt="DjangORM"
    ).sign(value)


AUTO_ID = (
    "integer PRIMARY KEY" if connection.vendor == "sqlite" else "serial PRIMARY KEY"
)


class LegacyTaskImportTest(TestCase):
    def setUp(self):
        RAN.clear()
        if not legacy_import.legacy_table_exists():
            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE django_q_ormq (id {AUTO_ID}, key varchar(100), "
                    "payload text, lock timestamp NULL)"
                )
        self.user = create_test_user()

    def _queue(self, payload: str, lock: datetime.datetime | None = None) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO django_q_ormq (key, payload, lock) VALUES (%s, %s, %s)",
                ["DjangORM", payload, connection.ops.adapt_datetimefield_value(lock)],
            )

    def _left(self) -> int:
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM django_q_ormq")
            return cursor.fetchone()[0]

    def test_a_chain_with_a_user_is_carried_over_and_runs(self):
        first = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_SCAN_FACES
        )
        second = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_CLUSTER_ALL_FACES
        )
        self._queue(
            signed(
                {
                    "id": "abc",
                    "func": legacy_step,
                    "args": (self.user,),
                    "kwargs": {"job_id": first.job_id},
                    "chain": [(legacy_step, (self.user,), {"job_id": second.job_id})],
                }
            ),
            lock=timezone.now() - datetime.timedelta(minutes=1),
        )

        self.assertEqual(1, legacy_import.import_waiting_tasks())

        self.assertEqual(0, self._left())
        rows = list(QueuedTask.objects.order_by("id"))
        self.assertEqual([QUEUED, WAITING], [row.status for row in rows])
        self.assertEqual([first.job_id, second.job_id], [row.job_id for row in rows])
        self.assertTrue(rows[1].continue_on_error)
        for _ in rows:
            run_task(store.claim("w", ["default"]))
        self.assertEqual(
            [(self.user.pk, first.job_id), (self.user.pk, second.job_id)], RAN
        )

    def test_a_task_an_old_cluster_still_holds_is_left_to_it(self):
        self._queue(
            signed(
                {"func": legacy_step, "args": (self.user,), "kwargs": {"job_id": "x"}}
            ),
            lock=timezone.now() + datetime.timedelta(minutes=5),
        )

        self.assertEqual(0, legacy_import.import_waiting_tasks())
        self.assertEqual(1, self._left())
        self.assertFalse(QueuedTask.objects.exists())

    def test_an_unreadable_task_is_dropped_and_its_waiting_job_failed(self):
        waiting = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_SCAN_FACES
        )
        gone = signed(
            {"func": legacy_step, "args": (), "kwargs": {"job_id": waiting.job_id}},
            swap=(
                b"api.tests.jobs.test_legacy_task_import\nlegacy_step",
                b"api.gone_module\nlegacy_step",
            ),
        )
        self._queue(gone)
        self._queue(signed({"func": legacy_step}, key="another-secret"))

        with self.assertLogs("api.jobs.legacy_import", "WARNING"):
            self.assertEqual(0, legacy_import.import_waiting_tasks())

        self.assertEqual(0, self._left())
        self.assertFalse(QueuedTask.objects.exists())
        waiting.refresh_from_db()
        self.assertTrue(waiting.failed)
        self.assertIn("could not be carried over", waiting.result["error"])

    def test_nothing_runs_twice_when_imported_again(self):
        job = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_SCAN_FACES
        )
        self._queue(
            signed(
                {
                    "func": legacy_step,
                    "args": (self.user,),
                    "kwargs": {"job_id": job.job_id},
                }
            )
        )

        legacy_import.import_waiting_tasks()
        legacy_import.import_waiting_tasks()

        self.assertEqual(1, QueuedTask.objects.count())
