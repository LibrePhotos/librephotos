import logging
import os
import signal
import sys
from copy import deepcopy
from multiprocessing import cpu_count
from warnings import warn

from django.conf import settings
from django.utils.translation import gettext_lazy as _

from django_q.queues import Queue

# The "selectable" entry points were introduced in importlib_metadata 3.6 and Python 3.10.
if sys.version_info < (3, 10):
    from importlib_metadata import entry_points
else:
    from importlib.metadata import entry_points

# optional
try:
    import psutil
except ImportError:
    psutil = None

try:
    from croniter import croniter
except ImportError:
    croniter = None

try:
    import resource
except ModuleNotFoundError:
    resource = None

try:
    import setproctitle
except ModuleNotFoundError:
    setproctitle = None

try:
    from prometheus_client import multiprocess as prometheus_multiprocess
except ModuleNotFoundError:
    prometheus_multiprocess = None


class Conf:
    """
    Configuration class
    """

    try:
        conf = settings.Q_CLUSTER.copy()
    except AttributeError:
        conf = {}

    _Q_CLUSTER_NAME = os.getenv("Q_CLUSTER_NAME")
    if (
        _Q_CLUSTER_NAME
        and _Q_CLUSTER_NAME != conf.get("name")
        and _Q_CLUSTER_NAME != conf.get("cluster_name")
    ):
        conf["cluster_name"] = _Q_CLUSTER_NAME
        alt_conf = conf.pop("ALT_CLUSTERS")
        if isinstance(alt_conf, dict):
            alt_conf = alt_conf.get(_Q_CLUSTER_NAME)
            if isinstance(alt_conf, dict):
                alt_conf.pop("name", None)
                alt_conf.pop("cluster_name", None)
                conf.update(alt_conf)

    # Redis server configuration . Follows standard redis keywords
    REDIS = conf.get("redis", {})

    # Support for Django-Redis connections

    DJANGO_REDIS = conf.get("django_redis", None)

    # IronMQ broker
    IRON_MQ = conf.get("iron_mq", None)

    # SQS broker
    SQS = conf.get("sqs", None)

    # ORM broker
    ORM = conf.get("orm", None)

    # Custom broker class
    BROKER_CLASS = conf.get("broker_class", None)

    # Database Poll
    POLL = conf.get("poll", 0.2)

    # MongoDB broker
    MONGO = conf.get("mongo", None)
    MONGO_DB = conf.get("mongo_db", None)

    # Name of the cluster or site. For when you run multiple sites on one redis server
    # It's also the `salt` for signing OrmQ, and part of the Redis stats caching key
    # For all clusters in one site, PREFIX should be the same value to be able to decrypt payloads
    PREFIX = conf.get("name", "default")

    # Support alternative cluster name to use multiple queues in one site.
    #   cluster name and queue name are interchangeable, same thing.
    CLUSTER_NAME = conf.get("cluster_name", PREFIX)

    # Log output level
    LOG_LEVEL = conf.get("log_level", "INFO")

    # Maximum number of successful tasks kept in the database. 0 saves everything.
    # -1 saves none
    # Failures are always saved
    SAVE_LIMIT = conf.get("save_limit", 250)

    # save-limit can be set per Task's "group" or "name" or "func"
    SAVE_LIMIT_PER = conf.get("save_limit_per", None)

    # Verify SAVE_LIMIT_PER is valid
    if SAVE_LIMIT_PER not in ["group", "name", "func", None]:
        warn(
            _(
                "SAVE_LIMIT_PER (%(option)s) is not a valid option. Options are: "
                "'group', 'name', 'func' and None. Default is None."
            )
            % {"option": SAVE_LIMIT_PER}
        )

    # Guard loop sleep in seconds. Should be between 0 and 60 seconds.
    GUARD_CYCLE = conf.get("guard_cycle", 0.5)

    # Disable the scheduler
    SCHEDULER = conf.get("scheduler", True)

    # Number of workers in the pool. Default is cpu count if implemented, otherwise 4.
    WORKERS = conf.get("workers", False)
    if not WORKERS:
        try:
            WORKERS = cpu_count()
            # in rare cases this might fail
        except NotImplementedError:
            # try psutil
            if psutil:
                WORKERS = psutil.cpu_count() or 4
            else:
                # sensible default
                WORKERS = 4

    # Option to undaemonize the workers and allow them to spawn child processes
    DAEMONIZE_WORKERS = conf.get("daemonize_workers", True)

    # Maximum number of tasks that each cluster can work on
    QUEUE_LIMIT = conf.get("queue_limit", int(WORKERS) ** 2)

    # Sets compression of redis packages
    COMPRESSED = conf.get("compress", False)

    # Number of tasks each worker can handle before it gets recycled.
    # Useful for releasing memory
    RECYCLE = conf.get("recycle", 500)

    # The maximum resident set size in kilobytes before a worker will recycle.
    # Useful for limiting memory usage. Not available on all platforms
    MAX_RSS = conf.get("max_rss", None)

    # Number of seconds to wait for a worker to finish.
    TIMEOUT = conf.get("timeout", None)

    # Whether to acknowledge unsuccessful tasks.
    # This causes failed tasks to be considered delivered, thereby removing them from
    # the task queue. Defaults to False.
    ACK_FAILURES = conf.get("ack_failures", False)

    # Number of seconds to wait for acknowledgement before retrying a task
    # Only works with brokers that guarantee delivery. Defaults to 60 seconds.
    RETRY = conf.get("retry", 60)

    # Verify if retry and timeout settings are correct
    if not TIMEOUT or (TIMEOUT > RETRY):
        warn(
            "Retry and timeout are misconfigured. Set retry larger than timeout,"
            "failure to do so will cause the tasks to be retriggered before completion."
            "See https://django-q2.readthedocs.io/en/master/configure.html#retry "
            "for details."
        )

    # Sets the amount of tasks the cluster will try to pop off the broker.
    # If it supports bulk gets.
    BULK = conf.get("bulk", 1)

    # Minimum delay in seconds between tasks becoming available on this queue.
    THROTTLE = max(0.0, float(conf.get("throttle", 0) or 0))

    # The Django Admin label for this app
    LABEL = conf.get("label", "Django Q")

    # Sets the number of processors for each worker, defaults to all.
    CPU_AFFINITY = conf.get("cpu_affinity", 0)

    # Global sync option to for debugging
    SYNC = conf.get("sync", False)

    # The Django cache to use
    CACHE = conf.get("cache", "default")

    # Use the cache as result backend. Can be 'True' or an integer representing the
    # global cache timeout.
    # i.e 'cached: 60' , will make all results go the cache and expire in 60 seconds.
    CACHED = conf.get("cached", False)

    # If set to False the scheduler won't execute tasks in the past.
    # Instead it will run once and reschedule the next run in the future. Defaults to
    # True.
    CATCH_UP = conf.get("catch_up", True)

    # Use the secret key for package signing
    # Django itself should raise an error if it's not configured
    SECRET_KEY = settings.SECRET_KEY

    # The redis stats key
    Q_STAT = f"django_q:{PREFIX}:cluster"

    # Optional error reporting setup
    ERROR_REPORTER = conf.get("error_reporter", {})

    # Optional attempt count. set to 0 for infinite attempts
    MAX_ATTEMPTS = conf.get("max_attempts", 0)

    # OSX doesn't implement qsize because of missing sem_getvalue()
    try:
        QSIZE = Queue().qsize() == 0
    except (NotImplementedError, OSError):
        QSIZE = False

    # Getting the signal names
    SIGNAL_NAMES = dict(
        (getattr(signal, n), n)
        for n in dir(signal)
        if n.startswith("SIG") and "_" not in n
    )

    # Translators: Cluster status descriptions
    STARTING = _("Starting")
    WORKING = _("Working")
    IDLE = _("Idle")
    STOPPED = _("Stopped")
    STOPPING = _("Stopping")

    # to manage workarounds during testing
    TESTING = conf.get("testing", False)

    # Timezone for next_run, overrules Django timezone
    TIME_ZONE = None
    if settings.USE_TZ:
        TIME_ZONE = conf.get("time_zone", settings.TIME_ZONE)


# logger
logger = logging.getLogger("django-q")

# Set up standard logging handler in case there is none
if not logger.hasHandlers():
    logger.setLevel(level=getattr(logging, Conf.LOG_LEVEL))
    logger.propagate = False
    formatter = logging.Formatter(
        fmt="%(asctime)s [Q] %(levelname)s %(message)s", datefmt="%H:%M:%S"
    )
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)


# Error Reporting Interface
class ErrorReporter:
    # initialize with iterator of reporters (better name, targets?)
    def __init__(self, reporters):
        self.targets = [target for target in reporters]

    # report error to all configured targets
    def report(self):
        for t in self.targets:
            t.report()


# error reporting setup (sentry or rollbar)
if Conf.ERROR_REPORTER:
    error_conf = deepcopy(Conf.ERROR_REPORTER)
    try:
        reporters = []
        # iterate through the configured error reporters,
        # and instantiate an ErrorReporter using the provided config
        for name, conf in error_conf.items():
            for entry in entry_points(group="djangoq.errorreporters", name=name):
                Reporter = entry.load()
                reporters.append(Reporter(**conf))
        error_reporter = ErrorReporter(reporters)
    except ImportError:
        error_reporter = None
else:
    error_reporter = None


# get parent pid compatibility
def get_ppid():
    if hasattr(os, "getppid"):
        return os.getppid()
    elif psutil:
        return psutil.Process(os.getpid()).ppid()
    else:
        raise OSError(
            "Your OS does not support `os.getppid`. Please install `psutil` as an "
            "alternative provider."
        )
