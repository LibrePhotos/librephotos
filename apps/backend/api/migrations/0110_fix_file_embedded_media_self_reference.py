# Generated migration to fix self-referential ManyToManyField

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0109_migrate_skip_raw_to_stack_raw_jpeg"),
    ]

    operations = [
        migrations.AlterField(
            model_name="file",
            name="embedded_media",
            field=models.ManyToManyField("self", symmetrical=False),
        ),
    ]
