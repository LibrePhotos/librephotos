"""``updated_on``: an upload's last chunk or completion, which expiry counts from.

Uploads staged before this keep the expiry they had: theirs is their
creation time.
"""

import django.utils.timezone
from django.db import migrations, models
from django.db.models import F


def from_created_on(apps, schema_editor):
    ChunkedUpload = apps.get_model("chunked_upload", "ChunkedUpload")
    ChunkedUpload.objects.update(updated_on=F("created_on"))


class Migration(migrations.Migration):
    dependencies = [
        ("chunked_upload", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="chunkedupload",
            name="updated_on",
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.RunPython(from_created_on, migrations.RunPython.noop),
    ]
