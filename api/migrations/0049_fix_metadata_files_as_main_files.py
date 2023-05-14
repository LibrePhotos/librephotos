from django.db import migrations


def delete_photos_with_metadata_as_main(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    for photo in Photo.objects.filter(main_file__type=3):
        photo.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0048_fix_null_height"),
    ]

    operations = [
        migrations.RunPython(delete_photos_with_metadata_as_main),
    ]
