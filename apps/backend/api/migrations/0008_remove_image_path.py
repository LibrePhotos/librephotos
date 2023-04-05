from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0007_migrate_to_json_field"),
    ]

    operations = [
        migrations.RemoveField(model_name="Photo", name="image_path"),
    ]
