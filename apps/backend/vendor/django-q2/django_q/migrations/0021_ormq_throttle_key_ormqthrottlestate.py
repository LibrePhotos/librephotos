from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0020_ormq_available_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="ormq",
            name="throttle_key",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Runtime throttle bucket identifier.",
                max_length=100,
                null=True,
                verbose_name="Throttle key",
            ),
        ),
        migrations.CreateModel(
            name="OrmQThrottleState",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "queue_key",
                    models.CharField(
                        help_text="Name of the queue using this throttle state.",
                        max_length=100,
                        verbose_name="Queue key",
                    ),
                ),
                (
                    "throttle_key",
                    models.CharField(
                        help_text="Runtime throttle bucket identifier.",
                        max_length=100,
                        verbose_name="Throttle key",
                    ),
                ),
                (
                    "available_tokens",
                    models.FloatField(
                        default=1.0,
                        verbose_name="Available tokens",
                    ),
                ),
                (
                    "last_refilled_at",
                    models.DateTimeField(
                        default=timezone.now,
                        verbose_name="Last refilled at",
                    ),
                ),
                (
                    "next_available_at",
                    models.DateTimeField(
                        db_index=True,
                        default=timezone.now,
                        verbose_name="Next available at",
                    ),
                ),
                (
                    "updated_at",
                    models.DateTimeField(
                        auto_now=True,
                        verbose_name="Updated at",
                    ),
                ),
            ],
            options={
                "verbose_name": "Queue throttle state",
                "verbose_name_plural": "Queue throttle states",
            },
        ),
        migrations.AddConstraint(
            model_name="ormqthrottlestate",
            constraint=models.UniqueConstraint(
                fields=("queue_key", "throttle_key"),
                name="django_q_unique_queue_throttle_state",
            ),
        ),
    ]
