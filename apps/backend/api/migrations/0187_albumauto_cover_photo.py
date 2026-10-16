"""The cover an owner picks for an event (#429); None keeps the automatic one."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0186_look_up_places_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="albumauto",
            name="cover_photo",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="album_auto_cover",
                to="api.photo",
            ),
        ),
    ]
