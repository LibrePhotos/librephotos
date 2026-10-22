"""A person's optional birth date (#2750)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0190_photo_exif_timestamp_offset"),
    ]

    operations = [
        migrations.AddField(
            model_name="person",
            name="birth_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
