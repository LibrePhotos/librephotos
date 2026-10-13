"""``Photo.faces_scanned_at``: when face detection last ran on the picture.

An incremental Scan Faces used to cover the photos added since the last face
job started, so a photo the face service failed on was never looked at again
(#2199). It now covers the photos with no ``faces_scanned_at``.

An existing library counts as scanned where the old window says so: a photo
added before the start of its owner's last face job that went through all of
its photos (the rule of ``LongRunningJob.baselines``), and every photo that has
a face. The rest stay None and the next Scan Faces looks at them. Photos that
lost their faces to a face-service outage before this cannot be told apart
from photos without faces; "Rescan faces" finds them.
"""

import datetime

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F, Q

# LongRunningJob.JOB_SCAN_FACES; the historical model has no constants.
JOB_SCAN_FACES = 7


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor | None) -> None:
    photo = apps.get_model("api", "Photo")
    long_running_job = apps.get_model("api", "LongRunningJob")

    finished_runs = (
        long_running_job.objects.filter(
            job_type=JOB_SCAN_FACES,
            finished=True,
            cancelled=False,
            started_at__isnull=False,
        )
        .filter(
            Q(failed=False)
            | Q(progress_target__gt=0, progress_current__gte=F("progress_target"))
        )
        .order_by("started_by_id", "-finished_at", "-id")
        .values_list("started_by_id", "started_at")
    )
    last_start: dict[int, datetime.datetime] = {}
    for user_id, started_at in finished_runs:
        last_start.setdefault(user_id, started_at)

    for user_id, started_at in last_start.items():
        photo.objects.filter(
            owner_id=user_id,
            added_on__lte=started_at,
            faces_scanned_at__isnull=True,
        ).update(faces_scanned_at=F("added_on"))

    photo.objects.filter(faces__isnull=False, faces_scanned_at__isnull=True).update(
        faces_scanned_at=F("added_on")
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0163_job_last_progress_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="faces_scanned_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
