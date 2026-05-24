import importlib
from typing import Optional

from django.core.cache import InvalidCacheBackendError, caches

from django_q.conf import Conf


class Broker:
    def __init__(self, list_key: str = None):
        # With same BROKER_CLASS, `list_key` is just a synonym for `queue_name` except for RedisBroker
        list_key = list_key or Conf.CLUSTER_NAME
        self.connection = self.get_connection(list_key)
        self.list_key = list_key
        self.cache = self.get_cache()
        self._info = None

    def __getstate__(self):
        return self.list_key, self._info

    def __setstate__(self, state):
        self.list_key, self._info = state
        self.connection = self.get_connection(self.list_key)
        self.cache = self.get_cache()

    def enqueue(self, task):
        """
        Puts a task onto the queue
        :type task: str
        :return: task id
        """
        pass

    def dequeue(self):
        """
        Gets a task from the queue
        :return: tuple with task id and task message
        """
        pass

    def queue_size(self):
        """
        :return: the amount of tasks in the queue
        """
        pass

    def lock_size(self):
        """
        :return: the number of tasks currently awaiting acknowledgement
        """

    def delete_queue(self):
        """
        Deletes the queue from the broker
        """
        pass

    def purge_queue(self):
        """
        Purges the queue of any tasks
        """
        pass

    def delete(self, task_id):
        """
        Deletes a task from the queue
        :param task_id: the id of the task
        """
        pass

    def acknowledge(self, task_id):
        """
        Acknowledges completion of the task and removes it from the queue.
        :param task_id: the id of the task
        """
        pass

    def fail(self, task_id):
        """
        Fails a task message
        :param task_id:
        :return:
        """

    def ping(self) -> bool:
        """
        Checks whether the broker connection is available
        :rtype: bool
        """
        pass

    def info(self):
        """
        Shows the broker type
        """
        return self._info

    def set_stat(self, key: str, value: str, timeout: int):
        """
        Saves a cluster statistic to the cache provider
        :type key: str
        :type value: str
        :type timeout: int
        """
        if not self.cache:
            return
        key_list = self.cache.get(Conf.Q_STAT, [])
        if key not in key_list:
            # Prune stale entries whose per-stat value has expired, so the
            # master list cannot grow without bound across cluster restarts.
            key_list = [k for k in key_list if self.cache.get(k) is not None]
            key_list.append(key)
            # timeout=None: master list lifetime is managed by membership
            # changes, not by TTL refresh on every heartbeat.
            self.cache.set(Conf.Q_STAT, key_list, None)
        return self.cache.set(key, value, timeout)

    def get_stat(self, key: str):
        """
        Gets a cluster statistic from the cache provider
        :type key: str
        :return: a cluster Stat
        """
        if not self.cache:
            return
        return self.cache.get(key)

    def get_stats(self, pattern: str) -> Optional[list]:
        """
        Returns a list of all cluster stats from the cache provider
        :type pattern: str
        :return: a list of Stats
        """
        if not self.cache:
            return
        key_list = self.cache.get(Conf.Q_STAT)
        if not key_list or len(key_list) == 0:
            return []
        stats = []
        for key in key_list:
            stat = self.cache.get(key)
            if stat:
                stats.append(stat)
            else:
                key_list.remove(key)
        self.cache.set(Conf.Q_STAT, key_list)
        return stats

    @staticmethod
    def get_cache():
        """
        Gets the current cache provider
        :return: a cache provider
        """
        try:
            return caches[Conf.CACHE]
        except InvalidCacheBackendError:
            return None

    @staticmethod
    def get_connection(list_key: str = None):
        """
        Gets a connection to the broker
        :param list_key: Optional queue name
        :return: a broker connection
        """
        return 0


def get_broker(list_key: str = None) -> Broker:
    """
    Gets the configured broker type
    :param list_key: optional queue name
    :type list_key: str
    :return: a broker instance
    """
    list_key = list_key or Conf.CLUSTER_NAME
    # custom
    if Conf.BROKER_CLASS:
        module, func = Conf.BROKER_CLASS.rsplit(".", 1)
        m = importlib.import_module(module)
        broker = getattr(m, func)
        return broker(list_key=list_key)
    # Iron MQ
    elif Conf.IRON_MQ:
        from django_q.brokers import ironmq

        return ironmq.IronMQBroker(list_key=list_key)
    # SQS
    elif isinstance(Conf.SQS, dict):
        from django_q.brokers import aws_sqs

        return aws_sqs.Sqs(list_key=list_key)
    # ORM
    elif Conf.ORM:
        from django_q.brokers import orm

        return orm.ORM(list_key=list_key)
    # Mongo
    elif Conf.MONGO:
        from django_q.brokers import mongo

        return mongo.Mongo(list_key=list_key)
    # default to redis
    else:
        from django_q.brokers import redis_broker

        return redis_broker.Redis(list_key=list_key)
