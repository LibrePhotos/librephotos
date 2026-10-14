"""``AlbumCollection``: a user's own grouping of their albums (#1009, #871).

A new table and its many-to-many to ``AlbumUser``; nothing existing changes.
"""

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0178_reapply_date_rules_job_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="AlbumCollection",
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
                ("name", models.CharField(max_length=128)),
                ("last_modified", models.DateTimeField(auto_now=True, db_index=True)),
                (
                    "albums",
                    models.ManyToManyField(
                        blank=True, related_name="collections", to="api.albumuser"
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        django.db.models.functions.text.Lower("name"),
                        models.F("owner"),
                        name="unique_album_collection_name",
                    )
                ],
            },
        ),
    ]
