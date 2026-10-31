"""Moving the faces imported a quarter turn off the face (#2887).

Up to 1.5.0 a face region whose picture was turned since it was written was
saved 90 degrees away from the face, next to the face service's unnamed
detection of it. The new job type 36 repairs them
(``api.faces.turned_faces``), started from the ``repair_turned_faces``
upgrade task. Its row is made here only where such faces can be: a photo
with a face without an encoding and one with.
"""

from django.db import migrations, models


def seed_upgrade_task(apps, schema_editor):
    Face = apps.get_model("api", "Face")
    UpgradeTaskState = apps.get_model("api", "UpgradeTaskState")
    # The faces of api.faces.turned_faces.photos_to_check as of this
    # migration, without its thumbnail and file checks.
    faces = Face.objects.filter(deleted=False, video_time__isnull=True)
    if faces.filter(
        encoding="",
        photo__in=faces.exclude(encoding="").values("photo_id"),
    ).exists():
        UpgradeTaskState.objects.get_or_create(key="repair_turned_faces")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0218_photo_town"),
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
                ]
            ),
        ),
        migrations.RunPython(seed_upgrade_task, migrations.RunPython.noop),
    ]
