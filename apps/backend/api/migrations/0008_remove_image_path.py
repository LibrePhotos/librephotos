from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0007_migrate_to_json_field"),
    ]

    operations = [
        migrations.RemoveField(model_name="Photo", name="image_path"),
    ]
