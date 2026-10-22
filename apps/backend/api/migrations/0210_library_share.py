"""A whole library shared read-only with another user (#2731)."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0209_user_place"),
    ]

    operations = [
        migrations.CreateModel(
            name="LibraryShare",
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
                ("show_in_timeline", models.BooleanField(default=False)),
                ("share_location", models.BooleanField(default=False)),
                ("share_faces", models.BooleanField(default=False)),
                ("share_camera_info", models.BooleanField(default=False)),
                ("share_captions", models.BooleanField(default=False)),
                ("share_originals", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("copies_hour", models.DateTimeField(blank=True, null=True)),
                ("copies_made", models.PositiveIntegerField(default=0)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="library_shares_given",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="library_shares_received",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("created_at", "id"),
                "constraints": [
                    models.UniqueConstraint(
                        fields=("owner", "recipient"),
                        name="library_share_once_per_pair",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("owner", models.F("recipient")), _negated=True
                        ),
                        name="library_share_not_to_self",
                    ),
                ],
            },
        ),
    ]
