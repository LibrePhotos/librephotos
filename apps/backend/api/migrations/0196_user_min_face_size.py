"""The minimum size of a detected face worth saving, per user (#2749)."""

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0195_face_rejected_persons"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="min_face_size",
            field=models.FloatField(
                default=0,
                validators=[
                    django.core.validators.MinValueValidator(0),
                    django.core.validators.MaxValueValidator(0.5),
                ],
            ),
        ),
    ]
