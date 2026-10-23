"""An import job per user for uploads (#2737): job type 20, `sealed`, `last_file_at`
and one open upload import job per user."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0192_upload_followup_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="longrunningjob",
            name="last_file_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="longrunningjob",
            name="sealed",
            field=models.BooleanField(default=True),
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
                ]
            ),
        ),
        migrations.AddConstraint(
            model_name="longrunningjob",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    ("finished", False), ("job_type", 20), ("sealed", False)
                ),
                fields=("started_by",),
                name="lrj_one_open_upload_import",
            ),
        ),
    ]
