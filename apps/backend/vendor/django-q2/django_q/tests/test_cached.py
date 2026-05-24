import time
from copy import deepcopy
from multiprocessing import Event, Value

import pytest

from django_q.brokers import get_broker
from django_q.conf import Conf
from django_q.monitor import monitor
from django_q.pusher import pusher
from django_q.queues import Queue
from django_q.tasks import (
    AsyncTask,
    Chain,
    Iter,
    async_chain,
    async_iter,
    async_task,
    count_group,
    delete_cached,
    delete_group,
    fetch,
    fetch_group,
    result,
    result_group,
)
from django_q.worker import worker


@pytest.fixture
def broker(monkeypatch):
    monkeypatch.setattr(Conf, "DJANGO_REDIS", "default")
    return get_broker()


@pytest.mark.django_db
def test_cached(broker):
    broker.purge_queue()
    broker.cache.clear()
    group = "cache_test"
    # queue the tests
    task_id = async_task("math.copysign", 1, -1, cached=True, broker=broker)
    async_task("math.copysign", 1, -1, cached=True, broker=broker, group=group)
    async_task("math.copysign", 1, -1, cached=True, broker=broker, group=group)
    async_task("math.copysign", 1, -1, cached=True, broker=broker, group=group)
    async_task("math.copysign", 1, -1, cached=True, broker=broker, group=group)
    async_task("math.copysign", 1, -1, cached=True, broker=broker, group=group)
    async_task("math.popysign", 1, -1, cached=True, broker=broker, group=group)
    iter_id = async_iter("math.floor", [i for i in range(10)], cached=True)
    # test wait on cache
    # test wait timeout
    assert result(task_id, wait=10, cached=True) is None
    assert fetch(task_id, wait=10, cached=True) is None
    assert result_group(group, wait=10, cached=True) is None
    assert result_group(group, count=2, wait=10, cached=True) is None
    assert fetch_group(group, wait=10, cached=True) is None
    assert fetch_group(group, count=2, wait=10, cached=True) is None
    # run a single inline cluster
    task_count = 17
    assert broker.queue_size() == task_count
    task_queue = Queue()
    stop_event = Event()
    stop_event.set()
    for i in range(task_count):
        pusher(task_queue, stop_event, broker=broker)
    assert broker.queue_size() == 0
    assert task_queue.qsize() == task_count
    task_queue.put("STOP")
    result_queue = Queue()
    worker(task_queue, result_queue, Value("f", -1))
    assert result_queue.qsize() == task_count
    result_queue.put("STOP")
    monitor(result_queue)
    assert result_queue.qsize() == 0
    # assert results
    assert result(task_id, wait=500, cached=True) == -1
    assert fetch(task_id, wait=500, cached=True).result == -1
    # make sure it's not in the db backend
    assert fetch(task_id) is None
    # assert group
    assert count_group(group, cached=True) == 6
    assert count_group(group, cached=True, failures=True) == 1
    assert result_group(group, cached=True) == [-1, -1, -1, -1, -1]
    assert len(result_group(group, cached=True, failures=True)) == 6
    assert len(fetch_group(group, cached=True)) == 6
    assert len(fetch_group(group, cached=True, failures=False)) == 5
    delete_group(group, cached=True)
    assert count_group(group, cached=True) is None
    delete_cached(task_id)
    assert result(task_id, cached=True) is None
    assert fetch(task_id, cached=True) is None
    # iter cached
    assert result(iter_id) is None
    assert result(iter_id, cached=True) is not None
    broker.cache.clear()


@pytest.mark.django_db
def test_iter(broker):
    broker.purge_queue()
    broker.cache.clear()
    it = [i for i in range(10)]
    it2 = [(1, -1), (2, -1), (3, -4), (5, 6)]
    it3 = (1, 2, 3, 4, 5)
    t = async_iter("math.floor", it, sync=True)
    t2 = async_iter("math.copysign", it2, sync=True)
    t3 = async_iter("math.floor", it3, sync=True)
    t4 = async_iter("math.floor", (1,), sync=True)
    result_t = result(t)
    assert result_t is not None
    task_t = fetch(t)
    assert task_t.result == result_t
    assert result(t2) is not None
    assert result(t3) is not None
    assert result(t4)[0] == 1
    # test iter class
    i = Iter("math.copysign", sync=True, cached=True)
    i.append(1, -1)
    i.append(2, -1)
    i.append(3, -4)
    i.append(5, 6)
    assert i.started is False
    assert i.length() == 4
    assert i.run() is not None
    assert len(i.result()) == 4
    assert len(i.fetch().result) == 4
    i.append(1, -7)
    assert i.result() is None
    i.run()
    assert len(i.result()) == 5


def _sleeping_func(_):
    time.sleep(1)


@pytest.mark.django_db
def test_iter_default_cache_timeout(broker, settings):
    """
    Test async_iter when it completes after the default Django
    cache timeout expires.
    """
    cache_settings = deepcopy(settings.CACHES)
    cache_settings["default"]["TIMEOUT"] = 1
    settings.CACHES = cache_settings
    broker.purge_queue()
    broker.cache.clear()
    it = [i for i in range(2)]
    t = async_iter(_sleeping_func, it, sync=True)
    result_t = result(t)
    assert result_t is not None


@pytest.mark.django_db
def test_chain(broker):
    broker.purge_queue()
    broker.cache.clear()
    task_chain = Chain(sync=True)
    task_chain.append("math.floor", 1)
    task_chain.append("math.copysign", 1, -1)
    task_chain.append("math.floor", 2)
    assert task_chain.length() == 3
    assert task_chain.current() is None
    task_chain.run()
    r = task_chain.result(wait=1000)
    assert task_chain.current() == task_chain.length()
    assert len(r) == task_chain.length()
    t = task_chain.fetch()
    assert len(t) == task_chain.length()
    task_chain.cached = True
    task_chain.append("math.floor", 3)
    assert task_chain.length() == 4
    task_chain.run()
    r = task_chain.result(wait=1000)
    assert task_chain.current() == task_chain.length()
    assert len(r) == task_chain.length()
    t = task_chain.fetch()
    assert len(t) == task_chain.length()
    # test single
    rid = async_chain(
        ["django_q.tests.tasks.hello", "django_q.tests.tasks.hello"],
        sync=True,
        cached=True,
    )
    assert result_group(rid, cached=True) == ["hello", "hello"]


@pytest.mark.django_db
def test_asynctask_class(broker, monkeypatch):
    broker.purge_queue()
    broker.cache.clear()
    a = AsyncTask("math.copysign")
    assert a.func == "math.copysign"
    a.args = (1, -1)
    assert a.started is False
    a.cached = True
    assert a.cached
    a.sync = True
    assert a.sync
    a.broker = broker
    assert a.broker == broker
    a.run()
    assert a.result() == -1
    assert a.fetch().result == -1
    # again with kwargs
    a = AsyncTask("math.copysign", 1, -1, cached=True, sync=True, broker=broker)
    a.run()
    assert a.result() == -1
    # with q_options
    a = AsyncTask(
        "math.copysign",
        1,
        -1,
        q_options={"cached": True, "sync": False, "broker": broker},
    )
    assert not a.sync
    a.sync = True
    assert a.kwargs["q_options"]["sync"] is True
    a.run()
    assert a.result() == -1
    a.group = "async_class_test"
    assert a.group == "async_class_test"
    a.save = False
    assert not a.save
    a.hook = "djq.tests.tasks.hello"
    assert a.hook == "djq.tests.tasks.hello"
    assert a.started is False
    a.run()
    assert a.result_group() == [-1]
    assert a.fetch_group() == [a.fetch()]
    # global overrides
    monkeypatch.setattr(Conf, "SYNC", True)
    monkeypatch.setattr(Conf, "CACHED", True)
    a = AsyncTask("math.floor", 1.5)
    a.run()
    assert a.result() == 1
