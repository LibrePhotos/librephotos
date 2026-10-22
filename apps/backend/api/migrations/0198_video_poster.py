"""Still posters for videos in the grid (#2026).

``Thumbnail.video_poster`` says a video has WebP stills beside its clips. The
videos already scanned have none, so the ``make_video_posters`` upgrade task
gets its row here when there are videos, and job type 34 makes them.
"""

from django.db import migrations, models


def seed_upgrade_task(apps, schema_editor):
    Thumbnail = apps.get_model("api", "Thumbnail")
    UpgradeTaskState = apps.get_model("api", "UpgradeTaskState")
    if Thumbnail.objects.filter(photo__video=True).exists():
        UpgradeTaskState.objects.get_or_create(key="make_video_posters")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0197_deduplicate_faces_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="thumbnail",
            name="video_poster",
            field=models.BooleanField(default=False),
        ),
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
                    (20, "Import Uploads"),
                    (22, "Detect Stacks"),
                    (23, "Remove Photo Details from Thumbnails"),
                    (24, "Empty Trash"),
                    (25, "Generate Captions"),
                    (26, "Apply Date Rules"),
                    (27, "Write Metadata to Files"),
                    (28, "Read Shutter Speeds Again"),
                    (29, "Look Up Place Names"),
                    (30, "Move Photos"),
                    (31, "Deduplicate Faces"),
                    (34, "Make Video Posters"),
                ]
            ),
        ),
        migrations.RunPython(seed_upgrade_task, migrations.RunPython.noop),
    ]
