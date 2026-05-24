from multiprocessing import Event
from multiprocessing.process import current_process
from multiprocessing.queues import Queue
from time import sleep

from django import core
from django.apps.registry import apps
from django.utils.translation import gettext_lazy as _

try:
    apps.check_apps_ready()
except core.exceptions.AppRegistryNotReady:
    import django

    django.setup()

from django_q.brokers import Broker, get_broker
from django_q.conf import Conf, logger
from django_q.signing import BadSignature, SignedPackage

try:
    import setproctitle
except ModuleNotFoundError:
    setproctitle = None


def pusher(task_queue: Queue, event: Event, broker: Broker = None):
    """
    Pulls tasks of the broker and puts them in the task queue
    :type broker:
    :type task_queue: multiprocessing.Queue
    :type event: multiprocessing.Event
    """
    if not broker:
        broker = get_broker()
    proc_name = current_process().name
    if setproctitle:
        setproctitle.setproctitle(f"qcluster {proc_name} pusher")
    logger.info(
        _("%(name)s pushing tasks at %(id)s")
        % {"name": proc_name, "id": current_process().pid}
    )
    while True:
        try:
            task_set = broker.dequeue()
        except Exception:
            logger.exception("Failed to pull task from broker")
            # broker probably crashed. Let the sentinel handle it.
            sleep(10)
            break
        if task_set:
            for task in task_set:
                ack_id = task[0]
                # unpack the task
                try:
                    task = SignedPackage.loads(task[1])
                except (TypeError, BadSignature):
                    logger.exception("Failed to push task to queue")
                    broker.fail(ack_id)
                    continue
                task["cluster"] = (
                    Conf.CLUSTER_NAME
                )  # save actual cluster name to orm task table
                task["ack_id"] = ack_id
                task_queue.put(task)
            logger.debug(
                _("queueing from %(list_key)s") % {"list_key": broker.list_key}
            )
        if event.is_set():
            break
    logger.info(_("%(name)s stopped pushing tasks") % {"name": current_process().name})
