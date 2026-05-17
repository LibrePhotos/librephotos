from datetime import datetime, timedelta
from keyword import iskeyword

# Django
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.urls import reverse
from django.utils import timezone
from django.utils.functional import cached_property
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

# External
from picklefield import PickledObjectField

# Local
from django_q.conf import croniter
from django_q.signing import SignedPackage
from django_q.utils import add_months, add_years, localtime

from .utils import get_func_repr


class Task(models.Model):
    id = models.CharField(
        max_length=32,
        primary_key=True,
        editable=False,
        verbose_name=_("Task id"),
        help_text=_("32-character task identifier."),
    )
    name = models.CharField(
        max_length=100,
        editable=False,
        verbose_name=_("Name"),
        help_text=_("Optional human-readable name for lookup and display."),
    )
    func = models.CharField(
        max_length=256,
        verbose_name=_("Function"),
        help_text=_("Dotted import path to the callable, e.g. myapp.tasks.job."),
    )
    hook = models.CharField(
        max_length=256,
        null=True,
        verbose_name=_("Hook"),
        help_text=_(
            "Optional dotted path to a callback that receives the task result."
        ),
    )
    args = PickledObjectField(
        null=True,
        protocol=-1,
        verbose_name=_("Arguments"),
        help_text=_("Pickled positional arguments (tuple)."),
    )
    kwargs = PickledObjectField(
        null=True,
        protocol=-1,
        verbose_name=_("Keyword arguments"),
        help_text=_("Pickled keyword arguments (dict)."),
    )
    result = PickledObjectField(
        null=True,
        protocol=-1,
        verbose_name=_("Result"),
        help_text=_("Pickled return value or error payload."),
    )
    group = models.CharField(
        max_length=100,
        editable=False,
        null=True,
        verbose_name=_("Group"),
        help_text=_("Optional group id to aggregate related tasks."),
    )
    cluster = models.CharField(
        max_length=100,
        default=None,
        null=True,
        blank=True,
        verbose_name=_("Cluster"),
        help_text=_("Name of the cluster that executed this task."),
    )
    started = models.DateTimeField(
        editable=False,
        verbose_name=_("Started at"),
        help_text=_("When the worker started executing the task."),
    )
    stopped = models.DateTimeField(
        editable=False,
        verbose_name=_("Stopped at"),
        help_text=_("When the worker finished (success or failure)."),
    )
    success = models.BooleanField(
        default=True,
        editable=False,
        verbose_name=_("Success"),
        help_text=_("False if the task raised an exception or timed out."),
    )
    attempt_count = models.IntegerField(
        default=0,
        verbose_name=_("Attempt count"),
        help_text=_("How many times execution was attempted."),
    )

    @staticmethod
    def get_result(task_id):
        if len(task_id) == 32 and Task.objects.filter(id=task_id).exists():
            return Task.objects.get(id=task_id).result
        elif Task.objects.filter(name=task_id).exists():
            return Task.objects.get(name=task_id).result

    @staticmethod
    def get_result_group(group_id, failures=False):
        if failures:
            values = Task.objects.filter(group=group_id).values_list(
                "result", flat=True
            )
        else:
            values = (
                Task.objects.filter(group=group_id)
                .exclude(success=False)
                .values_list("result", flat=True)
            )
        return values

    def group_result(self, failures=False):
        if self.group:
            return self.get_result_group(self.group, failures)

    @staticmethod
    def get_group_count(group_id, failures=False):
        if failures:
            return Failure.objects.filter(group=group_id).count()
        return Task.objects.filter(group=group_id).count()

    def group_count(self, failures=False):
        if self.group:
            return self.get_group_count(self.group, failures)

    @staticmethod
    def delete_group(group_id, objects=False):
        group = Task.objects.filter(group=group_id)
        if objects:
            return group.delete()
        return group.update(group=None)

    def group_delete(self, tasks=False):
        if self.group:
            return self.delete_group(self.group, tasks)

    @staticmethod
    def get_task(task_id):
        if len(task_id) == 32 and Task.objects.filter(id=task_id).exists():
            return Task.objects.get(id=task_id)
        elif Task.objects.filter(name=task_id).exists():
            return Task.objects.get(name=task_id)

    @staticmethod
    def get_task_group(group_id, failures=True):
        if failures:
            return Task.objects.filter(group=group_id)
        return Task.objects.filter(group=group_id).exclude(success=False)

    def time_taken(self):
        return (self.stopped - self.started).total_seconds()

    def __str__(self):
        return f"{self.name or self.id}"

    class Meta:
        app_label = "django_q"
        verbose_name = _("Task")
        verbose_name_plural = _("Tasks")
        ordering = ["-stopped"]
        indexes = [
            models.Index(
                name="success_index",
                fields=["group", "name", "func"],
                condition=Q(success=True),
            ),
        ]


class SuccessManager(models.Manager):
    def get_queryset(self):
        return super(SuccessManager, self).get_queryset().filter(success=True)


class Success(Task):
    objects = SuccessManager()

    class Meta:
        app_label = "django_q"
        verbose_name = _("Successful task")
        verbose_name_plural = _("Successful tasks")
        ordering = ["-stopped"]
        proxy = True


class FailureManager(models.Manager):
    def get_queryset(self):
        return super(FailureManager, self).get_queryset().filter(success=False)


class Failure(Task):
    objects = FailureManager()

    class Meta:
        app_label = "django_q"
        verbose_name = _("Failed task")
        verbose_name_plural = _("Failed tasks")
        ordering = ["-stopped"]
        proxy = True


# Optional Cron validator
def validate_cron(value):
    if not croniter:
        raise ImportError(_("Please install croniter to enable cron expressions"))
    try:
        croniter.expand(value)
    except ValueError as e:
        raise ValidationError(e)


def validate_kwarg(value):
    return value.isidentifier() and not iskeyword(value)


class Schedule(models.Model):
    name = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        verbose_name=_("Name"),
        help_text=_("Optional label to identify this schedule in the admin."),
    )
    func = models.CharField(
        max_length=256,
        verbose_name=_("Function"),
        help_text=_("e.g. module.tasks.function"),
    )
    hook = models.CharField(
        max_length=256,
        null=True,
        blank=True,
        verbose_name=_("Hook"),
        help_text=_("e.g. module.tasks.result_function"),
    )
    args = models.TextField(
        null=True,
        blank=True,
        verbose_name=_("Arguments"),
        help_text=_("e.g. 1, 2, 'John'"),
    )
    kwargs = models.TextField(
        null=True,
        blank=True,
        verbose_name=_("Keyword arguments"),
        help_text=_("e.g. x=1, y=2, name='John'"),
    )
    ONCE = "O"
    MINUTES = "I"
    HOURLY = "H"
    DAILY = "D"
    WEEKLY = "W"
    BIWEEKLY = "BW"
    MONTHLY = "M"
    BIMONTHLY = "BM"
    QUARTERLY = "Q"
    YEARLY = "Y"
    CRON = "C"
    TYPE = (
        (ONCE, _("Once")),
        (MINUTES, _("Minutes")),
        (HOURLY, _("Hourly")),
        (DAILY, _("Daily")),
        (WEEKLY, _("Weekly")),
        (BIWEEKLY, _("Biweekly")),
        (MONTHLY, _("Monthly")),
        (BIMONTHLY, _("Bimonthly")),
        (QUARTERLY, _("Quarterly")),
        (YEARLY, _("Yearly")),
        (CRON, _("Cron")),
    )
    schedule_type = models.CharField(
        max_length=2,
        choices=TYPE,
        default=TYPE[0][0],
        verbose_name=_("Schedule Type"),
        help_text=_("How often this task should be enqueued."),
    )
    minutes = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name=_("Minutes"),
        help_text=_("Number of minutes for the Minutes type"),
    )
    repeats = models.IntegerField(
        default=-1, verbose_name=_("Repeats"), help_text=_("n = n times, -1 = forever")
    )
    next_run = models.DateTimeField(
        verbose_name=_("Next Run"),
        help_text=_("When this schedule runs next (stored in UTC)."),
        default=timezone.now,
        null=True,
    )
    cron = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        validators=[validate_cron],
        verbose_name=_("Cron"),
        help_text=_("Cron expression"),
    )
    task = models.CharField(
        max_length=100,
        null=True,
        editable=False,
        verbose_name=_("Last task id"),
        help_text=_("Id of the last task spawned from this schedule (read-only)."),
    )
    cluster = models.CharField(
        max_length=100,
        default=None,
        null=True,
        blank=True,
        verbose_name=_("Cluster"),
        help_text=_("Name of the target cluster"),
    )
    intended_date_kwarg = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        validators=[validate_kwarg],
        verbose_name=_("Intended date kwarg"),
        help_text=_("Name of kwarg to pass intended schedule date"),
    )

    def calculate_next_run(self, next_run=None):
        # next run is always in UTC
        next_run = next_run or self.next_run

        if self.schedule_type == self.CRON:
            if not croniter:
                raise ImportError(
                    _("Please install croniter to enable cron expressions")
                )
            return croniter(self.cron, localtime()).get_next(datetime)

        if self.schedule_type == self.MINUTES:
            add = timedelta(minutes=(self.minutes or 1))
        elif self.schedule_type == self.HOURLY:
            add = timedelta(hours=1)
        elif self.schedule_type == self.DAILY:
            add = timedelta(days=1)
        elif self.schedule_type == self.WEEKLY:
            add = timedelta(weeks=1)
        elif self.schedule_type == self.BIWEEKLY:
            add = timedelta(weeks=2)
        elif self.schedule_type == self.MONTHLY:
            add = timedelta(days=(add_months(next_run, 1) - next_run).days)
        elif self.schedule_type == self.BIMONTHLY:
            add = timedelta(days=(add_months(next_run, 2) - next_run).days)
        elif self.schedule_type == self.QUARTERLY:
            add = timedelta(days=(add_months(next_run, 3) - next_run).days)
        elif self.schedule_type == self.YEARLY:
            add = timedelta(days=(add_years(next_run, 1) - next_run).days)

        # add normal timedelta, we will correct this later based on timezone
        next_run += add

        # DST differencers don't matter with minutes, hourly or yearly, so skip those
        if self.schedule_type not in [self.MINUTES, self.HOURLY, self.YEARLY]:
            # Get localtimes and then remove the tzinfo, so we can get the actual difference
            current_next_run = localtime(next_run - add).replace(tzinfo=None)
            new_next_run = localtime(next_run).replace(tzinfo=None)

            # get the difference between them, this should be (-)1 or (-)0.5 hour
            # based on DST active or not
            extra_diff = (new_next_run - current_next_run) - add

            # subtract difference
            next_run -= extra_diff

        return next_run

    def success(self):
        if self.task and Task.objects.filter(id=self.task):
            return Task.objects.get(id=self.task).success

    def last_run(self):
        if self.task and Task.objects.filter(id=self.task):
            task = Task.objects.get(id=self.task)
            if task.success:
                url = reverse("admin:django_q_success_change", args=(task.id,))
            else:
                url = reverse("admin:django_q_failure_change", args=(task.id,))
            return format_html('<a href="{}">[{}]</a>', url, task.name)
        return None

    def __str__(self):
        return self.func

    def save(self, *args, **kwargs):
        if self.pk is None and self.schedule_type == self.CRON:
            self.next_run = self.calculate_next_run()

        return super().save(*args, **kwargs)

    success.boolean = True
    success.short_description = _("success")
    last_run.allow_tags = True
    last_run.short_description = _("last_run")

    class Meta:
        app_label = "django_q"
        verbose_name = _("Scheduled task")
        verbose_name_plural = _("Scheduled tasks")
        ordering = ["next_run"]


class OrmQ(models.Model):
    key = models.CharField(
        max_length=100,
        verbose_name=_("Cluster key"),
        help_text=_("Name of the target cluster"),
    )
    payload = models.TextField(
        verbose_name=_("Payload"),
        help_text=_("Signed serialized task package (do not edit manually)."),
    )
    lock = models.DateTimeField(
        null=True,
        verbose_name=_("Lock until"),
        help_text=_("Prevent any cluster from pulling until"),
    )
    available_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name=_("Available at"),
        help_text=_("Prevent dequeue until this time"),
    )

    @cached_property
    def task(self):
        try:
            return SignedPackage.loads(self.payload)
        except Exception as e:
            return {"id": "*" + e.__class__.__name__}

    def func(self):
        return get_func_repr(self.task.get("func"))

    def task_id(self):
        return self.task.get("id")

    def name(self):
        return self.task.get("name")

    def group(self):
        return self.task.get("group")

    def args(self):
        return self.task.get("args")

    def kwargs(self):
        return self.task.get("kwargs")

    def q_options(self):
        exclude = {"id", "name", "group", "func", "args", "kwargs"}
        return {k: v for k, v in self.task.items() if k not in exclude}

    func.short_description = _("Function")
    task_id.short_description = _("Task id")
    name.short_description = _("Name")
    group.short_description = _("Group")
    args.short_description = _("Arguments")
    kwargs.short_description = _("Keyword arguments")
    q_options.short_description = _("Queue options")

    class Meta:
        app_label = "django_q"
        verbose_name = _("Queued task")
        verbose_name_plural = _("Queued tasks")
