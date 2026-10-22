"""A person's optional birth date (#2750)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0189_photo_metadata_file_rating"),
    ]

    operations = [
        migrations.AddField(
            model_name="person",
            name="birth_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
