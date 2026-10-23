"""Whether the users someone shares with see the people they named (#2722)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0199_check_file_contents_job_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="share_people_names",
            field=models.BooleanField(default=False),
        ),
    ]
