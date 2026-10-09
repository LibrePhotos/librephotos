from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0145_video_probe_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="upload_directory",
            field=models.CharField(blank=True, default="", max_length=512),
        ),
    ]
