from datetime import timedelta

# django
from django.db import connection
from django.db.models import F, Sum
from django.utils import timezone
from django.utils.translation import gettext as _

from django_q import VERSION, models
from django_q.brokers import get_broker

# local
from django_q.conf import Conf
from django_q.status import Stat

# optional
try:
    import psutil
except ImportError:
    psutil = None


def get_process_mb(pid):
    try:
        process = psutil.Process(pid)
        mb_used = round(process.memory_info().rss / 1024**2, 2)
    except psutil.NoSuchProcess:
        mb_used = "NO_PROCESS_FOUND"
    return mb_used


BLESSED_INSTALL_MESSAGE = (
    "Blessed is not installed. Please install blessed to use this: "
    "https://pypi.org/project/blessed/"
)


def monitor(run_once=False, broker=None):
    if not broker:
        broker = get_broker()
    try:
        from blessed import Terminal

        term = Terminal()
    except ImportError:
        print(BLESSED_INSTALL_MESSAGE)
        return

    broker.ping()
    with term.fullscreen(), term.hidden_cursor(), term.cbreak():
        val = None
        start_width = int(term.width / 8)
        while val not in (
            "q",
            "Q",
        ):
            col_width = int(term.width / 8)
            # In case of resize
            if col_width != start_width:
                print(term.clear())
                start_width = col_width
            print(
                term.move(0, 0)
                + term.black_on_green(term.center(_("Host"), width=col_width - 1))
            )
            print(
                term.move(0, 1 * col_width)
                + term.black_on_green(term.center(_("Id"), width=col_width - 1))
            )
            print(
                term.move(0, 2 * col_width)
                + term.black_on_green(term.center(_("State"), width=col_width - 1))
            )
            print(
                term.move(0, 3 * col_width)
                + term.black_on_green(term.center(_("Pool"), width=col_width - 1))
            )
            print(
                term.move(0, 4 * col_width)
                + term.black_on_green(term.center(_("TQ"), width=col_width - 1))
            )
            print(
                term.move(0, 5 * col_width)
                + term.black_on_green(term.center(_("RQ"), width=col_width - 1))
            )
            print(
                term.move(0, 6 * col_width)
                + term.black_on_green(term.center(_("RC"), width=col_width - 1))
            )
            print(
                term.move(0, 7 * col_width)
                + term.black_on_green(term.center(_("Up"), width=col_width - 1))
            )
            i = 2
            stats = Stat.get_all(broker=broker)
            print(term.clear_eos())
            for stat in stats:
                status = stat.status
                # color status
                if stat.status == Conf.WORKING:
                    status = term.green(str(Conf.WORKING))
                elif stat.status == Conf.STOPPING:
                    status = term.yellow(str(Conf.STOPPING))
                elif stat.status == Conf.STOPPED:
                    status = term.red(str(Conf.STOPPED))
                elif stat.status == Conf.IDLE:
                    status = str(Conf.IDLE)
                # color q's
                tasks = str(stat.task_q_size)
                if stat.task_q_size > 0:
                    tasks = term.cyan(str(stat.task_q_size))
                    if Conf.QUEUE_LIMIT and stat.task_q_size == Conf.QUEUE_LIMIT:
                        tasks = term.green(str(stat.task_q_size))
                results = stat.done_q_size
                if results > 0:
                    results = term.cyan(str(results))
                # color workers
                workers = len(stat.workers)
                if workers < Conf.WORKERS:
                    workers = term.yellow(str(workers))
                # format uptime
                uptime = (timezone.now() - stat.tob).total_seconds()
                hours, remainder = divmod(uptime, 3600)
                minutes, seconds = divmod(remainder, 60)
                uptime = "%d:%02d:%02d" % (hours, minutes, seconds)
                # print to the terminal
                print(
                    term.move(i, 0)
                    + term.center(stat.host[: col_width - 1], width=col_width - 1)
                )
                print(
                    term.move(i, 1 * col_width)
                    + term.center(str(stat.cluster_id)[-8:], width=col_width - 1)
                )
                print(
                    term.move(i, 2 * col_width)
                    + term.center(status, width=col_width - 1)
                )
                print(
                    term.move(i, 3 * col_width)
                    + term.center(workers, width=col_width - 1)
                )
                print(
                    term.move(i, 4 * col_width)
                    + term.center(tasks, width=col_width - 1)
                )
                print(
                    term.move(i, 5 * col_width)
                    + term.center(results, width=col_width - 1)
                )
                print(
                    term.move(i, 6 * col_width)
                    + term.center(stat.reincarnations, width=col_width - 1)
                )
                print(
                    term.move(i, 7 * col_width)
                    + term.center(uptime, width=col_width - 1)
                )
                i += 1
            # bottom bar
            i += 1
            queue_size = broker.queue_size()
            lock_size = broker.lock_size()
            if lock_size:
                queue_size = f"{queue_size}({lock_size})"
            print(
                term.move(i, 0)
                + term.white_on_cyan(term.center(broker.info(), width=col_width * 2))
            )
            print(
                term.move(i, 2 * col_width)
                + term.black_on_cyan(term.center(_("Queued"), width=col_width))
            )
            print(
                term.move(i, 3 * col_width)
                + term.white_on_cyan(term.center(str(queue_size), width=col_width))
            )
            print(
                term.move(i, 4 * col_width)
                + term.black_on_cyan(term.center(_("Success"), width=col_width))
            )
            print(
                term.move(i, 5 * col_width)
                + term.white_on_cyan(
                    term.center(str(models.Success.objects.count()), width=col_width)
                )
            )
            print(
                term.move(i, 6 * col_width)
                + term.black_on_cyan(term.center(_("Failures"), width=col_width))
            )
            print(
                term.move(i, 7 * col_width)
                + term.white_on_cyan(
                    term.center(str(models.Failure.objects.count()), width=col_width)
                )
            )
            # for testing
            if run_once:
                return Stat.get_all(broker=broker)
            print(term.move(i + 2, 0) + term.center(_("[Press q to quit]")))
            val = term.inkey(timeout=1)


def info(broker=None):
    if not broker:
        broker = get_broker()
    try:
        from blessed import Terminal

        term = Terminal()
    except ImportError:
        print(BLESSED_INSTALL_MESSAGE)
        return

    broker.ping()
    stat = Stat.get_all(broker=broker)
    # general stats
    clusters = len(stat)
    workers = 0
    reincarnations = 0
    for cluster in stat:
        workers += len(cluster.workers)
        reincarnations += cluster.reincarnations
    # calculate tasks pm and avg exec time
    tasks_per = 0
    per = _("day")
    exec_time = 0
    last_tasks = models.Success.objects.filter(
        stopped__gte=timezone.now() - timedelta(hours=24)
    )
    tasks_per_day = last_tasks.count()
    if tasks_per_day > 0:
        # average execution time over the last 24 hours
        if connection.vendor != "sqlite":
            exec_time = last_tasks.aggregate(
                time_taken=Sum(F("stopped") - F("started"))
            )
            exec_time = exec_time["time_taken"].total_seconds() / tasks_per_day
        else:
            # can't sum timedeltas on sqlite
            for t in last_tasks:
                exec_time += t.time_taken()
            exec_time = exec_time / tasks_per_day
        # tasks per second/minute/hour/day in the last 24 hours
        if tasks_per_day > 24 * 60 * 60:
            tasks_per = tasks_per_day / (24 * 60 * 60)
            per = _("second")
        elif tasks_per_day > 24 * 60:
            tasks_per = tasks_per_day / (24 * 60)
            per = _("minute")
        elif tasks_per_day > 24:
            tasks_per = tasks_per_day / 24
            per = _("hour")
        else:
            tasks_per = tasks_per_day
    # print to terminal
    print(term.clear_eos())
    col_width = int(term.width / 6)
    print(
        term.black_on_green(
            term.center(
                _("-- %(prefix)s %(version)s on %(info)s --")
                % {
                    "prefix": Conf.PREFIX.capitalize(),
                    "version": ".".join(str(v) for v in VERSION),
                    "info": broker.info(),
                }
            )
        )
    )
    print(
        term.cyan(_("Clusters"))
        + term.move_x(1 * col_width)
        + term.white(str(clusters))
        + term.move_x(2 * col_width)
        + term.cyan(_("Workers"))
        + term.move_x(3 * col_width)
        + term.white(str(workers))
        + term.move_x(4 * col_width)
        + term.cyan(_("Restarts"))
        + term.move_x(5 * col_width)
        + term.white(str(reincarnations))
    )
    print(
        term.cyan(_("Queued"))
        + term.move_x(1 * col_width)
        + term.white(str(broker.queue_size()))
        + term.move_x(2 * col_width)
        + term.cyan(_("Successes"))
        + term.move_x(3 * col_width)
        + term.white(str(models.Success.objects.count()))
        + term.move_x(4 * col_width)
        + term.cyan(_("Failures"))
        + term.move_x(5 * col_width)
        + term.white(str(models.Failure.objects.count()))
    )
    print(
        term.cyan(_("Schedules"))
        + term.move_x(1 * col_width)
        + term.white(str(models.Schedule.objects.count()))
        + term.move_x(2 * col_width)
        + term.cyan(_("Tasks/%(per)s") % {"per": per})
        + term.move_x(3 * col_width)
        + term.white(f"{tasks_per:.2f}")
        + term.move_x(4 * col_width)
        + term.cyan(_("Avg time"))
        + term.move_x(5 * col_width)
        + term.white(f"{exec_time:.4f}")
    )
    return True


def memory(run_once=False, workers=False, broker=None):
    if not broker:
        broker = get_broker()
    try:
        from blessed import Terminal

        term = Terminal()
    except ImportError:
        print(BLESSED_INSTALL_MESSAGE)
        return
    broker.ping()
    if not psutil:
        print(term.clear_eos())
        print(
            term.white_on_red(
                'Cannot start "qmemory" command. Missing "psutil" library.'
            )
        )
        return
    with term.fullscreen(), term.hidden_cursor(), term.cbreak():
        MEMORY_AVAILABLE_LOWEST_PERCENTAGE = 100.0
        MEMORY_AVAILABLE_LOWEST_PERCENTAGE_AT = timezone.now()
        cols = 8
        val = None
        start_width = int(term.width / cols)
        while val not in ["q", "Q"]:
            col_width = int(term.width / cols)
            # In case of resize
            if col_width != start_width:
                print(term.clear())
                start_width = col_width
            # sentinel, monitor and workers memory usage
            print(
                term.move(0, 0 * col_width)
                + term.black_on_green(term.center(_("Host"), width=col_width - 1))
            )
            print(
                term.move(0, 1 * col_width)
                + term.black_on_green(term.center(_("Id"), width=col_width - 1))
            )
            print(
                term.move(0, 2 * col_width)
                + term.black_on_green(
                    term.center(_("Available (%)"), width=col_width - 1)
                )
            )
            print(
                term.move(0, 3 * col_width)
                + term.black_on_green(
                    term.center(_("Available (MB)"), width=col_width - 1)
                )
            )
            print(
                term.move(0, 4 * col_width)
                + term.black_on_green(term.center(_("Total (MB)"), width=col_width - 1))
            )
            print(
                term.move(0, 5 * col_width)
                + term.black_on_green(
                    term.center(_("Sentinel (MB)"), width=col_width - 1)
                )
            )
            print(
                term.move(0, 6 * col_width)
                + term.black_on_green(
                    term.center(_("Monitor (MB)"), width=col_width - 1)
                )
            )
            print(
                term.move(0, 7 * col_width)
                + term.black_on_green(
                    term.center(_("Workers (MB)"), width=col_width - 1)
                )
            )
            row = 2
            stats = Stat.get_all(broker=broker)
            print(term.clear_eos())
            for stat in stats:
                # memory available (%)
                memory_available_percentage = round(
                    psutil.virtual_memory().available
                    * 100
                    / psutil.virtual_memory().total,
                    2,
                )
                # memory available (MB)
                memory_available = round(psutil.virtual_memory().available / 1024**2, 2)
                if memory_available_percentage < MEMORY_AVAILABLE_LOWEST_PERCENTAGE:
                    MEMORY_AVAILABLE_LOWEST_PERCENTAGE = memory_available_percentage
                    MEMORY_AVAILABLE_LOWEST_PERCENTAGE_AT = timezone.now()
                print(
                    term.move(row, 0 * col_width)
                    + term.center(stat.host[: col_width - 1], width=col_width - 1)
                )
                print(
                    term.move(row, 1 * col_width)
                    + term.center(str(stat.cluster_id)[-8:], width=col_width - 1)
                )
                print(
                    term.move(row, 2 * col_width)
                    + term.center(memory_available_percentage, width=col_width - 1)
                )
                print(
                    term.move(row, 3 * col_width)
                    + term.center(memory_available, width=col_width - 1)
                )
                print(
                    term.move(row, 4 * col_width)
                    + term.center(
                        round(psutil.virtual_memory().total / 1024**2, 2),
                        width=col_width - 1,
                    )
                )
                print(
                    term.move(row, 5 * col_width)
                    + term.center(get_process_mb(stat.sentinel), width=col_width - 1)
                )
                print(
                    term.move(row, 6 * col_width)
                    + term.center(
                        get_process_mb(getattr(stat, "monitor", None)),
                        width=col_width - 1,
                    )
                )
                workers_mb = 0
                for worker_pid in stat.workers:
                    result = get_process_mb(worker_pid)
                    if isinstance(result, str):
                        result = 0
                    workers_mb += result
                print(
                    term.move(row, 7 * col_width)
                    + term.center(
                        workers_mb or "NO_PROCESSES_FOUND", width=col_width - 1
                    )
                )
                row += 1
            # each worker's memory usage
            if workers:
                row += 2
                col_width = int(term.width / (1 + Conf.WORKERS))
                print(
                    term.move(row, 0 * col_width)
                    + term.black_on_cyan(term.center(_("Id"), width=col_width - 1))
                )
                for worker_num in range(Conf.WORKERS):
                    print(
                        term.move(row, (worker_num + 1) * col_width)
                        + term.black_on_cyan(
                            term.center(
                                "Worker #{} (MB)".format(worker_num + 1),
                                width=col_width - 1,
                            )
                        )
                    )
                row += 2
                for stat in stats:
                    print(
                        term.move(row, 0 * col_width)
                        + term.center(str(stat.cluster_id)[-8:], width=col_width - 1)
                    )
                    for idx, worker_pid in enumerate(stat.workers):
                        mb_used = get_process_mb(worker_pid)
                        print(
                            term.move(row, (idx + 1) * col_width)
                            + term.center(mb_used, width=col_width - 1)
                        )
                    row += 1
            row += 1
            print(
                term.move(row, 0)
                + _("Available lowest (): %(memory_percent)s ((at)s)")
                % {
                    "memory_percent": str(MEMORY_AVAILABLE_LOWEST_PERCENTAGE),
                    "at": MEMORY_AVAILABLE_LOWEST_PERCENTAGE_AT.strftime(
                        "%Y-%m-%d %H:%M:%S+00:00"
                    ),
                }
            )
            # for testing
            if run_once:
                return Stat.get_all(broker=broker)
            print(term.move(row + 2, 0) + term.center(_("[Press q to quit]")))
            val = term.inkey(timeout=1)


def get_ids():
    # prints id (PID) of running clusters
    stat = Stat.get_all()
    if stat:
        for s in stat:
            print(s.cluster_id)
    else:
        print(_("No clusters appear to be running."))
    return True
