"""Job type 38, Remove Small Thumbnails: the remove_small_thumbnails upgrade task.

The 250 px squares are no longer made (the grid shows the ThumbHash while the
square loads); the task deletes their folder where an older release left one.
``Thumbnail.square_thumbnail_small`` stays for now, unused, so the old
container of a rolling deploy can still read its rows.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0225_thumbhash"),
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
                    (38, "Remove Small Thumbnails"),
                ]
            ),
        ),
    ]
