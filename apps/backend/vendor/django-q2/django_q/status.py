import socket
from typing import Union

from django.utils import timezone

from django_q.brokers import Broker, get_broker
from django_q.conf import Conf, logger
from django_q.signing import BadSignature, SignedPackage


class Status:
    """Cluster status base class."""

    def __init__(self, pid, cluster_id):
        self.workers = []
        self.tob = None
        self.reincarnations = 0
        self.pid = pid
        self.cluster_id = cluster_id
        self.sentinel = 0
        self.status = Conf.STOPPED
        self.done_q_size = 0
        self.host = socket.gethostname()
        self.monitor = 0
        self.task_q_size = 0
        self.pusher = 0
        self.timestamp = timezone.now()


class Stat(Status):
    """Status object for Cluster monitoring."""

    def __init__(self, sentinel):
        super(Stat, self).__init__(
            sentinel.parent_pid or sentinel.pid, cluster_id=sentinel.cluster_id
        )
        self.broker = sentinel.broker or get_broker()
        self.tob = sentinel.tob
        self.reincarnations = sentinel.reincarnations
        self.sentinel = sentinel.pid
        self.status = sentinel.status()
        self.done_q_size = 0
        self.task_q_size = 0
        if Conf.QSIZE:
            self.done_q_size = sentinel.result_queue.qsize()
            self.task_q_size = sentinel.task_queue.qsize()
        if sentinel.monitor:
            self.monitor = sentinel.monitor.pid
        if sentinel.pusher:
            self.pusher = sentinel.pusher.pid
        self.workers = [w.pid for w in sentinel.pool]

    def uptime(self) -> float:
        return (timezone.now() - self.tob).total_seconds()

    @property
    def key(self) -> str:
        """
        :return: redis key for this cluster statistic
        """
        return self.get_key(self.cluster_id)

    @staticmethod
    def get_key(cluster_id) -> str:
        """
        :param cluster_id: cluster ID
        :return: redis key for the cluster statistic
        """
        return f"{Conf.Q_STAT}:{cluster_id}"

    def save(self):
        try:
            self.broker.set_stat(self.key, SignedPackage.dumps(self, True), 3)
        except Exception as e:
            logger.error(e)

    def empty_queues(self) -> bool:
        return self.done_q_size + self.task_q_size == 0

    @staticmethod
    def get(pid: int, cluster_id: str, broker: Broker = None) -> Union[Status, None]:
        """
        gets the current status for the cluster
        :param pid:
        :param broker: an optional broker instance
        :param cluster_id: id of the cluster
        :return: Stat or Status
        """
        if not broker:
            broker = get_broker()
        pack = broker.get_stat(Stat.get_key(cluster_id))
        if pack:
            try:
                return SignedPackage.loads(pack)
            except BadSignature:
                return None
        return Status(pid=pid, cluster_id=cluster_id)

    @staticmethod
    def get_all(broker: Broker = None) -> list:
        """
        Get the status for all currently running clusters with the same prefix
        and secret key.
        :return: list of type Stat
        """
        if not broker:
            broker = get_broker()
        stats = []
        packs = broker.get_stats(f"{Conf.Q_STAT}:*") or []
        for pack in packs:
            try:
                stats.append(SignedPackage.loads(pack))
            except BadSignature:
                continue
        return stats

    def __getstate__(self):
        # Don't pickle the redis connection
        state = dict(self.__dict__)
        del state["broker"]
        return state
