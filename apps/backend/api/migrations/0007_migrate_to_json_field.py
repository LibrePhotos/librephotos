import json

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0006_migrate_to_boolean_field"),
    ]

    def forwards_func(apps, schema):
        Photo = apps.get_model("api", "Photo")
        for obj in Photo.objects.all():
            try:
                obj.image_paths.append(obj.image_path)
                obj.save()
            except json.decoder.JSONDecodeError:
                print("Cannot convert {} object".format(obj.image_path))

    operations = [
        migrations.AddField(
            model_name="Photo",
            name="image_paths",
            field=models.JSONField(db_index=True, default=list),
        ),
        migrations.RunPython(forwards_func),
    ]
