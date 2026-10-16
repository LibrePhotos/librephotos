"""Post-upgrade tasks and the Admin page's Finish the upgrade card (#2322).

``UpgradeTaskState`` keeps, per instance, what was done about each task of
``api.jobs.upgrade_tasks``. The tasks that only apply to data an older release
left behind get their row here, and only when that data is there, so a fresh
install (no photos) never shows them:

- ``strip_thumbnail_metadata``: there are photos, so there may be thumbnails
  written with the photo's details by 1.2.1 or older (#2140);
- ``refresh_exposure_times``: shutter speeds stored as "0", "1/1000" or an
  improper fraction like "5/2" (#2275);
- ``probe_videos``: videos indexed before the scan probed them (#2045).

The new job type 28 reads the shutter speeds again.
"""

import django.utils.timezone
from django.db import migrations, models
from django.db.models import Q


def seed_upgrade_tasks(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    UpgradeTaskState = apps.get_model("api", "UpgradeTaskState")
    keys = []
    if Photo.objects.exists():
        keys.append("strip_thumbnail_metadata")
    # api.metadata.photo_reader.misread_exposure_times as of this migration.
    if PhotoMetadata.objects.filter(
        Q(shutter_speed__in=("0", "1/1000"))
        | (Q(shutter_speed__contains="/") & ~Q(shutter_speed__startswith="1/"))
    ).exists():
        keys.append("refresh_exposure_times")
    # api.directory_watcher.processing_jobs.unprobed_videos as of this migration.
    if Photo.objects.filter(
        video=True,
        video_color_transfer__isnull=True,
        main_file__isnull=False,
        main_file__missing=False,
        removed=False,
    ).exists():
        keys.append("probe_videos")
    for key in keys:
        UpgradeTaskState.objects.get_or_create(key=key)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0184_write_metadata_job_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="UpgradeTaskState",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("key", models.CharField(max_length=64, unique=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("dismissed_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "verbose_name": "Upgrade Task State",
                "verbose_name_plural": "Upgrade Task States",
            },
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
                    (22, "Detect Stacks"),
                    (23, "Remove Photo Details from Thumbnails"),
                    (24, "Empty Trash"),
                    (25, "Generate Captions"),
                    (26, "Apply Date Rules"),
                    (27, "Write Metadata to Files"),
                    (28, "Read Shutter Speeds Again"),
                ]
            ),
        ),
        migrations.RunPython(seed_upgrade_tasks, migrations.RunPython.noop),
    ]
