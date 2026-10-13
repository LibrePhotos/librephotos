"""``Photo.trashed_at`` and the Empty Trash job type (#2203).

``trashed_at`` says when a photo went to the trash, so the trash retention
(``TRASH_RETENTION_DAYS``, off by default) knows when to delete it. Photos
already in the trash get their ``last_modified`` as the best estimate there
is; that is never earlier than the day they were trashed, so the retention
cannot delete one sooner than it should.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor | None) -> None:
    photo = apps.get_model("api", "Photo")
    photo.objects.filter(in_trashcan=True, trashed_at__isnull=True).update(
        trashed_at=F("last_modified")
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0172_cluster_selection_epsilon_unit_scale"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="trashed_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="longrunningjob",
            name="job_type",
            field=models.PositiveIntegerField(
                choices=[
                    (1, "Scan Photos"),
                    (2, "Generate Event Albums"),
                    (3, "Regenerate Event Titles"),
                    (4, "Train Faces"),
                    (5, "Delete Missing Photos"),
                    (7, "Scan Faces"),
                    (6, "Calculate Clip Embeddings"),
                    (8, "Find Similar Faces"),
                    (9, "Download Selected Photos"),
                    (10, "Download Models"),
                    (11, "Add Geolocation"),
                    (12, "Generate Tags"),
                    (13, "Generate Face Embeddings"),
                    (14, "Scan Missing Photos"),
                    (15, "Detect Duplicate Photos"),
                    (16, "Repair File Variants"),
                    (17, "Classify Media Categories"),
                    (18, "Extract Text (OCR)"),
                    (19, "Probe Videos"),
                    (22, "Detect Stacks"),
                    (23, "Remove Photo Details from Thumbnails"),
                    (24, "Empty Trash"),
                ]
            ),
        ),
    ]
