"""The grid's placeholder for each photo: a ThumbHash (~25 bytes) of its thumbnail.

The grid used to load a small thumbnail as a blurred placeholder before the
grid thumbnail, two requests per tile. ``Thumbnail.thumbhash`` is shown
instead, decoded in the browser. Photos already scanned have none, so the
``make_thumbhashes`` upgrade task gets its row here when there are
thumbnails, and job type 37 makes them.
"""

from django.db import migrations, models


def seed_upgrade_task(apps, schema_editor):
    Thumbnail = apps.get_model("api", "Thumbnail")
    UpgradeTaskState = apps.get_model("api", "UpgradeTaskState")
    if Thumbnail.objects.exists():
        UpgradeTaskState.objects.get_or_create(key="make_thumbhashes")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0224_error_report"),
    ]

    operations = [
        migrations.AddField(
            model_name="thumbnail",
            name="thumbhash",
            field=models.CharField(blank=True, max_length=64, null=True),
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
                    (32, "Check File Contents"),
                    (33, "Trash Photos Outside the Library"),
                    (34, "Make Video Posters"),
                    (35, "Rename Photos"),
                    (36, "Repair Turned Faces"),
                    (37, "Make Photo Placeholders"),
                ]
            ),
        ),
        migrations.RunPython(seed_upgrade_task, migrations.RunPython.noop),
    ]
