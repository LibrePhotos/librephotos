# Generated migration for adding stack_raw_jpeg field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0107_add_burst_detection_rules"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="stack_raw_jpeg",
            field=models.BooleanField(default=True),
        ),
    ]


