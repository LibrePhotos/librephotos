# Standard
import os
import signal
import socket
import uuid
from multiprocessing import Event, Process, Value, current_process
from time import sleep

# Django
from django import core, db
from django.apps.registry import apps

try:
    apps.check_apps_ready()
except core.exceptions.AppRegistryNotReady:
    import django

    django.setup()

from django.utils import timezone
from django.utils.translation import gettext_lazy as _

# Local
from django_q.brokers import Broker, get_broker
from django_q.conf import (
    Conf,
    get_ppid,
    logger,
    prometheus_multiprocess,
    psutil,
    setproctitle,
)
from django_q.humanhash import humanize
from django_q.monitor import monitor
from django_q.pusher import pusher
from django_q.queues import Queue
from django_q.scheduler import scheduler
from django_q.status import Stat, Status
from django_q.worker import worker


class Cluster:
    def __init__(self, broker: Broker = None):
        # Cluster do not need an init or default broker except for testing,
        # The sentinel will create a broker for cluster and utilize ALT_CLUSTERS config in Conf.
        self.broker = broker  # DON'T USE get_broker() to set a default broker here.
        self.sentinel = None
        self.stop_event = None
        self.start_event = None
        self.pid = current_process().pid
        self.cluster_id = uuid.uuid4()
        self.host = socket.gethostname()
        self.timeout = None
        signal.signal(signal.SIGTERM, self.sig_handler)
        signal.signal(signal.SIGINT, self.sig_handler)

    def start(self) -> int:
        if setproctitle:
            setproctitle.setproctitle(f"qcluster {current_process().name} {self.name}")
        # Start Sentinel
        self.stop_event = Event()
        self.start_event = Event()
        self.sentinel = Process(
            target=Sentinel,
            name=f"Process-{uuid.uuid4().hex}",
            args=(
                self.stop_event,
                self.start_event,
                self.cluster_id,
                self.broker,
                self.timeout,
            ),
        )
        self.sentinel.start()
        logger.info(_("Q Cluster %(name)s starting.") % {"name": self.name})
        while not self.start_event.is_set():
            sleep(0.1)
        return self.pid

    def stop(self) -> bool:
        if not self.sentinel.is_alive():
            return False
        logger.info(_("Q Cluster %(name)s stopping.") % {"name": self.name})
        self.stop_event.set()
        self.sentinel.join()
        logger.info(_("Q Cluster %(name)s has stopped.") % {"name": self.name})
        self.start_event = None
        self.stop_event = None
        return True

    def sig_handler(self, signum, frame):
        logger.debug(
            _("%(name)s got signal %(signal)s")
            % {
                "name": current_process().name,
                "signal": Conf.SIGNAL_NAMES.get(signum, "UNKNOWN"),
            }
        )
        self.stop()

    @property
    def stat(self) -> Status:
        if self.sentinel:
            return Stat.get(pid=self.pid, cluster_id=self.cluster_id)
        return Status(pid=self.pid, cluster_id=self.cluster_id)

    @property
    def name(self) -> str:
        return humanize(self.cluster_id.hex)

    @property
    def is_starting(self) -> bool:
        return self.stop_event and self.start_event and not self.start_event.is_set()

    @property
    def is_running(self) -> bool:
        return self.stop_event and self.start_event and self.start_event.is_set()

    @property
    def is_stopping(self) -> bool:
        return (
            self.stop_event
            and self.start_event
            and self.start_event.is_set()
            and self.stop_event.is_set()
        )

    @property
    def has_stopped(self) -> bool:
        return self.start_event is None and self.stop_event is None and self.sentinel


class Sentinel:
    def __init__(
        self,
        stop_event,
        start_event,
        cluster_id,
        broker=None,
        timeout=None,
        start=True,
    ):
        # Make sure we catch signals for the pool
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        self.pid = current_process().pid
        self.cluster_id = cluster_id
        self.parent_pid = get_ppid()
        self.name = current_process().name
        self.broker = broker or get_broker()
        self.reincarnations = 0
        self.tob = timezone.now()
        self.stop_event = stop_event
        self.start_event = start_event
        self.pool_size = Conf.WORKERS
        self.pool = []
        self.timeout = timeout or Conf.TIMEOUT
        self.task_queue = (
            Queue(maxsize=Conf.QUEUE_LIMIT) if Conf.QUEUE_LIMIT else Queue()
        )
        self.result_queue = Queue()
        self.event_out = Event()
        self.monitor = None
        self.pusher = None
        if start:
            self.start()

    def queue_name(self):
        # multi-queue: cluster name is (broker's) queue_name
        return self.broker.list_key if self.broker else "--"

    def start(self):
        self.broker.ping()
        self.spawn_cluster()
        self.guard()

    def status(self) -> str:
        if not self.start_event.is_set() and not self.stop_event.is_set():
            return Conf.STARTING
        elif self.start_event.is_set() and not self.stop_event.is_set():
            if self.result_queue.empty() and self.task_queue.empty():
                return Conf.IDLE
            return Conf.WORKING
        elif self.stop_event.is_set() and self.start_event.is_set():
            if self.monitor.is_alive() or self.pusher.is_alive() or len(self.pool) > 0:
                return Conf.STOPPING
            return Conf.STOPPED

    def spawn_process(self, target, *args) -> Process:
        """
        :type target: function or class
        """
        p = Process(target=target, args=args, name=f"Process-{uuid.uuid4().hex}")
        p.daemon = True
        if target == worker:
            p.daemon = Conf.DAEMONIZE_WORKERS
            p.timer = args[2]
            self.pool.append(p)
        p.start()
        return p

    def spawn_pusher(self) -> Process:
        return self.spawn_process(pusher, self.task_queue, self.event_out, self.broker)

    def spawn_worker(self):
        self.spawn_process(
            worker, self.task_queue, self.result_queue, Value("f", -1), self.timeout
        )

    def spawn_monitor(self) -> Process:
        return self.spawn_process(monitor, self.result_queue, self.broker)

    def reincarnate(self, process):
        """
        :param process: the process to reincarnate
        :type process: Process or None
        """
        # close connections before spawning new process
        if not Conf.SYNC:
            db.connections.close_all()
        if process == self.monitor:
            self.monitor = self.spawn_monitor()
            logger.critical(
                _("reincarnated monitor %(name)s after sudden death")
                % {"name": process.name}
            )
        elif process == self.pusher:
            self.pusher = self.spawn_pusher()
            logger.critical(
                _("reincarnated pusher %(name)s after sudden death")
                % {"name": process.name}
            )
        else:
            # check if prometheus is proper configurated
            prometheus_path = os.getenv(
                "PROMETHEUS_MULTIPROC_DIR", os.getenv("prometheus_multiproc_dir")
            )

            if prometheus_multiprocess and prometheus_path:
                prometheus_multiprocess.mark_process_dead(process.pid)

            self.pool.remove(process)
            self.spawn_worker()
            if process.timer.value == 0:
                # only need to terminate on timeout, otherwise we risk destabilizing
                # the queues
                task_name = ""
                if psutil:
                    try:
                        process_name = psutil.Process(process.pid).name()
                        name_splits = process_name.split(" ")
                        task_name = (
                            name_splits[3]
                            if len(name_splits) >= 4 and name_splits[2] == "processing"
                            else ""
                        )
                    except psutil.NoSuchProcess:
                        pass
                process.terminate()
                if task_name:
                    msg = _(
                        "reincarnated worker %(name)s after timeout while processing task %(task_name)s"
                    ) % {"name": process.name, "task_name": task_name}
                else:
                    msg = _("reincarnated worker %(name)s after timeout") % {
                        "name": process.name
                    }
                logger.critical(msg)
            elif int(process.timer.value) == -2:
                logger.info(_("recycled worker %(name)s") % {"name": process.name})
            else:
                logger.critical(
                    _("reincarnated worker %(name)s after death")
                    % {"name": process.name}
                )

        self.reincarnations += 1

    def spawn_cluster(self):
        self.pool = []
        Stat(self).save()
        # close connections before spawning new process
        if not Conf.SYNC:
            db.connections.close_all()
        # spawn worker pool
        for __ in range(self.pool_size):
            self.spawn_worker()
        # spawn auxiliary
        self.monitor = self.spawn_monitor()
        self.pusher = self.spawn_pusher()
        # set worker cpu affinity if needed
        if psutil and Conf.CPU_AFFINITY:
            set_cpu_affinity(Conf.CPU_AFFINITY, [w.pid for w in self.pool])

    def guard(self):
        logger.info(
            _("%(name)s guarding cluster %(cluster_name)s")
            % {
                "name": current_process().name,
                "cluster_name": humanize(self.cluster_id.hex)
                + f" [{self.queue_name()}]",
            }
        )
        self.start_event.set()
        Stat(self).save()
        logger.info(
            _("Q Cluster %(cluster_name)s running.")
            % {
                "cluster_name": humanize(self.cluster_id.hex)
                + f" [{self.queue_name()}]"
            }
        )
        counter = 0
        cycle = Conf.GUARD_CYCLE  # guard loop sleep in seconds
        # Guard loop. Runs at least once
        while not self.stop_event.is_set() or not counter:
            # Check Workers
            for p in self.pool:
                with p.timer.get_lock():
                    # Are you alive?
                    if not p.is_alive() or p.timer.value == 0:
                        self.reincarnate(p)
                        continue
                    # Decrement timer if work is being done
                    if p.timer.value > 0:
                        p.timer.value -= cycle
            # Check Monitor
            if not self.monitor.is_alive():
                self.reincarnate(self.monitor)
            # Check Pusher
            if not self.pusher.is_alive():
                self.reincarnate(self.pusher)
            # Call scheduler once a minute (or so)
            counter += cycle
            if counter >= 30 and Conf.SCHEDULER:
                counter = 0
                scheduler(broker=self.broker)
            # Save current status
            Stat(self).save()
            sleep(cycle)
        self.stop()

    def stop(self):
        Stat(self).save()
        name = current_process().name
        logger.info(_("%(name)s stopping cluster processes") % {"name": name})
        # Stopping pusher
        self.event_out.set()
        # Wait for it to stop
        while self.pusher.is_alive():
            sleep(0.1)
            Stat(self).save()
        # Put poison pills in the queue
        for __ in range(len(self.pool)):
            self.task_queue.put("STOP")
        self.task_queue.close()
        # wait for the task queue to empty
        self.task_queue.join_thread()
        # Wait for all the workers to exit
        while len(self.pool):
            for p in self.pool:
                if not p.is_alive():
                    self.pool.remove(p)
            sleep(0.1)
            Stat(self).save()
        # Finally stop the monitor
        self.result_queue.put("STOP")
        self.result_queue.close()
        # Wait for the result queue to empty
        self.result_queue.join_thread()
        logger.info(_("%(name)s waiting for the monitor.") % {"name": name})
        # Wait for everything to close or time out
        count = 0
        if not self.timeout:
            self.timeout = 30
        while self.status() == Conf.STOPPING and count < self.timeout * 10:
            sleep(0.1)
            Stat(self).save()
            count += 1
        # Final status
        Stat(self).save()


def set_cpu_affinity(n: int, process_ids: list, actual: bool = not Conf.TESTING):
    """
    Sets the cpu affinity for the supplied processes.
    Requires the optional psutil module.
    :param int n: affinity
    :param list process_ids: a list of pids
    :param bool actual: Test workaround for Travis not supporting cpu affinity
    """
    # check if we have the psutil module
    if not psutil:
        logger.warning(_("Skipping cpu affinity because psutil was not found."))
        return
    # check if the platform supports cpu_affinity
    if actual and not hasattr(psutil.Process(process_ids[0]), "cpu_affinity"):
        logger.warning(
            _("Faking cpu affinity because it is not supported on this platform")
        )
        actual = False
    # get the available processors
    cpu_list = list(range(psutil.cpu_count()))
    # affinities of 0 or gte cpu_count, equals to no affinity
    if not n or n >= len(cpu_list):
        return
    # spread the workers over the available processors.
    index = 0
    for pid in process_ids:
        affinity = []
        for k in range(n):
            if index == len(cpu_list):
                index = 0
            affinity.append(cpu_list[index])
            index += 1
        if psutil.pid_exists(pid):
            p = psutil.Process(pid)
            if actual:
                p.cpu_affinity(affinity)
            logger.info(
                _("%(pid)s will use cpu %(affinity)s")
                % {"pid": pid, "affinity": affinity}
            )
