import signal

from django.utils.translation import gettext_lazy as _

from django_q.conf import logger

from .exceptions import TimeoutException


class TimeoutHandler:
    def __init__(self, timeout: int):
        self._timeout = timeout

    def raise_timeout_exception(self, signum, frame):
        raise TimeoutException(
            f"Task exceeded maximum timeout value ({self._timeout} seconds)"
        )

    def __enter__(self):
        # if the timeout is -1, then there is no timeout and the task will always keep running until it's done or manually killed
        if self._timeout == -1:
            return
        try:
            signal.signal(signal.SIGALRM, self.raise_timeout_exception)
            signal.alarm(self._timeout)
        except (
            ValueError,
            AttributeError,
        ):  # AttributeError or ValueError might be raised for Windows users
            logger.debug(_("SIGALARM is not available on your platform"))

    def __exit__(self, exc_type, exc_value, traceback):
        if self._timeout == -1:
            return
        """When getting out of the timeout, reset the alarm, so it won't trigger"""
        try:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, signal.SIG_DFL)
        except (
            ValueError,
            AttributeError,
        ):  # AttributeError or ValueError might be raised for Windows users
            logger.debug(_("SIGALARM is not available on your platform"))
