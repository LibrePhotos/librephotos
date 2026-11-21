import datetime
import uuid
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.utils import timezone

from api.jobs import payload, scheduler, store
from api.jobs.queue import (
    JobStep,
    enqueue_chain,
    enqueue_job,
    enqueue_task,
    ensure_schedule,
    held_job_ids,
    remove_queued_tasks,
    replace_schedule,
    schedule_once,
    schedule_once_by,
)
from api.jobs.release_guard import ReleaseGuard
from api.jobs.worker import Worker, WorkerStoppingError, run_task
from api.jobs.worker_settings import WorkerSettings
from api.models import LongRunningJob, QueuedTask, TaskGroup, TaskSchedule, User
from api.models.task_queue import CANCELLED, FAILED, QUEUED, RUNNING, WAITING
from api.tests.utils import create_test_job, create_test_user

CALLS: list[tuple[object, ...]] = []


def record(*args: object, **kwargs: object) -> None:
    CALLS.append((args, kwargs))


def explode() -> None:
    raise ValueError("boom")


def stop_here() -> None:
    raise WorkerStoppingError("memory: 900 MB")


def job_task(user: User, job_id: str) -> None:
    CALLS.append((user.pk, job_id))


def per_photo(photo_id: str, job_id: str) -> None:
    CALLS.append((photo_id, job_id))


def cancel_my_job(job_id: str) -> None:
    LongRunningJob.objects.get(job_id=job_id).cancel()


class Never:
    def is_set(self) -> bool:
        return False


def _worker(slot: int = 0, width: int = 4) -> Worker:
    return Worker(slot, Never(), [width, width], WorkerSettings())


def _run_next() -> QueuedTask | None:
    task = store.claim("test", ["default", "heavy"])
    if task is not None:
        run_task(task)
    return task


class PayloadTest(TestCase):
    def test_round_trip(self):
        user = create_test_user()
        moment = timezone.now()
        value = [
            user,
            (1, "a"),
            {"when": moment, "day": moment.date()},
            uuid.UUID(int=5),
            None,
            2.5,
        ]

        decoded = payload.decode(payload.encode(value))

        self.assertEqual(user.pk, decoded[0].pk)
        self.assertEqual((1, "a"), decoded[1])
        self.assertEqual({"when": moment, "day": moment.date()}, decoded[2])
        self.assertEqual([uuid.UUID(int=5), None, 2.5], decoded[3:])

    def test_refuses_what_it_cannot_store(self):
        for value in (object(), {1: "a"}, {"__model__": "x"}, User(username="unsaved")):
            with self.subTest(value=value), self.assertRaises(TypeError):
                payload.encode(value)

    def test_a_deleted_instance_is_a_missing_argument(self):
        user = create_test_user()
        encoded = payload.encode(user)
        user.delete()

        with self.assertRaises(payload.MissingArgumentError):
            payload.decode(encoded)

    def test_enqueue_refuses_an_unstorable_argument_at_once(self):
        with self.assertRaises(TypeError):
            enqueue_task(record, object())
        self.assertFalse(QueuedTask.objects.exists())


class ClaimTest(TestCase):
    def setUp(self):
        CALLS.clear()

    def test_priority_then_order_and_not_before_run_after(self):
        store.add(
            record,
            ("late",),
            None,
            store.Placement(run_after=timezone.now() + datetime.timedelta(hours=1)),
        )
        store.add(record, ("first",))
        store.add(record, ("urgent",), None, store.Placement(priority=1))
        store.add(record, ("second",))

        order = [store.claim("w", ["default"]).args for _ in range(3)]

        self.assertEqual([["urgent"], ["first"], ["second"]], order)
        self.assertIsNone(store.claim("w", ["default"]))

    def test_a_claimed_task_is_leased_and_counted(self):
        store.add(record)

        task = store.claim("w", ["default"])

        self.assertEqual((RUNNING, "w", 1), (task.status, task.worker, task.attempts))
        self.assertGreater(
            task.lease_until, timezone.now() + datetime.timedelta(minutes=9)
        )

    def test_a_capped_queue_is_skipped_while_full(self):
        store.add(record, ("a",), None, store.Placement(queue="heavy"))
        store.add(record, ("b",), None, store.Placement(queue="heavy"))
        store.add(record, ("c",))

        first = store.claim("w", ["heavy", "default"], {"heavy": 1})
        second = store.claim("w", ["heavy", "default"], {"heavy": 1})

        self.assertEqual(["a"], first.args)
        self.assertEqual(["c"], second.args)
        self.assertIsNone(store.claim("w", ["heavy"], {"heavy": 1}))

    def test_a_worker_above_the_width_takes_nothing(self):
        store.add(record)

        self.assertFalse(_worker(slot=2, width=2).run_one())
        self.assertTrue(_worker(slot=1, width=2).run_one())


class RunTest(TestCase):
    def setUp(self):
        CALLS.clear()

    def test_success_deletes_the_row_and_decodes_arguments(self):
        user = create_test_user()
        enqueue_task(record, user, key=(1, 2))

        _run_next()

        self.assertEqual(user.pk, CALLS[0][0][0].pk)
        self.assertEqual({"key": (1, 2)}, CALLS[0][1])
        self.assertFalse(QueuedTask.objects.exists())

    def test_an_exception_fails_the_task_without_a_retry(self):
        enqueue_task(explode)

        _run_next()

        task = QueuedTask.objects.get()
        self.assertEqual(FAILED, task.status)
        self.assertIn("ValueError: boom", task.error)

    def test_a_function_that_is_gone_fails_at_once(self):
        store.add("api.gone.module.function")

        with self.assertLogs("api.jobs.worker", "WARNING"):
            _run_next()

        task = QueuedTask.objects.get()
        self.assertEqual(FAILED, task.status)
        self.assertIn("no longer exists", task.error)

    def test_an_argument_that_cannot_be_loaded_fails_only_its_task(self):
        enqueue_task(record, uuid.UUID(int=1))
        QueuedTask.objects.update(args=[{"__uuid__": "not-a-uuid"}])

        with self.assertLogs("api.jobs.worker", "ERROR"):
            _run_next()

        self.assertEqual(FAILED, QueuedTask.objects.get().status)
        self.assertEqual([], CALLS)

    def test_a_stopping_worker_puts_the_task_back_without_an_attempt(self):
        enqueue_task(stop_here)
        worker = _worker()

        self.assertTrue(worker.run_one())

        task = QueuedTask.objects.get()
        self.assertEqual((QUEUED, 0), (task.status, task.attempts))
        self.assertEqual("memory: 900 MB", worker.running.drain)


class LeaseTest(TestCase):
    def test_an_expired_lease_is_queued_again_until_the_last_attempt(self):
        store.add(record)
        for attempt in range(1, 4):
            task = store.claim("w", ["default"])
            QueuedTask.objects.filter(pk=task.pk).update(
                lease_until=timezone.now() - datetime.timedelta(seconds=1)
            )

            self.assertEqual(1, store.requeue_expired())
            expected = FAILED if attempt == 3 else QUEUED
            self.assertEqual(expected, QueuedTask.objects.get().status)
            QueuedTask.objects.filter(pk=task.pk).update(run_after=timezone.now())

    def test_renewal_extends_only_the_holders_lease(self):
        store.add(record)
        task = store.claim("w", ["default"])
        QueuedTask.objects.filter(pk=task.pk).update(lease_until=timezone.now())

        self.assertFalse(store.renew(task.pk, "someone else"))
        self.assertTrue(store.renew(task.pk, "w"))
        self.assertGreater(
            QueuedTask.objects.get().lease_until,
            timezone.now() + datetime.timedelta(minutes=9),
        )

    def test_the_tasks_of_a_dead_worker_are_queued_at_once(self):
        store.add(record)
        store.claim("host:0:123", ["default"])

        self.assertEqual(1, store.requeue_worker("host:0:123", "its worker exited"))
        self.assertEqual(QUEUED, QueuedTask.objects.get().status)


class ChainTest(TestCase):
    def setUp(self):
        CALLS.clear()
        self.user = create_test_user()

    def _two_steps(self, first=job_task, **options):
        return enqueue_chain(
            self.user,
            [
                JobStep(
                    LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS, first, (self.user,)
                ),
                JobStep(LongRunningJob.JOB_CLUSTER_ALL_FACES, job_task, (self.user,)),
            ],
            **options,
        )

    def test_rows_and_tasks_are_written_together(self):
        first, second = self._two_steps()

        statuses = dict(QueuedTask.objects.values_list("job_id", "status"))
        self.assertEqual({first.job_id: QUEUED, second.job_id: WAITING}, statuses)
        self.assertEqual({first.job_id, second.job_id}, held_job_ids())

    def test_the_next_step_runs_after_the_first(self):
        first, second = self._two_steps()

        _run_next()
        _run_next()

        self.assertEqual(
            [(self.user.pk, first.job_id), (self.user.pk, second.job_id)], CALLS
        )

    def test_a_cancelled_step_cancels_the_rest(self):
        first, second = self._two_steps(first=cancel_my_job_step)

        _run_next()

        second.refresh_from_db()
        self.assertTrue(second.cancelled)
        self.assertEqual(CANCELLED, QueuedTask.objects.get(job_id=second.job_id).status)
        self.assertIsNone(store.claim("w", ["default"]))

    def test_a_failed_step_cancels_the_rest_unless_asked(self):
        self._two_steps(first=explode_step)
        _run_next()
        self.assertEqual(
            {FAILED, CANCELLED},
            set(QueuedTask.objects.values_list("status", flat=True)),
        )

        QueuedTask.objects.all().delete()
        first, second = self._two_steps(
            first=explode_step, continue_on_error=True, exclusive=False
        )
        _run_next()
        self.assertEqual(QUEUED, QueuedTask.objects.get(job_id=second.job_id).status)

    def test_cancel_drops_the_queued_tasks_without_reading_them(self):
        job = enqueue_job(self.user, LongRunningJob.JOB_SCAN_FACES, job_task, self.user)
        store.add(per_photo, ("p1", job.job_id))
        other = store.add(per_photo, ("p2", "another-job"))
        QueuedTask.objects.filter(job_id=job.job_id).update(
            args=["not", {"__model__": "gone.model", "pk": 1}]
        )

        self.assertEqual(2, remove_queued_tasks(job.job_id))
        self.assertEqual(QUEUED, QueuedTask.objects.get(pk=other.pk).status)


def cancel_my_job_step(user: User, job_id: str) -> None:
    cancel_my_job(job_id)


def explode_step(user: User, job_id: str) -> None:
    explode()


class GroupTest(TestCase):
    def setUp(self):
        CALLS.clear()

    def test_the_follow_up_runs_once_after_every_member_ended(self):
        job = create_test_job(
            started_by=create_test_user(), job_type=LongRunningJob.JOB_SCAN_FACES
        )
        group = store.new_group(3)
        store.add(record, ("ok",), None, store.Placement(group=group))
        store.add(explode, (), None, store.Placement(group=group))
        store.add(per_photo, ("p", job.job_id), None, store.Placement(group=group))
        store.add(
            record,
            ("then",),
            None,
            store.Placement(group=group, status=WAITING, is_group_followup=True),
        )

        remove_queued_tasks(job.job_id)
        _run_next()
        self.assertEqual(WAITING, QueuedTask.objects.get(is_group_followup=True).status)
        _run_next()
        _run_next()

        self.assertEqual([(("ok",), {}), (("then",), {})], CALLS)
        self.assertTrue(TaskGroup.objects.get().fired)
        self.assertEqual(3, TaskGroup.objects.get().ended)


class DedupeTest(TestCase):
    def test_one_open_task_per_key(self):
        first = store.add(
            record, (), None, store.Placement(dedupe_key="faces:cluster:1")
        )
        self.assertIsNone(
            store.add(record, (), None, store.Placement(dedupe_key="faces:cluster:1"))
        )

        store.claim("w", ["default"])
        self.assertIsNone(
            store.add(record, (), None, store.Placement(dedupe_key="faces:cluster:1"))
        )

        store.fail(QueuedTask.objects.get(pk=first.pk), "done")
        self.assertIsNotNone(
            store.add(record, (), None, store.Placement(dedupe_key="faces:cluster:1"))
        )


class SchedulerTest(TestCase):
    def test_a_missed_minutely_schedule_runs_once_and_moves_past_now(self):
        ensure_schedule(
            "api.tests.jobs.test_task_queue_store.record",
            schedule_type=TaskSchedule.MINUTES,
            minutes=1,
        )
        schedule = TaskSchedule.objects.get()
        now = schedule.next_run + datetime.timedelta(hours=1, seconds=30)

        self.assertEqual(1, scheduler.run_due(now))
        self.assertEqual(0, scheduler.run_due(now))

        self.assertEqual(1, QueuedTask.objects.count())
        self.assertEqual(
            schedule.next_run + datetime.timedelta(minutes=61),
            TaskSchedule.objects.get().next_run,
        )

    def test_runs_missed_while_no_worker_took_the_last_one_do_not_pile_up(self):
        ensure_schedule(
            "api.tests.jobs.test_task_queue_store.record",
            schedule_type=TaskSchedule.MINUTES,
            minutes=1,
        )
        start = TaskSchedule.objects.get().next_run

        for minute in range(1, 4):
            scheduler.run_due(start + datetime.timedelta(minutes=minute, seconds=1))

        self.assertEqual(1, QueuedTask.objects.count())

    def test_a_once_schedule_is_deleted_and_gets_its_arguments(self):
        schedule_once(
            "api.tests.jobs.test_task_queue_store.record", 7, "x", at=timezone.now()
        )

        scheduler.run_due(timezone.now() + datetime.timedelta(seconds=1))

        self.assertFalse(TaskSchedule.objects.exists())
        self.assertEqual([7, "x"], QueuedTask.objects.get().args)

    def test_the_intended_date_is_passed(self):
        due = timezone.now() - datetime.timedelta(minutes=5)
        replace_schedule(
            "api.tests.jobs.test_task_queue_store.record",
            name="Library scan: every day at 03:00",
            schedule_type=TaskSchedule.DAILY,
            next_run=due,
            intended_date_kwarg="intended_at",
        )

        scheduler.run_due()

        self.assertEqual(
            {"intended_at": due.isoformat()}, QueuedTask.objects.get().kwargs
        )
        self.assertEqual(
            due + datetime.timedelta(days=1), TaskSchedule.objects.get().next_run
        )

    def test_a_stale_read_fires_nothing(self):
        ensure_schedule(
            "api.tests.jobs.test_task_queue_store.record",
            schedule_type=TaskSchedule.HOURLY,
        )
        stale = TaskSchedule.objects.get()
        now = stale.next_run + datetime.timedelta(seconds=1)

        self.assertTrue(scheduler.fire(stale, now))
        self.assertFalse(scheduler.fire(stale, now))
        self.assertEqual(1, QueuedTask.objects.count())

    def test_schedule_once_by_moves_a_pending_run_earlier_only(self):
        func = "api.tests.jobs.test_task_queue_store.record"
        soon = timezone.now() + datetime.timedelta(minutes=5)
        schedule_once_by("followups:1", func, 1, at=soon)
        schedule_once_by(
            "followups:1", func, 1, at=soon + datetime.timedelta(minutes=5)
        )
        schedule_once_by(
            "followups:1", func, 1, at=soon - datetime.timedelta(minutes=4)
        )

        self.assertEqual(
            [soon - datetime.timedelta(minutes=4)],
            list(TaskSchedule.objects.values_list("next_run", flat=True)),
        )


class ReleaseGuardTest(TestCase):
    def test_a_migration_this_code_lacks_stops_the_claims(self):
        guard = ReleaseGuard()
        self.assertFalse(guard.database_is_newer())
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO django_migrations (app, name, applied) VALUES (%s, %s, %s)",
                ["api", "9999_from_a_newer_release", timezone.now()],
            )

        with self.assertLogs("api.jobs.release_guard", "WARNING"):
            self.assertTrue(guard.database_is_newer())
        store.add(record)
        with patch.object(Worker, "_register"):
            worker = _worker()
            worker.guard = guard
            self.assertFalse(worker.run_one())
        self.assertEqual(QUEUED, QueuedTask.objects.get().status)
