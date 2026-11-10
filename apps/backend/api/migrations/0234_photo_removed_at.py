"""``Photo.removed_at``: when ``remove_photo`` removed the photo.

The removed-photo cleanup purged rows 30 days after their ``last_modified``,
which every write to the row moves on. Removed photos get their
``last_modified`` as the best estimate there is (never earlier than the
removal). A photo in the trash without a ``trashed_at`` (a writer that
skipped ``trash_photos``) never expired; it gets its ``last_modified`` too,
as migration 0173 did.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor | None) -> None:
    photo = apps.get_model("api", "Photo")
    photo.objects.filter(removed=True, removed_at__isnull=True).update(
        removed_at=F("last_modified")
    )
    photo.objects.filter(in_trashcan=True, trashed_at__isnull=True).update(
        trashed_at=F("last_modified")
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0232_upload_followup_lease_constraints"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="removed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
