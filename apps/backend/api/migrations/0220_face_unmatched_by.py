"""The face model that found no face in a face's box (#2888).

``Face.unmatched_by`` lets Generate Face Embeddings skip a region the
current face model cannot match instead of asking again on every run.
Existing faces start without it, so the first run after the upgrade asks
once more.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0219_repair_turned_faces_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="face",
            name="unmatched_by",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
