from iron_mq import IronMQ, Queue
from requests.exceptions import HTTPError

from django_q.brokers import Broker
from django_q.conf import Conf


class IronMQBroker(Broker):
    def enqueue(self, task):
        return self.connection.post(task)["ids"][0]

    def dequeue(self):
        timeout = Conf.RETRY or None
        tasks = self.connection.get(timeout=timeout, wait=1, max=Conf.BULK)["messages"]
        if tasks:
            return [(t["id"], t["body"]) for t in tasks]

    def ping(self) -> bool:
        return self.connection.name == self.list_key

    def info(self) -> str:
        return "IronMQ"

    def queue_size(self):
        return self.connection.size()

    def delete_queue(self):
        try:
            return self.connection.delete_queue()["msg"]
        except HTTPError:
            return False

    def purge_queue(self):
        return self.connection.clear()

    def delete(self, task_id):
        try:
            return self.connection.delete(task_id)["msg"]
        except HTTPError:
            return False

    def fail(self, task_id):
        self.delete(task_id)

    def acknowledge(self, task_id):
        return self.delete(task_id)

    @staticmethod
    def get_connection(list_key: str = None) -> Queue:
        list_key = list_key or Conf.CLUSTER_NAME
        ironmq = IronMQ(name=None, **Conf.IRON_MQ)
        return ironmq.queue(queue_name=list_key)
