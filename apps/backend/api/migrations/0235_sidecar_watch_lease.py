"""``SidecarWatchLease``: one watchdog run at a time per sidecar.

The rows are created by the watchdog itself, the first time it checks each
sidecar.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0234_photo_removed_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="SidecarWatchLease",
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
                ("service", models.CharField(max_length=64, unique=True)),
                ("holder", models.CharField(blank=True, default="", max_length=64)),
                ("expires_at", models.DateTimeField()),
            ],
            options={
                "verbose_name": "Sidecar Watch Lease",
                "verbose_name_plural": "Sidecar Watch Leases",
            },
        ),
    ]
