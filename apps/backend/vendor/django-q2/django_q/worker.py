import pydoc
import traceback
from multiprocessing import Value
from multiprocessing.process import current_process
from multiprocessing.queues import Queue

from django import core
from django.apps.registry import apps
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

try:
    apps.check_apps_ready()
except core.exceptions.AppRegistryNotReady:
    import django

    django.setup()

from django_q.conf import Conf, error_reporter, logger, resource, setproctitle
from django_q.exceptions import TimeoutException
from django_q.signals import post_execute_in_worker, post_spawn, pre_execute
from django_q.timeout import TimeoutHandler
from django_q.utils import close_old_django_connections, get_func_repr

try:
    import psutil
except ImportError:
    psutil = None

try:
    import setproctitle
except ModuleNotFoundError:
    setproctitle = None


def worker(
    task_queue: Queue, result_queue: Queue, timer: Value, timeout: int = Conf.TIMEOUT
):
    """
    Takes a task from the task queue, tries to execute it and puts the result back in
    the result queue
    :param timeout: number of seconds wait for a worker to finish.
    :type task_queue: multiprocessing.Queue
    :type result_queue: multiprocessing.Queue
    :type timer: multiprocessing.Value
    """
    proc_name = current_process().name
    logger.info(
        _("%(proc_name)s ready for work at %(id)s")
        % {"proc_name": proc_name, "id": current_process().pid}
    )
    post_spawn.send(sender="django_q", proc_name=proc_name)
    if setproctitle:
        setproctitle.setproctitle(f"qcluster {proc_name} idle")
    task_count = 0
    if timeout is None:
        timeout = -1
    # Start reading the task queue
    for task in iter(task_queue.get, "STOP"):
        result = None
        timer.value = -1  # Idle
        task_count += 1
        f = task["func"]

        # Log task creation and set process name
        # Get the function from the task
        func_name = get_func_repr(f)
        task_name = task["name"]
        task_desc = _("%(proc_name)s processing %(task_name)s '%(func_name)s'") % {
            "proc_name": proc_name,
            "func_name": func_name,
            "task_name": task_name,
        }
        if "group" in task:
            task_desc += f" [{task['group']}]"
        logger.info(task_desc)

        if setproctitle:
            proc_title = f"qcluster {proc_name} processing {task_name} '{func_name}'"
            if "group" in task:
                proc_title += f" [{task['group']}]"
            setproctitle.setproctitle(proc_title)

        # if it's not an instance try to get it from the string
        if not callable(f):
            # locate() returns None if f cannot be loaded
            f = pydoc.locate(f)
        if not task.get("sync", False):
            close_old_django_connections()
        timer_value = task.pop("timeout", timeout)
        # signal execution
        pre_execute.send(sender="django_q", func=f, task=task)
        # execute the payload
        timer.value = timer_value  # Busy
        if timer.value != -1:
            timer.value += 3  # Add buffer so that guard doesn't kill the process on timeout before it gets processed

        timeout_error = False
        try:
            if f is None:
                # raise a meaningfull error if task["func"] is not a valid function
                raise ValueError(f"Function {task['func']} is not defined")
            with TimeoutHandler(timer_value):
                res = f(*task["args"], **task["kwargs"])
            result = (res, True)
        except (Exception, TimeoutException) as e:
            if isinstance(e, TimeoutException):
                timeout_error = True
            result = (f"{e} : {traceback.format_exc()}", False)
            if error_reporter:
                error_reporter.report()
            if task.get("sync", False):
                post_execute_in_worker.send(sender="django_q", func=f, task=task)
                raise

        with timer.get_lock():
            # Process result
            task["result"] = result[0]
            task["success"] = result[1]
            task["stopped"] = timezone.now()
            post_execute_in_worker.send(sender="django_q", func=f, task=task)
            result_queue.put(task)
            if timeout_error:
                # force destroy process due to timeout
                timer.value = 0
                break

            timer.value = -1  # Idle
            if setproctitle:
                setproctitle.setproctitle(f"qcluster {proc_name} idle")
            # Recycle
            if task_count == Conf.RECYCLE or rss_check():
                timer.value = -2  # Recycled
                break
    logger.info(_("%(proc_name)s stopped doing work") % {"proc_name": proc_name})


def rss_check():
    if Conf.MAX_RSS:
        if resource:
            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss >= Conf.MAX_RSS
        elif psutil:
            return psutil.Process().memory_info().rss >= Conf.MAX_RSS * 1024
    return False
