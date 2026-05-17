from datetime import timedelta
from time import sleep

from bson import ObjectId
from django.utils import timezone
from pymongo import MongoClient
from pymongo.errors import ConfigurationError

from django_q.brokers import Broker
from django_q.conf import Conf


def _timeout():
    return timezone.now() - timedelta(seconds=Conf.RETRY)


class Mongo(Broker):
    def __init__(self, list_key: str = None):
        super(Mongo, self).__init__(list_key)
        self.collection = self.get_collection()

    def __setstate__(self, state):
        super(Mongo, self).__setstate__(state)
        self.collection = self.get_collection()

    @staticmethod
    def get_connection(list_key: str = None) -> MongoClient:
        return MongoClient(**Conf.MONGO)

    def get_collection(self):
        if not Conf.MONGO_DB:
            try:
                Conf.MONGO_DB = self.connection.get_default_database().name
            except ConfigurationError:
                Conf.MONGO_DB = "django-q"
        return self.connection[Conf.MONGO_DB][self.list_key]

    def queue_size(self):
        return self.collection.count_documents({"lock": {"$lte": _timeout()}})

    def lock_size(self):
        return self.collection.count_documents({"lock": {"$gt": _timeout()}})

    def purge_queue(self):
        return self.delete_queue()

    def ping(self) -> bool:
        return self.info is not None

    def info(self) -> str:
        if not self._info:
            self._info = f"MongoDB {self.connection.server_info()['version']}"
        return self._info

    def fail(self, task_id):
        self.delete(task_id)

    def enqueue(self, task):
        inserted_id = self.collection.insert_one(
            {"payload": task, "lock": _timeout()}
        ).inserted_id
        return str(inserted_id)

    def dequeue(self):
        task = self.collection.find_one_and_update(
            {"lock": {"$lte": _timeout()}}, {"$set": {"lock": timezone.now()}}
        )
        if task:
            return [(str(task["_id"]), task["payload"])]
        # empty queue, spare the cpu
        sleep(Conf.POLL)

    def delete_queue(self):
        return self.collection.drop()

    def delete(self, task_id):
        self.collection.delete_one({"_id": ObjectId(task_id)})

    def acknowledge(self, task_id):
        return self.delete(task_id)
