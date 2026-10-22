"""The people a face was rejected for ("Not Anna"), so training skips them (#2747)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0194_photo_ocr_failures"),
    ]

    operations = [
        migrations.AddField(
            model_name="face",
            name="rejected_persons",
            field=models.ManyToManyField(
                blank=True, related_name="rejected_faces", to="api.person"
            ),
        ),
    ]
