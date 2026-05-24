import os
import sys
import threading
import uuid as uuidlib
from datetime import datetime
from math import copysign
from multiprocessing import Event, Value
from time import sleep
from typing import Optional

import pytest
from django.utils import timezone

from django_q.brokers import Broker, get_broker
from django_q.cluster import Cluster, Sentinel
from django_q.conf import Conf
from django_q.humanhash import DEFAULT_WORDLIST, uuid
from django_q.models import Success, Task
from django_q.monitor import monitor, save_task
from django_q.pusher import pusher
from django_q.queues import Queue
from django_q.signals import (
    post_execute,
    post_execute_in_worker,
    pre_enqueue,
    pre_execute,
)
from django_q.status import Stat
from django_q.tasks import (
    async_task,
    count_group,
    delete_group,
    fetch,
    fetch_group,
    queue_size,
    result,
    result_group,
)
from django_q.tests.tasks import TaskError, multiply
from django_q.utils import add_months, add_years
from django_q.worker import worker

myPath = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, myPath + "/../")


class WordClass:
    def __init__(self):
        self.word_list = DEFAULT_WORDLIST

    def get_words(self):
        return self.word_list


@pytest.fixture
def broker(monkeypatch):
    monkeypatch.setattr(Conf, "DJANGO_REDIS", "default")
    return get_broker()


def test_redis_connection(broker):
    assert broker.ping() is True


@pytest.mark.django_db
def test_sync(broker):
    task = async_task(
        "django_q.tests.tasks.count_letters", DEFAULT_WORDLIST, broker=broker, sync=True
    )
    assert result(task) == 1506


@pytest.mark.django_db
def test_sync_raise_exception(broker):
    with pytest.raises(TaskError):
        async_task("django_q.tests.tasks.raise_exception", broker=broker, sync=True)


@pytest.mark.django_db
def test_cluster_initial(broker):
    broker.list_key = "initial_test:q"
    broker.delete_queue()
    c = Cluster(broker=broker)
    assert c.sentinel is None
    assert c.stat.status == Conf.STOPPED
    assert c.start() > 0
    assert c.sentinel.is_alive() is True
    assert c.is_running
    assert c.is_stopping is False
    assert c.is_starting is False
    sleep(0.5)
    stat = c.stat
    assert stat.status == Conf.IDLE
    assert c.stop() is True
    assert c.sentinel.is_alive() is False
    assert c.has_stopped
    assert c.stop() is False
    broker.delete_queue()


@pytest.mark.django_db
def test_sentinel():
    start_event = Event()
    stop_event = Event()
    stop_event.set()
    cluster_id = uuidlib.uuid4()
    s = Sentinel(
        stop_event,
        start_event,
        cluster_id=cluster_id,
        broker=get_broker("sentinel_test:q"),
    )
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED


@pytest.mark.django_db
def test_cluster(broker):
    broker.list_key = "cluster_test:q"
    broker.delete_queue()
    task = async_task(
        "django_q.tests.tasks.count_letters", DEFAULT_WORDLIST, broker=broker
    )
    assert broker.queue_size() == 1
    task_queue = Queue()
    assert task_queue.qsize() == 0
    result_queue = Queue()
    assert result_queue.qsize() == 0
    event = Event()
    event.set()
    # Test push
    pusher(task_queue, event, broker=broker)
    assert task_queue.qsize() == 1
    assert queue_size(broker=broker) == 0
    # Test work
    task_queue.put("STOP")
    worker(task_queue, result_queue, Value("f", -1))
    assert task_queue.qsize() == 0
    assert result_queue.qsize() == 1
    # Test monitor
    result_queue.put("STOP")
    monitor(result_queue)
    assert result_queue.qsize() == 0
    # check result
    assert result(task) == 1506
    broker.delete_queue()


@pytest.mark.django_db
def test_results(broker):
    broker.list_key = "cluster_test:q"
    broker.delete_queue()
    a = async_task(
        "django_q.tests.tasks.return_falsy_value",
        broker=broker,
    )

    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    pusher(task_queue, stop_event, broker=broker)
    task_queue.put("STOP")
    result_queue = Queue()
    worker(task_queue, result_queue, Value("f", -1))
    result_queue.put("STOP")
    monitor(result_queue)

    # should not loop indefinitely when a real value is returned
    value = result(a, wait=-1)
    assert value == []


@pytest.mark.django_db
def test_enqueue(broker, admin_user):
    broker.list_key = "cluster_test:q"
    broker.delete_queue()
    a = async_task(
        "django_q.tests.tasks.count_letters",
        DEFAULT_WORDLIST,
        hook="django_q.tests.test_cluster.assert_result",
        broker=broker,
    )
    b = async_task(
        "django_q.tests.tasks.count_letters2",
        WordClass(),
        hook="django_q.tests.test_cluster.assert_result",
        broker=broker,
    )
    # unknown argument
    c = async_task(
        "django_q.tests.tasks.count_letters",
        DEFAULT_WORDLIST,
        "oneargumentoomany",
        hook="django_q.tests.test_cluster.assert_bad_result",
        broker=broker,
    )
    # unknown function
    d = async_task(
        "django_q.tests.tasks.does_not_exist",
        WordClass(),
        hook="django_q.tests.test_cluster.assert_bad_result",
        broker=broker,
    )
    # function without result
    e = async_task("django_q.tests.tasks.countdown", 100000, broker=broker)
    # function as instance
    f = async_task(multiply, 753, 2, hook=assert_result, broker=broker)
    # model as argument
    g = async_task(
        "django_q.tests.tasks.get_task_name", Task(name="John"), broker=broker
    )
    # args,kwargs, group and broken hook
    h = async_task(
        "django_q.tests.tasks.word_multiply",
        2,
        word="django",
        hook="fail.me",
        broker=broker,
    )
    # args unpickle test
    j = async_task(
        "django_q.tests.tasks.get_user_id", admin_user, broker=broker, group="test_j"
    )
    # q_options and save opt_out test
    k = async_task(
        "django_q.tests.tasks.get_user_id",
        admin_user,
        q_options={"broker": broker, "group": "test_k", "save": False, "timeout": 90},
    )
    # test unicode
    assert Task(name="Amalia").__str__() == "Amalia"
    # check if everything has a task id
    assert isinstance(a, str)
    assert isinstance(b, str)
    assert isinstance(c, str)
    assert isinstance(d, str)
    assert isinstance(e, str)
    assert isinstance(f, str)
    assert isinstance(g, str)
    assert isinstance(h, str)
    assert isinstance(j, str)
    assert isinstance(k, str)
    # run the cluster to execute the tasks
    task_count = 10
    assert broker.queue_size() == task_count
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    # push the tasks
    for _ in range(task_count):
        pusher(task_queue, stop_event, broker=broker)
    assert broker.queue_size() == 0
    assert task_queue.qsize() == task_count
    task_queue.put("STOP")
    # test wait timeout
    assert result(j, wait=10) is None
    assert fetch(j, wait=10) is None
    assert result_group("test_j", wait=10) is None
    assert result_group("test_j", count=2, wait=10) is None
    assert fetch_group("test_j", wait=10) is None
    assert fetch_group("test_j", count=2, wait=10) is None
    # let a worker handle them
    result_queue = Queue()
    worker(task_queue, result_queue, Value("f", -1))
    assert result_queue.qsize() == task_count
    result_queue.put("STOP")
    # store the results
    monitor(result_queue)
    assert result_queue.qsize() == 0
    # Check the results
    # task a
    result_a = fetch(a)
    assert result_a is not None
    assert result_a.success is True
    assert result(a) == 1506
    # task b
    result_b = fetch(b)
    assert result_b is not None
    assert result_b.success is True
    assert result(b) == 1506
    # task c
    result_c = fetch(c)
    assert result_c is not None
    assert result_c.success is False
    # task d
    result_d = fetch(d)
    assert result_d is not None
    assert result_d.success is False
    # task e
    result_e = fetch(e)
    assert result_e is not None
    assert result_e.success is True
    assert result(e) is None
    # task f
    result_f = fetch(f)
    assert result_f is not None
    assert result_f.success is True
    assert result(f) == 1506
    # task g
    result_g = fetch(g)
    assert result_g is not None
    assert result_g.success is True
    assert result(g) == "John"
    # task h
    result_h = fetch(h)
    assert result_h is not None
    assert result_h.success is True
    assert result(h) == 12
    # task j
    result_j = fetch(j)
    assert result_j is not None
    assert result_j.success is True
    assert result_j.result == result_j.args[0].id
    # check fetch, result by name
    assert fetch(result_j.name) == result_j
    assert result(result_j.name) == result_j.result
    # groups
    assert result_group("test_j")[0] == result_j.result
    assert result_j.group_result()[0] == result_j.result
    assert result_group("test_j", failures=True)[0] == result_j.result
    assert result_j.group_result(failures=True)[0] == result_j.result
    assert fetch_group("test_j")[0].id == [result_j][0].id
    assert fetch_group("test_j", failures=False)[0].id == [result_j][0].id
    assert count_group("test_j") == 1
    assert result_j.group_count() == 1
    assert count_group("test_j", failures=True) == 0
    assert result_j.group_count(failures=True) == 0
    assert delete_group("test_j") == 1
    assert result_j.group_delete() == 0
    deleted_group = delete_group("test_j", tasks=True)
    assert deleted_group is None or deleted_group[0] == 0  # Django 1.9
    deleted_group = result_j.group_delete(tasks=True)
    assert deleted_group is None or deleted_group[0] == 0  # Django 1.9
    # task k should not have been saved
    assert fetch(k) is None
    assert fetch(k, 100) is None
    assert result(k, 100) is None
    broker.delete_queue()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "cluster_config_timeout, async_task_kwargs",
    (
        (1, {}),
        (10, {"timeout": 1}),
        (None, {"timeout": 1}),
    ),
)
def test_timeout(broker, cluster_config_timeout, async_task_kwargs):
    # set up the Sentinel
    broker.list_key = "timeout_test:q"
    broker.purge_queue()
    async_task("time.sleep", 5, broker=broker, **async_task_kwargs)
    start_event = Event()
    stop_event = Event()
    cluster_id = uuidlib.uuid4()
    # Set a timer to stop the Sentinel
    threading.Timer(3, stop_event.set).start()
    s = Sentinel(
        stop_event,
        start_event,
        cluster_id=cluster_id,
        broker=broker,
        timeout=cluster_config_timeout,
    )
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED
    assert s.reincarnations == 1
    broker.delete_queue()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "cluster_config_timeout, async_task_kwargs",
    (
        (5, {}),
        (10, {"timeout": 5}),
        (1, {"timeout": 5}),
        (None, {"timeout": 5}),
    ),
)
def test_timeout_task_finishes(broker, cluster_config_timeout, async_task_kwargs):
    # set up the Sentinel
    broker.list_key = "timeout_test:q"
    broker.purge_queue()
    async_task("time.sleep", 3, broker=broker, **async_task_kwargs)
    start_event = Event()
    stop_event = Event()
    cluster_id = uuidlib.uuid4()
    # Set a timer to stop the Sentinel
    threading.Timer(6, stop_event.set).start()
    s = Sentinel(
        stop_event,
        start_event,
        cluster_id=cluster_id,
        broker=broker,
        timeout=cluster_config_timeout,
    )
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED
    assert s.reincarnations == 0
    broker.delete_queue()


@pytest.mark.django_db
def test_recycle(broker, monkeypatch, django_assert_num_queries):
    # set up the Sentinel
    broker.list_key = "test_recycle_test:q"
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    start_event = Event()
    stop_event = Event()
    cluster_id = uuidlib.uuid4()
    # override settings
    monkeypatch.setattr(Conf, "RECYCLE", 2)
    monkeypatch.setattr(Conf, "WORKERS", 1)
    # set a timer to stop the Sentinel
    threading.Timer(3, stop_event.set).start()
    s = Sentinel(stop_event, start_event, cluster_id=cluster_id, broker=broker)
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED
    assert s.reincarnations == 1
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    task_queue = Queue()
    result_queue = Queue()
    # push two tasks
    pusher(task_queue, stop_event, broker=broker)
    pusher(task_queue, stop_event, broker=broker)
    # worker should exit on recycle
    worker(task_queue, result_queue, Value("f", -1))
    # check if the work has been done
    assert result_queue.qsize() == 2
    # save_limit test
    monkeypatch.setattr(Conf, "SAVE_LIMIT", 1)
    result_queue.put("STOP")
    # run monitor
    with django_assert_num_queries(12):
        monitor(result_queue)
    assert Success.objects.count() == Conf.SAVE_LIMIT
    broker.delete_queue()


@pytest.mark.django_db
def test_save_limit_per_func(broker, monkeypatch):
    # set up the Sentinel
    broker.list_key = "test_recycle_test:q"
    async_task("django_q.tests.tasks.hello", broker=broker)
    async_task("django_q.tests.tasks.countdown", 2, broker=broker)
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    start_event = Event()
    stop_event = Event()
    cluster_id = uuidlib.uuid4()
    task_queue = Queue()
    result_queue = Queue()
    # override settings
    monkeypatch.setattr(Conf, "RECYCLE", 3)
    monkeypatch.setattr(Conf, "WORKERS", 1)
    # set a timer to stop the Sentinel
    threading.Timer(3, stop_event.set).start()
    for i in range(3):
        pusher(task_queue, stop_event, broker=broker)
    worker(task_queue, result_queue, Value("f", -1))
    s = Sentinel(stop_event, start_event, cluster_id=cluster_id, broker=broker)
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED
    # worker should exit on recycle
    # check if the work has been done
    assert result_queue.qsize() == 3
    # save_limit test
    monkeypatch.setattr(Conf, "SAVE_LIMIT", 1)
    monkeypatch.setattr(Conf, "SAVE_LIMIT_PER", "func")
    result_queue.put("STOP")
    # run monitor
    monitor(result_queue)
    assert Success.objects.count() == 3
    assert set(Success.objects.filter().values_list("func", flat=True)) == {
        "django_q.tests.tasks.countdown",
        "django_q.tests.tasks.hello",
        "django_q.tests.tasks.multiply",
    }
    broker.delete_queue()


@pytest.mark.django_db
def test_max_rss(broker, monkeypatch):
    # set up the Sentinel
    broker.list_key = "test_max_rss_test:q"
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    start_event = Event()
    stop_event = Event()
    cluster_id = uuidlib.uuid4()
    # override settings
    monkeypatch.setattr(Conf, "MAX_RSS", 20000)
    monkeypatch.setattr(Conf, "WORKERS", 1)
    # set a timer to stop the Sentinel
    threading.Timer(3, stop_event.set).start()
    s = Sentinel(stop_event, start_event, cluster_id=cluster_id, broker=broker)
    assert start_event.is_set()
    assert s.status() == Conf.STOPPED
    assert s.reincarnations == 1
    async_task("django_q.tests.tasks.multiply", 2, 2, broker=broker)
    task_queue = Queue()
    result_queue = Queue()
    # push the task
    pusher(task_queue, stop_event, broker=broker)
    # worker should exit on recycle
    worker(task_queue, result_queue, Value("f", -1))
    # check if the work has been done
    assert result_queue.qsize() == 1
    # save_limit test
    monkeypatch.setattr(Conf, "SAVE_LIMIT", 1)
    result_queue.put("STOP")
    # run monitor
    monitor(result_queue)
    assert Success.objects.count() == Conf.SAVE_LIMIT
    broker.delete_queue()


@pytest.mark.django_db
def test_bad_secret(broker, monkeypatch):
    broker.list_key = "test_bad_secret:q"
    async_task("math.copysign", 1, -1, broker=broker)
    stop_event = Event()
    stop_event.set()
    start_event = Event()
    cluster_id = uuidlib.uuid4()
    s = Sentinel(
        stop_event, start_event, cluster_id=cluster_id, broker=broker, start=False
    )
    Stat(s).save()
    # change the SECRET
    monkeypatch.setattr(Conf, "SECRET_KEY", "OOPS")
    stat = Stat.get_all()
    assert len(stat) == 0
    assert Stat.get(pid=s.parent_pid, cluster_id=cluster_id) is None
    task_queue = Queue()
    pusher(task_queue, stop_event, broker=broker)
    result_queue = Queue()
    task_queue.put("STOP")
    worker(
        task_queue,
        result_queue,
        Value("f", -1),
    )
    assert result_queue.qsize() == 0
    broker.delete_queue()


@pytest.mark.django_db
def test_attempt_count(broker, monkeypatch):
    monkeypatch.setattr(Conf, "MAX_ATTEMPTS", 3)
    tag = uuid()
    task = {
        "id": tag[1],
        "name": tag[0],
        "func": "math.copysign",
        "args": (1, -1),
        "kwargs": {},
        "started": timezone.now(),
        "stopped": timezone.now(),
        "success": False,
        "result": None,
    }
    # initial save - no success
    save_task(task, broker)
    assert Task.objects.filter(id=task["id"]).exists()
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.attempt_count == 1
    sleep(0.5)
    # second save
    task["stopped"] = timezone.now()
    save_task(task, broker)
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.attempt_count == 2
    # third save -
    task["stopped"] = timezone.now()
    save_task(task, broker)
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.attempt_count == 3
    # task should be removed from queue
    assert broker.queue_size() == 0


@pytest.mark.django_db
def test_update_failed(broker):
    tag = uuid()
    task = {
        "id": tag[1],
        "name": tag[0],
        "func": "math.copysign",
        "args": (1, -1),
        "kwargs": {},
        "started": timezone.now(),
        "stopped": timezone.now(),
        "success": False,
        "result": None,
    }
    # initial save - no success
    save_task(task, broker)
    assert Task.objects.filter(id=task["id"]).exists()
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.success is False
    sleep(0.5)
    # second save - no success
    old_stopped = task["stopped"]
    task["stopped"] = timezone.now()
    save_task(task, broker)
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.stopped > old_stopped
    # third save - success
    task["stopped"] = timezone.now()
    task["result"] = "result"
    task["success"] = True
    save_task(task, broker)
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.success is True
    # fourth save - no success
    task["result"] = None
    task["success"] = False
    task["stopped"] = old_stopped
    save_task(task, broker)
    # should not overwrite success
    saved_task = Task.objects.get(id=task["id"])
    assert saved_task.success is True
    assert saved_task.result == "result"


@pytest.mark.django_db
def test_acknowledge_failure_override():
    class VerifyAckMockBroker(Broker):
        def __init__(self, *args, **kwargs):
            super(VerifyAckMockBroker, self).__init__(*args, **kwargs)
            self.acknowledgements = {}

        def acknowledge(self, task_id):
            count = self.acknowledgements.get(task_id, 0)
            self.acknowledgements[task_id] = count + 1

    tag = uuid()
    task_fail_ack = {
        "id": tag[1],
        "name": tag[0],
        "ack_id": "test_fail_ack_id",
        "ack_failure": True,
        "func": "math.copysign",
        "args": (1, -1),
        "kwargs": {},
        "started": timezone.now(),
        "stopped": timezone.now(),
        "success": False,
        "result": None,
    }

    tag = uuid()
    task_fail_no_ack = task_fail_ack.copy()
    task_fail_no_ack.update(
        {"id": tag[1], "name": tag[0], "ack_id": "test_fail_no_ack_id"}
    )
    del task_fail_no_ack["ack_failure"]

    tag = uuid()
    task_success_ack = task_fail_ack.copy()
    task_success_ack.update(
        {
            "id": tag[1],
            "name": tag[0],
            "ack_id": "test_success_ack_id",
            "success": True,
        }
    )
    del task_success_ack["ack_failure"]

    result_queue = Queue()
    result_queue.put(task_fail_ack)
    result_queue.put(task_fail_no_ack)
    result_queue.put(task_success_ack)
    result_queue.put("STOP")
    broker = VerifyAckMockBroker(list_key="key")

    monitor(result_queue, broker)

    assert broker.acknowledgements.get("test_fail_ack_id") == 1
    assert broker.acknowledgements.get("test_fail_no_ack_id") is None
    assert broker.acknowledgements.get("test_success_ack_id") == 1


class TestSignals:
    @pytest.mark.django_db
    def test_pre_enqueue_signal(self, broker):
        broker.list_key = "pre_enqueue_test:q"
        broker.delete_queue()
        self.signal_was_called: bool = False
        self.task: Optional[dict] = None

        def handler(sender, task, **kwargs):
            self.signal_was_called = True
            self.task = task

        pre_enqueue.connect(handler)
        task_id = async_task("math.copysign", 1, -1, broker=broker)
        assert self.signal_was_called is True
        assert self.task.get("id") == task_id
        pre_enqueue.disconnect(handler)
        broker.delete_queue()

    @pytest.mark.django_db
    def test_pre_execute_signal(self, broker):
        broker.list_key = "pre_execute_test:q"
        broker.delete_queue()
        self.signal_was_called: bool = False
        self.task: Optional[dict] = None
        self.func = None

        def handler(sender, task, func, **kwargs):
            self.signal_was_called = True
            self.task = task
            self.func = func

        pre_execute.connect(handler)
        task_id = async_task("math.copysign", 1, -1, broker=broker)
        task_queue = Queue()
        result_queue = Queue()
        event = Event()
        event.set()
        pusher(task_queue, event, broker=broker)
        task_queue.put("STOP")
        worker(task_queue, result_queue, Value("f", -1))
        result_queue.put("STOP")
        monitor(result_queue, broker)
        broker.delete_queue()
        assert self.signal_was_called is True
        assert self.task.get("id") == task_id
        assert self.func == copysign
        pre_execute.disconnect(handler)

    @pytest.mark.django_db
    def test_post_execute_signal(self, broker):
        broker.list_key = "post_execute_test:q"
        broker.delete_queue()
        self.signal_was_called: bool = False
        self.task: Optional[dict] = None
        self.func = None

        def handler(sender, task, **kwargs):
            self.signal_was_called = True
            self.task = task

        post_execute.connect(handler)
        task_id = async_task("math.copysign", 1, -1, broker=broker)
        task_queue = Queue()
        result_queue = Queue()
        event = Event()
        event.set()
        pusher(task_queue, event, broker=broker)
        task_queue.put("STOP")
        worker(task_queue, result_queue, Value("f", -1))
        result_queue.put("STOP")
        monitor(result_queue, broker)
        broker.delete_queue()
        assert self.signal_was_called is True
        assert self.task.get("id") == task_id
        assert self.task.get("result") == -1
        post_execute.disconnect(handler)

    @pytest.mark.django_db
    def test_post_execute_in_worker_signal(self, broker):
        broker.list_key = "post_execute_in_worker_test:q"
        broker.delete_queue()
        self.signal_was_called: bool = False
        self.task: Optional[dict] = None
        self.func = None

        def handler(sender, task, **kwargs):
            self.signal_was_called = True
            self.task = task

        post_execute_in_worker.connect(handler)
        task_id = async_task("math.copysign", 1, -1, broker=broker)
        task_queue = Queue()
        result_queue = Queue()
        event = Event()
        event.set()
        pusher(task_queue, event, broker=broker)
        task_queue.put("STOP")
        worker(task_queue, result_queue, Value("f", -1))
        result_queue.put("STOP")
        monitor(result_queue, broker)
        broker.delete_queue()
        assert self.signal_was_called is True
        assert self.task.get("id") == task_id
        assert self.task.get("result") == -1
        post_execute_in_worker.disconnect(handler)


@pytest.mark.django_db
def assert_result(task):
    assert task is not None
    assert task.success is True
    assert task.result == 1506


@pytest.mark.django_db
def assert_bad_result(task):
    assert task is not None
    assert task.success is False


@pytest.mark.django_db
def test_add_months():
    # add some months
    initial_date = datetime(2020, 2, 2)
    new_date = add_months(initial_date, 3)
    assert new_date.year == 2020
    assert new_date.month == 5
    assert new_date.day == 2

    # push to next year
    initial_date = datetime(2020, 11, 2)
    new_date = add_months(initial_date, 3)
    assert new_date.year == 2021
    assert new_date.month == 2
    assert new_date.day == 2

    # last day of the month
    initial_date = datetime(2020, 1, 31)
    new_date = add_months(initial_date, 1)
    assert new_date.year == 2020
    assert new_date.month == 2
    assert new_date.day == 29


@pytest.mark.django_db
def test_add_years():
    # add some months
    initial_date = datetime(2020, 2, 2)
    new_date = add_years(initial_date, 1)
    assert new_date.year == 2021
    assert new_date.month == 2
    assert new_date.day == 2

    # test leap year
    initial_date = datetime(2020, 2, 29)
    new_date = add_years(initial_date, 1)
    assert new_date.year == 2021
    assert new_date.month == 2
    assert new_date.day == 28
