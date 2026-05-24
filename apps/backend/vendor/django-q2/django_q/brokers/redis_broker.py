import redis
from redis import Redis

from django_q.brokers import Broker
from django_q.conf import Conf, logger

try:
    import django_redis
except ImportError:
    django_redis = None


class Redis(Broker):
    def __init__(self, list_key: str = None):
        list_key = list_key or Conf.CLUSTER_NAME
        super(Redis, self).__init__(list_key=f"django_q:{list_key}:q")

    def enqueue(self, task):
        return self.connection.rpush(self.list_key, task)

    def dequeue(self):
        task = self.connection.blpop(self.list_key, 1)
        if task:
            return [(None, task[1])]

    def queue_size(self):
        return self.connection.llen(self.list_key)

    def delete_queue(self):
        return self.connection.delete(self.list_key)

    def purge_queue(self):
        return self.connection.ltrim(self.list_key, 1, 0)

    def ping(self) -> bool:
        try:
            return self.connection.ping()
        except redis.ConnectionError as e:
            logger.error("Can not connect to Redis server.")
            raise e

    def info(self) -> str:
        if not self._info:
            info = self.connection.info("server")
            self._info = f"Redis {info['redis_version']}"
        return self._info

    def set_stat(self, key: str, value: str, timeout: int):
        self.connection.set(key, value, timeout)

    def get_stat(self, key: str):
        if self.connection.exists(key):
            return self.connection.get(key)

    def get_stats(self, pattern: str):
        keys = self.connection.keys(pattern=pattern)
        if keys:
            return self.connection.mget(keys)

    @staticmethod
    def get_connection(list_key: str = None) -> Redis:
        if django_redis and Conf.DJANGO_REDIS:
            return django_redis.get_redis_connection(Conf.DJANGO_REDIS)
        if isinstance(Conf.REDIS, str):
            return redis.from_url(Conf.REDIS)
        return redis.StrictRedis(**Conf.REDIS)
