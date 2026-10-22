"""The "What's new" card's per-user state (#2305)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0203_photometadata_edited_keywords"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="last_seen_release",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="user",
            name="show_whats_new",
            field=models.BooleanField(default=True),
        ),
    ]
