"""The UTC offset of the capture time and the date rule that gave it (#2768).

Both stay NULL on existing rows until a rescan or "apply the date rules
again" (#437) fills them.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0188_move_photos_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="exif_timestamp_offset",
            field=models.SmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="photo",
            name="exif_timestamp_source",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
