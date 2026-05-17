import django.utils.timezone
import picklefield.fields
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Schedule",
            fields=[
                (
                    "id",
                    models.AutoField(
                        verbose_name="ID",
                        auto_created=True,
                        serialize=False,
                        primary_key=True,
                    ),
                ),
                (
                    "func",
                    models.CharField(
                        max_length=256, help_text="e.g. module.tasks.function"
                    ),
                ),
                (
                    "hook",
                    models.CharField(
                        null=True,
                        blank=True,
                        max_length=256,
                        help_text="e.g. module.tasks.result_function",
                    ),
                ),
                (
                    "args",
                    models.CharField(
                        null=True,
                        blank=True,
                        max_length=256,
                        help_text="e.g. 1, 2, 'John'",
                    ),
                ),
                (
                    "kwargs",
                    models.CharField(
                        null=True,
                        blank=True,
                        max_length=256,
                        help_text="e.g. x=1, y=2, name='John'",
                    ),
                ),
                (
                    "schedule_type",
                    models.CharField(
                        verbose_name="Schedule Type",
                        choices=[
                            ("O", "Once"),
                            ("H", "Hourly"),
                            ("D", "Daily"),
                            ("W", "Weekly"),
                            ("M", "Monthly"),
                            ("Q", "Quarterly"),
                            ("Y", "Yearly"),
                        ],
                        default="O",
                        max_length=1,
                    ),
                ),
                (
                    "repeats",
                    models.SmallIntegerField(
                        verbose_name="Repeats",
                        default=-1,
                        help_text="n = n times, -1 = forever",
                    ),
                ),
                (
                    "next_run",
                    models.DateTimeField(
                        verbose_name="Next Run",
                        default=django.utils.timezone.now,
                        null=True,
                    ),
                ),
                ("task", models.CharField(editable=False, null=True, max_length=100)),
            ],
            options={
                "verbose_name": "Scheduled task",
                "ordering": ["next_run"],
            },
        ),
        migrations.CreateModel(
            name="Task",
            fields=[
                (
                    "id",
                    models.AutoField(
                        verbose_name="ID",
                        auto_created=True,
                        serialize=False,
                        primary_key=True,
                    ),
                ),
                ("name", models.CharField(editable=False, max_length=100)),
                ("func", models.CharField(max_length=256)),
                ("hook", models.CharField(null=True, max_length=256)),
                (
                    "args",
                    picklefield.fields.PickledObjectField(editable=False, null=True),
                ),
                (
                    "kwargs",
                    picklefield.fields.PickledObjectField(editable=False, null=True),
                ),
                (
                    "result",
                    picklefield.fields.PickledObjectField(editable=False, null=True),
                ),
                ("started", models.DateTimeField(editable=False)),
                ("stopped", models.DateTimeField(editable=False)),
                ("success", models.BooleanField(editable=False, default=True)),
            ],
        ),
        migrations.CreateModel(
            name="Failure",
            fields=[],
            options={
                "verbose_name": "Failed task",
                "proxy": True,
            },
            bases=("django_q.task",),
        ),
        migrations.CreateModel(
            name="Success",
            fields=[],
            options={
                "verbose_name": "Successful task",
                "proxy": True,
            },
            bases=("django_q.task",),
        ),
    ]
