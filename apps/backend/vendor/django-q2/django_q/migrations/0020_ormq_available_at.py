from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0019_alter_task_options_alter_ormq_key_alter_ormq_lock_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="ormq",
            name="available_at",
            field=models.DateTimeField(
                db_index=True,
                default=timezone.now,
                help_text="Prevent dequeue until this time",
                verbose_name="Available at",
            ),
        ),
    ]
