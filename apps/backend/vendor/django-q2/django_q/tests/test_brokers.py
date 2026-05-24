import os
from time import sleep

import pytest

from django_q.brokers import Broker, get_broker
from django_q.conf import Conf
from django_q.humanhash import uuid
from django_q.tests.settings import MONGO_HOST, REDIS_HOST


def test_broker(monkeypatch):
    broker = Broker()
    broker.enqueue("test")
    broker.dequeue()
    broker.queue_size()
    broker.lock_size()
    broker.purge_queue()
    broker.delete("id")
    broker.delete_queue()
    broker.acknowledge("test")
    broker.ping()
    broker.info()
    # stats
    assert broker.get_stat("test_1") is None
    broker.set_stat("test_1", "test", 3)
    assert broker.get_stat("test_1") == "test"
    assert broker.get_stats("test:*")[0] == "test"
    # stats with no cache
    monkeypatch.setattr(Conf, "CACHE", "not_configured")
    broker.cache = broker.get_cache()
    assert broker.get_stat("test_1") is None
    broker.set_stat("test_1", "test", 3)
    assert broker.get_stat("test_1") is None
    assert broker.get_stats("test:*") is None


def test_broker_set_stat_prunes_stale_master_list():
    # regression: set_stat should prune stale master-list entries on register
    broker = Broker()
    a_key = f"{Conf.Q_STAT}:A"
    b_key = f"{Conf.Q_STAT}:B"
    broker.cache.delete(Conf.Q_STAT)

    broker.set_stat(a_key, "state_a", 3)
    assert a_key in broker.cache.get(Conf.Q_STAT)

    # Drop A's per-stat value to simulate a dead cluster whose TTL expired,
    # leaving the master-list entry as a stale reference.
    broker.cache.delete(a_key)
    assert broker.get_stat(a_key) is None
    assert a_key in broker.cache.get(Conf.Q_STAT)

    # Registering B should prune stale A from the master list.
    broker.set_stat(b_key, "state_b", 3)
    key_list = broker.cache.get(Conf.Q_STAT)
    assert a_key not in key_list
    assert b_key in key_list
    assert broker.get_stat(b_key) == "state_b"


def test_broker_set_stat_skips_master_list_write_on_repeat(monkeypatch):
    # set_stat should only write the master list when membership changes
    broker = Broker()
    a_key = f"{Conf.Q_STAT}:A"
    broker.cache.delete(Conf.Q_STAT)

    writes = []
    orig_set = broker.cache.set

    def counting_set(key, value, timeout=None, **kw):
        if key == Conf.Q_STAT:
            writes.append(key)
        return orig_set(key, value, timeout, **kw)

    monkeypatch.setattr(broker.cache, "set", counting_set)

    # First call adds a new entry, one master-list write expected
    broker.set_stat(a_key, "state_a", 3)
    assert len(writes) == 1

    # Subsequent calls for the same key must not rewrite the master list
    broker.set_stat(a_key, "state_a", 3)
    broker.set_stat(a_key, "state_a", 3)
    broker.set_stat(a_key, "state_a", 3)
    assert len(writes) == 1


def test_redis(monkeypatch):
    monkeypatch.setattr(Conf, "DJANGO_REDIS", None)
    broker = get_broker()
    assert broker.ping() is True
    assert broker.info() is not None
    monkeypatch.setattr(Conf, "REDIS", {"host": REDIS_HOST, "port": 7799})
    broker = get_broker()
    with pytest.raises(Exception):
        broker.ping()
    monkeypatch.setattr(Conf, "REDIS", f"redis://{REDIS_HOST}:7799")
    broker = get_broker()
    with pytest.raises(Exception):
        broker.ping()


def test_custom(monkeypatch):
    monkeypatch.setattr(Conf, "BROKER_CLASS", "django_q.brokers.redis_broker.Redis")
    broker = get_broker()
    assert broker.ping() is True
    assert broker.info() is not None
    assert broker.__class__.__name__ == "Redis"


@pytest.mark.skipif(
    not os.getenv("IRON_MQ_TOKEN"), reason="requires IronMQ credentials"
)
def test_ironmq(monkeypatch):
    monkeypatch.setattr(
        Conf,
        "IRON_MQ",
        {
            "token": os.getenv("IRON_MQ_TOKEN"),
            "project_id": os.getenv("IRON_MQ_PROJECT_ID"),
        },
    )
    # check broker
    broker = get_broker(list_key=uuid()[0])
    assert broker.ping() is True
    assert broker.info() is not None
    # initialize the queue
    broker.enqueue("test")
    # clear before we start
    broker.purge_queue()
    assert broker.queue_size() == 0
    # async_task
    broker.enqueue("test")
    # dequeue
    task = broker.dequeue()[0]
    assert task[1] == "test"
    broker.acknowledge(task[0])
    assert broker.dequeue() is None
    # Retry test
    # monkeypatch.setattr(Conf, 'RETRY', 1)
    # broker.async_task('test')
    # assert broker.dequeue() is not None
    # sleep(3)
    # assert broker.dequeue() is not None
    # task = broker.dequeue()[0]
    # assert len(task) > 0
    # broker.acknowledge(task[0])
    # sleep(3)
    # delete job
    task_id = broker.enqueue("test")
    broker.delete(task_id)
    assert broker.dequeue() is None
    # fail
    task_id = broker.enqueue("test")
    broker.fail(task_id)
    # bulk test
    for _ in range(5):
        broker.enqueue("test")
    monkeypatch.setattr(Conf, "BULK", 5)
    tasks = broker.dequeue()
    for task in tasks:
        assert task is not None
        broker.acknowledge(task[0])
    # duplicate acknowledge
    broker.acknowledge(task[0])
    # delete queue
    broker.enqueue("test")
    broker.enqueue("test")
    broker.purge_queue()
    assert broker.dequeue() is None
    broker.delete_queue()


@pytest.mark.skipif(
    not os.getenv("AWS_ACCESS_KEY_ID"), reason="requires AWS credentials"
)
def test_sqs(monkeypatch):
    monkeypatch.setattr(
        Conf,
        "SQS",
        {
            "aws_region": os.getenv("AWS_REGION"),
            "aws_access_key_id": os.getenv("AWS_ACCESS_KEY_ID"),
            "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY"),
            "receive_message_wait_time_seconds": 5,
        },
    )
    # check broker
    broker = get_broker(list_key="testing")
    assert "receive_message_wait_time_seconds" in Conf.SQS
    assert "aws_region" in Conf.SQS
    assert broker.ping() is True
    assert broker.info() is not None
    assert broker.queue_size() == 0
    # async_task
    broker.enqueue("test")
    # dequeue
    task = broker.dequeue()[0]
    assert task[1] == "test"
    broker.acknowledge(task[0])
    assert broker.dequeue() is None
    # Retry test
    monkeypatch.setattr(Conf, "RETRY", 1)
    broker.enqueue("test")
    sleep(2)
    # Sometimes SQS is not linear
    task = broker.dequeue()
    if not task:
        pytest.skip("SQS being weird")
    task = task[0]
    assert len(task) > 0
    broker.acknowledge(task[0])
    sleep(2)
    # delete job
    monkeypatch.setattr(Conf, "RETRY", 60)
    broker.enqueue("test")
    sleep(1)
    task = broker.dequeue()
    if not task:
        pytest.skip("SQS being weird")
    task_id = task[0][0]
    broker.delete(task_id)
    assert broker.dequeue() is None
    # fail
    broker.enqueue("test")
    while task is None:
        task = broker.dequeue()[0]
    broker.fail(task[0][0])
    # bulk test
    for _ in range(10):
        broker.enqueue("test")
    monkeypatch.setattr(Conf, "BULK", 12)
    tasks = broker.dequeue()
    for task in tasks:
        assert task is not None
        broker.acknowledge(task[0])
    # duplicate acknowledge
    broker.acknowledge(task[0])
    assert broker.lock_size() == 0
    # delete queue
    broker.enqueue("test")
    broker.purge_queue()
    broker.delete_queue()


@pytest.mark.django_db
def test_orm(monkeypatch):
    monkeypatch.setattr(Conf, "ORM", "default")
    # check broker
    broker = get_broker(list_key="orm_test")
    assert broker.ping() is True
    assert broker.info() is not None
    # clear before we start
    broker.delete_queue()
    # async_task
    broker.enqueue("test")
    assert broker.queue_size() == 1
    # dequeue
    task = broker.dequeue()[0]
    assert task[1] == "test"
    broker.acknowledge(task[0])
    assert broker.queue_size() == 0
    # Retry test
    monkeypatch.setattr(Conf, "RETRY", 1)
    broker.enqueue("test")
    assert broker.queue_size() == 1
    broker.dequeue()
    assert broker.queue_size() == 0
    sleep(1.5)
    assert broker.queue_size() == 1
    task = broker.dequeue()[0]
    assert broker.queue_size() == 0
    broker.acknowledge(task[0])
    sleep(1.5)
    assert broker.queue_size() == 0
    # delete job
    task_id = broker.enqueue("test")
    broker.delete(task_id)
    assert broker.dequeue() is None
    # fail
    task_id = broker.enqueue("test")
    broker.fail(task_id)
    # bulk test
    for _ in range(5):
        broker.enqueue("test")
    monkeypatch.setattr(Conf, "BULK", 5)
    tasks = broker.dequeue()
    assert broker.lock_size() == Conf.BULK
    for task in tasks:
        assert task is not None
        broker.acknowledge(task[0])
    # test lock size
    assert broker.lock_size() == 0
    # test duplicate acknowledge
    broker.acknowledge(task[0])
    # delete queue
    broker.enqueue("test")
    broker.enqueue("test")
    broker.delete_queue()
    assert broker.queue_size() == 0


@pytest.mark.django_db
def test_mongo(monkeypatch):
    monkeypatch.setattr(Conf, "MONGO", {"host": MONGO_HOST, "port": 27017})
    # check broker
    broker = get_broker(list_key="mongo_test")
    assert broker.ping() is True
    assert broker.info() is not None
    # clear before we start
    broker.delete_queue()
    # async_task
    broker.enqueue("test")
    assert broker.queue_size() == 1
    # dequeue
    task = broker.dequeue()[0]
    assert task[1] == "test"
    broker.acknowledge(task[0])
    assert broker.queue_size() == 0
    # Retry test
    monkeypatch.setattr(Conf, "RETRY", 1)
    broker.enqueue("test")
    assert broker.queue_size() == 1
    broker.dequeue()
    assert broker.queue_size() == 0
    sleep(1.5)
    assert broker.queue_size() == 1
    task = broker.dequeue()[0]
    assert broker.queue_size() == 0
    broker.acknowledge(task[0])
    sleep(1.5)
    assert broker.queue_size() == 0
    # delete job
    task_id = broker.enqueue("test")
    broker.delete(task_id)
    assert broker.dequeue() is None
    # fail
    task_id = broker.enqueue("test")
    broker.fail(task_id)
    # bulk test
    for _ in range(5):
        broker.enqueue("test")
    tasks = [broker.dequeue()[0] for _ in range(5)]
    assert broker.lock_size() == 5
    for task in tasks:
        assert task is not None
        broker.acknowledge(task[0])
    # test lock size
    assert broker.lock_size() == 0
    # test duplicate acknowledge
    broker.acknowledge(task[0])
    # delete queue
    broker.enqueue("test")
    broker.enqueue("test")
    broker.purge_queue()
    broker.delete_queue()
    assert broker.queue_size() == 0
