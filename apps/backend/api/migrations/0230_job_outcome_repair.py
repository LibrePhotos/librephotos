"""Give ended jobs the outcome the job methods now write.

A job ends once (``LongRunningJob._end``): a cancel is never also a failure,
and a job that ended while queued started when it ended. Older rows can
still be cancelled and failed (a cancel after the items' errors flagged the
run), or ended without a start (a queued job that was cancelled, failed to
queue or was failed as stuck), which also put them on top of the job list on
PostgreSQL. The latest job of each type is kept forever, so these are
repaired rather than left to age out.
"""

from django.db import migrations
from django.db.models.functions import Coalesce


def repair_outcomes(apps, schema_editor):
    LongRunningJob = apps.get_model("api", "LongRunningJob")
    LongRunningJob.objects.filter(cancelled=True, failed=True).update(failed=False)
    LongRunningJob.objects.filter(finished=True, started_at__isnull=True).update(
        started_at=Coalesce("finished_at", "queued_at")
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0226_remove_small_thumbnails_job"),
    ]

    operations = [
        migrations.RunPython(repair_outcomes, migrations.RunPython.noop),
    ]
