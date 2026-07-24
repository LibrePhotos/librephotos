"""Add media-category flags (screenshot/document) to Photo.

``is_screenshot`` / ``is_document`` are set by the automatic detector during a
scan; ``category_source`` records whether the current values came from the
detector ("auto") or a manual correction ("user") so a rescan never clobbers a
user's choice.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0130_tag"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="is_screenshot",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="photo",
            name="is_document",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="photo",
            name="category_source",
            field=models.CharField(default="auto", max_length=8),
        ),
    ]
