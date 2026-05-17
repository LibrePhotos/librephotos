import calendar
import inspect
from datetime import date, datetime

import django
from django import db
from django.conf import settings
from django.utils import timezone

from django_q.conf import Conf, logger

if django.VERSION < (4, 0):
    # pytz is the default in django 3.2. Remove when no support for 3.2
    from pytz import timezone as ZoneInfo
else:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo


# credits: https://stackoverflow.com/a/4131114
# Made them aware of timezone
def add_months(d, months):
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


# credits: https://stackoverflow.com/a/15743908
# Changed the last line to make it a little easier to read and changed it to move
# February 29 to 28 next year.
def add_years(d, years):
    """Return a date that's `years` years after the date (or datetime)
    object `d`. Return the same calendar date (month and day) in the
    destination year, if it exists, otherwise use the previous day
    (thus changing February 29 to February 28).
    """
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        new_date = d + (date(d.year + years, 3, 1) - date(d.year, 3, 1))
        return d.replace(year=new_date.year, month=new_date.month, day=new_date.day)


def get_func_repr(func):
    # convert func to string
    if inspect.isfunction(func):
        return f"{func.__module__}.{func.__name__}"
    elif inspect.ismethod(func) and hasattr(func.__self__, "__name__"):
        return f"{func.__self__.__module__}.{func.__self__.__name__}.{func.__name__}"
    else:
        return str(func) if func else None


def localtime(value=None) -> datetime:
    """Override for timezone.localtime to deal with naive times and local times"""
    if settings.USE_TZ:
        if django.VERSION >= (4, 0) and getattr(settings, "USE_DEPRECATED_PYTZ", False):
            import pytz

            convert_to_tz = pytz.timezone(Conf.TIME_ZONE)
        else:
            convert_to_tz = ZoneInfo(Conf.TIME_ZONE)

        return timezone.localtime(value=value, timezone=convert_to_tz)
    if value is None:
        return datetime.now()
    else:
        return value


def close_old_django_connections():
    """
    Close django connections unless running with sync=True.
    """
    if Conf.SYNC:
        logger.warning(
            "Preserving django database connections because sync=True. Beware "
            "that tasks are now injected in the calling context/transactions "
            "which may result in unexpected behaviour."
        )
    else:
        db.close_old_connections()
