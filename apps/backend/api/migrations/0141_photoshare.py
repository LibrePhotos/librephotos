"""Add ``PhotoShare``: a revocable public share for a single photo.

The lightbox handed out a URL derived from the file content, so it could never
be rotated or withdrawn (issue #2028). This table gives each shared photo its
own random slug, the way ``AlbumUserShare`` does for albums since #2019.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0140_album_m2m_unique_constraints"),
    ]

    operations = [
        migrations.CreateModel(
            name="PhotoShare",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("enabled", models.BooleanField(db_index=True, default=False)),
                (
                    "slug",
                    models.SlugField(
                        blank=True, db_index=True, max_length=64, null=True, unique=True
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "photo",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="share",
                        to="api.photo",
                    ),
                ),
            ],
        ),
    ]
