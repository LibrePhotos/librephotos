import os
from datetime import datetime, timedelta
from multiprocessing import Event, Value
from unittest import mock

import django
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from django.utils.timezone import is_naive

from django_q.brokers import Broker, get_broker
from django_q.conf import Conf
from django_q.monitor import monitor
from django_q.pusher import pusher
from django_q.queues import Queue
from django_q.scheduler import scheduler
from django_q.tasks import Schedule, fetch
from django_q.tasks import schedule as create_schedule
from django_q.tests.settings import BASE_DIR
from django_q.tests.testing_utilities.multiple_database_routers import (
    TestingMultipleAppsDatabaseRouter,
    TestingReplicaDatabaseRouter,
)
from django_q.utils import add_months, localtime
from django_q.worker import worker

if django.VERSION < (4, 0):
    # pytz is the default in django 3.2. Remove when no support for 3.2
    from pytz import timezone as ZoneInfo
else:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo


@pytest.fixture
def broker(monkeypatch) -> Broker:
    """
    Patches the Conf object setting the DJANGO_REDIS attribute allowing a default
    redis configuration.
    """
    monkeypatch.setattr(Conf, "DJANGO_REDIS", "default")
    return get_broker()


@pytest.fixture
def orm_broker(monkeypatch) -> None:
    """Patches the Conf object setting the ORM attribute to a database named default."""
    monkeypatch.setattr(Conf, "ORM", "default")


REPLICA_DATABASE_ROUTERS = [
    f"{TestingReplicaDatabaseRouter.__module__}.{TestingReplicaDatabaseRouter.__name__}"
]
REPLICA_DATABASES = {
    "writable": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.path.join(BASE_DIR, "db.sqlite3"),
    },
    "replica": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.path.join(BASE_DIR, "db.sqlite3"),
    },
}

MULTIPLE_APPS_DATABASE_ROUTERS = [
    f"{TestingMultipleAppsDatabaseRouter.__module__}.{TestingMultipleAppsDatabaseRouter.__name__}"  # noqa: E501
]
MULTIPLE_APPS_DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.path.join(BASE_DIR, "db.sqlite3"),
    },
    "admin": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.path.join(BASE_DIR, "db.sqlite3"),
    },
}


@pytest.mark.django_db
def test_scheduler_daylight_saving_time_daily(broker, monkeypatch):
    # Set up a startdate in the Amsterdam timezone (without dst 1 hour ahead). The
    # 28th of March 2021 is the day when sunlight saving starts (at 2 am)

    monkeypatch.setattr(Conf, "TIME_ZONE", "Europe/Amsterdam")
    tz = ZoneInfo("Europe/Amsterdam")
    broker.list_key = "scheduler_test:q"
    # Let's start a schedule at 1 am on the 27th of March. This is in AMS timezone.
    # So, 2021-03-27 00:00:00 when saved (due to TZ being Amsterdam and saved in UTC)
    start_date = datetime(2021, 3, 27, 1, 0, 0)

    # Create schedule with the next run date on the start date. It will move one day
    # forward when we run the scheduler
    schedule = create_schedule(
        "math.copysign",
        1,
        -1,
        name="test math",
        schedule_type=Schedule.DAILY,
        next_run=start_date,
    )

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    # It's now the day after exactly at midnight UTC
    next_run = schedule.next_run
    assert str(next_run) == "2021-03-28 00:00:00+00:00"

    # In the Amsterdam timezone, it's 1 hour over midnight (+01)
    next_run = next_run.astimezone(tz)
    assert str(next_run) == "2021-03-28 01:00:00+01:00"

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    next_run = schedule.next_run

    assert str(next_run) == "2021-03-28 23:00:00+00:00"
    next_run = next_run.astimezone(tz)
    # In the Amsterdam timezone, it's 1 hour over midnight (+02)
    assert str(next_run) == "2021-03-29 01:00:00+02:00"

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    next_run = schedule.next_run

    assert str(next_run) == "2021-03-29 23:00:00+00:00"
    next_run = next_run.astimezone(tz)
    assert str(next_run) == "2021-03-30 01:00:00+02:00"

    # Create second schedule with the next run date on the start date. It will move
    # one day forward when we run the scheduler
    start_date = datetime(2021, 10, 29, 1, 0, 0)
    schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        name="multiply",
        schedule_type=Schedule.DAILY,
        next_run=start_date,
    )

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    next_run = schedule.next_run

    assert str(next_run) == "2021-10-29 23:00:00+00:00"
    # In the Amsterdam timezone, it's 1 hour over midnight (+02)
    next_run = next_run.astimezone(tz)
    assert str(next_run) == "2021-10-30 01:00:00+02:00"

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    next_run = schedule.next_run

    assert str(next_run) == "2021-10-30 23:00:00+00:00"
    # In the Amsterdam timezone, it's 1 hour over midnight (+02)
    next_run = next_run.astimezone(tz)
    assert str(next_run) == "2021-10-31 01:00:00+02:00"

    # Run scheduler so we get the next run date
    scheduler(broker=broker)
    schedule.refresh_from_db()

    next_run = schedule.next_run

    assert str(next_run) == "2021-11-01 00:00:00+00:00"
    # In the Amsterdam timezone, it's 1 hour over midnight (+01)
    # Switch of DST
    next_run = next_run.astimezone(tz)
    assert str(next_run) == "2021-11-01 01:00:00+01:00"


@pytest.mark.django_db
def test_scheduler(broker, monkeypatch):
    broker.list_key = "scheduler_test:q"
    broker.delete_queue()
    schedule = create_schedule(
        "math.copysign",
        1,
        -1,
        name="test math",
        hook="django_q.tests.tasks.result",
        schedule_type=Schedule.HOURLY,
        repeats=1,
    )
    assert schedule.last_run() is None
    # check duplicate constraint
    with pytest.raises(IntegrityError):
        schedule = create_schedule(
            "math.copysign",
            1,
            -1,
            name="test math",
            hook="django_q.tests.tasks.result",
            schedule_type=Schedule.HOURLY,
            repeats=1,
        )
    # run scheduler
    scheduler(broker=broker)
    # set up the workflow
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    # push it
    pusher(task_queue, stop_event, broker=broker)
    assert task_queue.qsize() == 1
    assert broker.queue_size() == 0
    task_queue.put("STOP")
    # let a worker handle them
    result_queue = Queue()
    worker(task_queue, result_queue, Value("b", -1))
    assert result_queue.qsize() == 1
    result_queue.put("STOP")
    # store the results
    monitor(result_queue)
    assert result_queue.qsize() == 0
    schedule = Schedule.objects.get(pk=schedule.pk)
    assert schedule.repeats == 0
    assert schedule.last_run() is not None
    assert schedule.success() is True
    assert schedule.next_run < timezone.now() + timedelta(hours=1)
    task = fetch(schedule.task)
    assert task is not None
    assert task.success is True
    assert task.result < 0
    # Once schedule with delete
    once_schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="django",
        schedule_type=Schedule.ONCE,
        repeats=-1,
        hook="django_q.tests.tasks.result",
    )
    assert hasattr(once_schedule, "pk") is True
    # negative repeats
    always_schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="django",
        schedule_type=Schedule.DAILY,
        repeats=-1,
        hook="django_q.tests.tasks.result",
    )
    assert hasattr(always_schedule, "pk") is True
    # Minute schedule
    minute_schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="django",
        schedule_type=Schedule.MINUTES,
        minutes=10,
    )
    assert hasattr(minute_schedule, "pk") is True
    # Cron schedule
    cron_schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="django",
        schedule_type=Schedule.CRON,
        cron="0 22 * * 1-5",
    )
    assert hasattr(cron_schedule, "pk") is True
    assert cron_schedule.full_clean() is None
    assert cron_schedule.__str__() == "django_q.tests.tasks.word_multiply"
    with pytest.raises(ValidationError):
        create_schedule(
            "django_q.tests.tasks.word_multiply",
            2,
            word="django",
            schedule_type=Schedule.CRON,
            cron="0 22 * * 1-12",
        )
    # All other types
    for t in Schedule.TYPE:
        if t[0] == Schedule.CRON:
            continue
        schedule = create_schedule(
            "django_q.tests.tasks.word_multiply",
            2,
            word="django",
            schedule_type=t[0],
            repeats=1,
            hook="django_q.tests.tasks.result",
        )
        assert schedule is not None
        assert schedule.last_run() is None
        scheduler(broker=broker)
    # via model
    Schedule.objects.create(
        func="django_q.tests.tasks.word_multiply",
        args="2",
        kwargs='word="django"',
        schedule_type=Schedule.DAILY,
    )
    # scheduler
    scheduler(broker=broker)
    # ONCE schedule should be deleted
    assert Schedule.objects.filter(pk=once_schedule.pk).exists() is False
    # Catch up On
    monkeypatch.setattr(Conf, "CATCH_UP", True)
    now = timezone.now()
    schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="catch_up",
        schedule_type=Schedule.HOURLY,
        next_run=timezone.now() - timedelta(hours=12),
        repeats=-1,
    )
    scheduler(broker=broker)
    schedule = Schedule.objects.get(pk=schedule.pk)
    assert schedule.next_run < now
    # Catch up off
    monkeypatch.setattr(Conf, "CATCH_UP", False)
    scheduler(broker=broker)
    schedule = Schedule.objects.get(pk=schedule.pk)
    assert schedule.next_run > now
    # Done
    broker.delete_queue()

    # test bimonthly
    schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="catch_up",
        schedule_type=Schedule.BIMONTHLY,
    )
    scheduler(broker=broker)
    schedule = Schedule.objects.get(pk=schedule.pk)
    assert schedule.next_run.date() == add_months(timezone.now(), 2).date()

    # test biweekly
    schedule = create_schedule(
        "django_q.tests.tasks.word_multiply",
        2,
        word="catch_up",
        schedule_type=Schedule.BIWEEKLY,
    )
    scheduler(broker=broker)
    schedule = Schedule.objects.get(pk=schedule.pk)
    assert schedule.next_run.date() == (timezone.now() + timedelta(weeks=2)).date()
    broker.delete_queue()

    monkeypatch.setattr(Conf, "CLUSTER_NAME", "some_cluster_name")
    # create a schedule on another cluster
    schedule = create_schedule(
        "math.copysign",
        1,
        -1,
        name="test schedule on a another cluster",
        hook="django_q.tests.tasks.result",
        schedule_type=Schedule.HOURLY,
        cluster="some_other_cluster_name",
        repeats=1,
    )
    # run scheduler
    scheduler(broker=broker)
    # set up the workflow
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    # push it
    pusher(task_queue, stop_event, broker=broker)

    # queue must be empty
    assert task_queue.qsize() == 0

    monkeypatch.setattr(Conf, "CLUSTER_NAME", "default")
    # create a schedule on the same cluster
    schedule = create_schedule(
        "math.copysign",
        1,
        -1,
        name="test schedule with no cluster",
        hook="django_q.tests.tasks.result",
        schedule_type=Schedule.HOURLY,
        cluster="default",
        repeats=1,
    )
    # run scheduler
    scheduler(broker=broker)
    # set up the workflow
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    # push it
    pusher(task_queue, stop_event, broker=broker)

    # queue must contain a task
    assert task_queue.qsize() == 1


@pytest.mark.django_db
def test_intended_schedule_kwarg(broker, monkeypatch):
    broker.list_key = "scheduler_test:q"
    broker.delete_queue()
    run_date = timezone.now() - timedelta(hours=1)
    schedule = create_schedule(
        "math.copysign",
        1,
        -1,
        name="test math",
        hook="django_q.tests.tasks.result",
        schedule_type=Schedule.HOURLY,
        repeats=1,
        next_run=run_date,
        intended_date_kwarg="intended_date",
    )
    assert schedule.last_run() is None
    assert schedule.intended_date_kwarg == "intended_date"
    # run scheduler
    scheduler(broker=broker)
    # set up the workflow
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    # push it
    pusher(task_queue, stop_event, broker=broker)
    assert task_queue.qsize() == 1
    task = task_queue.get()
    assert "intended_date" in task["kwargs"]
    assert task["kwargs"]["intended_date"] == run_date.isoformat()


@override_settings(
    DATABASE_ROUTERS=REPLICA_DATABASE_ROUTERS, DATABASES=REPLICA_DATABASES
)
@pytest.mark.django_db
def test_scheduler_atomic_must_specify_the_write_db(
    orm_broker: Broker,
):
    """
    GIVEN a environment with a read/write configured replica database
    WHEN the scheduler is called
    THEN the transaction must be called with the write database.
    """
    broker = get_broker(list_key="scheduler_test:q")
    with mock.patch("django_q.cluster.db.transaction") as mocked_db:
        scheduler(broker=broker)
        mocked_db.atomic.assert_called_with(using="writable")


@override_settings(
    DATABASE_ROUTERS=MULTIPLE_APPS_DATABASE_ROUTERS, DATABASES=MULTIPLE_APPS_DATABASES
)
@pytest.mark.django_db
def test_scheduler_atomic_must_specify_the_database_based_on_router_redirection(
    orm_broker: Broker,
):
    """
    GIVEN a environment without a read replica database
    WHEN the scheduler is called
    THEN the transaction atomic must be called using the default connection.
    """
    broker = get_broker(list_key="scheduler_test:q")
    with mock.patch("django_q.cluster.db.transaction") as mocked_db:
        scheduler(broker=broker)
        mocked_db.atomic.assert_called_with(using="default")


@pytest.mark.django_db
def test_schedule_save_sets_next_run_for_cron():
    """Ensure Schedule.save() sets next_run correctly for CRON schedules."""
    cron_expression = "0 12 * * *"  # Executes dialy at 12pm
    schedule = Schedule(
        func="math.sqrt",
        schedule_type=Schedule.CRON,
        cron=cron_expression,
    )

    assert schedule.next_run is not None
    assert schedule.pk is None

    initial_next_run = schedule.next_run
    schedule.save()

    # After save, next_run must be recalculated based on the CRON expression
    assert schedule.next_run > initial_next_run


@pytest.mark.django_db
def test_schedule_save_direct_db(broker):
    """Ensure Schedule.save() updates next_run correctly when created directly in DB."""
    cron_expression = "0 12 * * *"  # Executes dialy at 12pm

    # Creating schedule directly in database
    schedule = Schedule.objects.create(
        func="math.sqrt",
        schedule_type=Schedule.CRON,
        cron=cron_expression,
    )

    # Next run must be defined after execution time
    assert schedule.next_run is not None
    assert schedule.next_run > timezone.now()

    scheduler(broker)

    assert broker.queue_size() == 0


def test_localtime():
    assert not is_naive(localtime())


@override_settings(USE_TZ=False)
def test_naive_localtime():
    assert is_naive(localtime())
