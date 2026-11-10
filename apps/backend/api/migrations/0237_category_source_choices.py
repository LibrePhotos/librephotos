"""``Photo.category_source`` takes the ``CategorySource`` choices: auto or user.

Only those two were ever written, so no row changes.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0236_review_records"),
    ]

    operations = [
        migrations.AlterField(
            model_name="photo",
            name="category_source",
            field=models.CharField(
                choices=[("auto", "Detector"), ("user", "User")],
                default="auto",
                max_length=8,
            ),
        ),
    ]
