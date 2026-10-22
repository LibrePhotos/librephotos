"""Photo.projection_type: "equirectangular" for a 360° photo sphere (#483).

NULL for every existing photo until it is scanned again.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0206_user_excluded_folders"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="projection_type",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
    ]
