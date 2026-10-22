"""``Face.video_time``: the second of the video a face was found at (#2761).

Scan Faces read only a video's first frame (its big thumbnail), so the
people who appear later were never found. It now also reads a few frames
across the video and stores the time of the frame each face came from.

The videos scanned before count as not scanned again, so the next Scan
Faces reads their other frames. The faces they already have stay: the
first frame's faces are matched again by position, and a person found in
the other frames is saved once per video.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor | None) -> None:
    photo = apps.get_model("api", "Photo")
    photo.objects.filter(video=True, faces_scanned_at__isnull=False).update(
        faces_scanned_at=None
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0207_photo_projection_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="face",
            name="video_time",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
