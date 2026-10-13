"""Stack detection gets a job type of its own (#2192).

It finished as a Scan Photos job, which then became the incremental scan's
change baseline although it never looked at the scan directory.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

JOB_SCAN_PHOTOS = 1
JOB_DETECT_STACKS = 22


def move_stack_detection_rows(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    """Give past stack detections their own type (#2192).

    They ran on a Scan Photos row; only stack detection writes ``stacks_found``.
    """
    LongRunningJob = apps.get_model("api", "LongRunningJob")
    LongRunningJob.objects.filter(
        job_type=JOB_SCAN_PHOTOS, result__has_key="stacks_found"
    ).update(job_type=JOB_DETECT_STACKS)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0159_merge_photos_sharing_a_main_file"),
    ]

    operations = [
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
                ]
            ),
        ),
        migrations.RunPython(move_stack_detection_rows, migrations.RunPython.noop),
    ]
