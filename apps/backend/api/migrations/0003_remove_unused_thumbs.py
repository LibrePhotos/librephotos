from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0002_add_confidence"),
    ]

    operations = [
        migrations.RemoveField(model_name="Photo", name="thumbnail_tiny"),
        migrations.RemoveField(model_name="Photo", name="thumbnail_small"),
        migrations.RemoveField(model_name="Photo", name="thumbnail"),
        migrations.RemoveField(model_name="Photo", name="square_thumbnail_tiny"),
        migrations.RemoveField(model_name="Photo", name="square_thumbnail_big"),
    ]
