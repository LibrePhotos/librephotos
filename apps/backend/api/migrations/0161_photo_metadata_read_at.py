"""``Photo.metadata_read_at``: when the file's metadata was last read in full.

A photo whose read failed during a scan has no ``PhotoMetadata`` row:
``extract_exif_data`` creates it only after a successful read. Those photos get
None and the next incremental scan reads them again (#2271); every other photo
counts as read when it was added. A few rows came from elsewhere (an empty row
the metadata API created, the 0101 data migration, a successful EXIF read
followed by a failed date read); they stay marked as read, and a full rescan
reads them.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    photo = apps.get_model("api", "Photo")
    photo.objects.filter(metadata__isnull=False).update(metadata_read_at=F("added_on"))


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0160_detect_stacks_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="metadata_read_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
