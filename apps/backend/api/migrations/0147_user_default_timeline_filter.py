from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0146_user_upload_directory"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="default_timeline_filter",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
