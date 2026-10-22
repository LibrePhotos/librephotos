"""The rating a photo's file had at the last read (#2771).

A rescan takes the file's rating only when it changed since then. No data
migration: an existing row starts without one, and its first rescan keeps a
rating the user set in LibrePhotos (``PhotoMetadata._apply_file_rating``).
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0188_move_photos_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="photometadata",
            name="file_rating",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
