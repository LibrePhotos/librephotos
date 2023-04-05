from django.db import migrations

from api.models.file import is_metadata, is_raw, is_video

IMAGE = 1
VIDEO = 2
METADATA_FILE = 3
RAW_FILE = 4
UNKNOWN = 5


def find_out_type(path):
    if is_raw(path):
        return RAW_FILE
    if is_video(path):
        return VIDEO
    if is_metadata(path):
        return METADATA_FILE
    return IMAGE


def add_main_file(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    for photo in Photo.objects.all():
        if photo.files.count() > 0:
            photo.main_file = photo.files.first()
            photo.save()


def remove_main_file(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    for photo in Photo.objects.all():
        photo.main_file = None
        photo.save()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0037_migrate_to_files"),
    ]

    operations = [migrations.RunPython(add_main_file, remove_main_file)]
