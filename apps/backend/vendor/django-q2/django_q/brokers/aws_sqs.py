import copy

from boto3 import Session
from botocore.client import ClientError

from django_q.brokers import Broker
from django_q.conf import Conf

QUEUE_DOES_NOT_EXIST = "AWS.SimpleQueueService.NonExistentQueue"


class Sqs(Broker):
    def __init__(self, list_key: str = None):
        self.sqs = None
        super(Sqs, self).__init__(list_key)
        self.queue = self.get_queue()

    def __setstate__(self, state):
        super(Sqs, self).__setstate__(state)
        self.sqs = None
        self.queue = self.get_queue()

    def enqueue(self, task):
        response = self.queue.send_message(MessageBody=task)
        return response.get("MessageId")

    def dequeue(self):
        # sqs supports max 10 messages in bulk
        if Conf.BULK > 10:
            Conf.BULK = 10

        params = {"MaxNumberOfMessages": Conf.BULK, "VisibilityTimeout": Conf.RETRY}

        # sqs long polling
        sqs_config = Conf.SQS
        if "receive_message_wait_time_seconds" in sqs_config:
            wait_time_second = sqs_config.get("receive_message_wait_time_seconds", 20)

            # validation of parameter
            if not isinstance(wait_time_second, int):
                raise ValueError("receive_message_wait_time_seconds should be int")
            if wait_time_second > 20:
                raise ValueError(
                    "receive_message_wait_time_seconds is invalid. Reason: Must be >= 0"
                    " and <= 20"
                )
            params.update({"WaitTimeSeconds": wait_time_second})

        tasks = self.queue.receive_messages(**params)
        if tasks:
            return [(t.receipt_handle, t.body) for t in tasks]

    def acknowledge(self, task_id):
        return self.delete(task_id)

    def queue_size(self) -> int:
        return int(self.queue.attributes["ApproximateNumberOfMessages"])

    def lock_size(self) -> int:
        return int(self.queue.attributes["ApproximateNumberOfMessagesNotVisible"])

    def delete(self, task_id):
        message = self.sqs.Message(self.queue.url, task_id)
        message.delete()

    def fail(self, task_id):
        self.delete(task_id)

    def delete_queue(self):
        self.queue.delete()

    def purge_queue(self):
        self.queue.purge()

    def ping(self) -> bool:
        return "sqs" in self.connection.get_available_resources()

    def info(self) -> str:
        return "AWS SQS"

    @staticmethod
    def get_connection(list_key: str = None) -> Session:
        config_cloned = copy.deepcopy(Conf.SQS)
        if "aws_region" in config_cloned:
            config_cloned["region_name"] = config_cloned["aws_region"]
            del config_cloned["aws_region"]

        if "receive_message_wait_time_seconds" in config_cloned:
            del config_cloned["receive_message_wait_time_seconds"]

        return Session(**config_cloned)

    def get_queue(self):
        self.sqs = self.connection.resource("sqs")

        try:
            # try to return an existing queue by name. If the queue does not
            # exist try to create it.
            return self.sqs.get_queue_by_name(QueueName=self.list_key)
        except ClientError as exp:
            if exp.response["Error"]["Code"] != QUEUE_DOES_NOT_EXIST:
                raise exp

        return self.sqs.create_queue(QueueName=self.list_key)
