"""Store the size photos are shown at in ``PhotoMetadata.width/height`` (#2568).

Until now the scan stored the stored pixel size of a photo, so one turned by
its EXIF orientation (5-8) or by the user's rotation reported the size of its
pixels on disk: a portrait photo said 4000 x 3000. The thumbnails show the
photo turned, and the big thumbnail's ``aspect_ratio`` says so. Where the two
disagree (one landscape, the other portrait), width and height are swapped.
That also covers rotated videos scanned before #2268. A square or nearly
square photo, one without a thumbnail aspect ratio and one without a size are
left alone. There is nothing to undo on the way back.
"""

from django.db import migrations
from django.db.models import F, Q


def forwards(apps, schema_editor):
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    turned = Q(
        width__gt=F("height"), photo__thumbnail__aspect_ratio__lt=1
    ) | Q(width__lt=F("height"), photo__thumbnail__aspect_ratio__gt=1)
    # Both columns are set from the row's old values (SQL evaluates every
    # right-hand side before it writes).
    PhotoMetadata.objects.filter(turned).update(width=F("height"), height=F("width"))


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0170_file_copy"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
