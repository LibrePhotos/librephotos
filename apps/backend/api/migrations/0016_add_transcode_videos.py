from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0015_add_dominant_color"),
    ]
    operations = [
        migrations.AddField(
            model_name="User",
            name="transcode_videos",
            field=models.BooleanField(default=False),
        ),
    ]
