import os

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


def migrate_to_files(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    File = apps.get_model("api", "File")
    for photo in Photo.objects.all():
        if photo.image_paths:
            for path in photo.image_paths:
                file: File = File()
                file.path = path
                if os.path.exists(path):
                    file.type = find_out_type(path)
                else:
                    file.type = UNKNOWN
                    if photo.video:
                        file.type = VIDEO
                    file.missing = True
                # This is fine, because at this point all files that belong to a photo have the same hash
                file.hash = photo.image_hash
                file.save()
                photo.files.add(file)
                photo.save()
        # handle missing photos
        else:
            file: File = File()
            file.path = None
            file.type = UNKNOWN
            file.missing = True
            file.hash = photo.image_hash
            file.save()
            photo.files.add(file)
            photo.save()


def remove_files(apps, schema_editor):
    File = apps.get_model("api", "File")
    for file in File.objects.all():
        file.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0036_handle_missing_files"),
    ]

    operations = [migrations.RunPython(migrate_to_files, remove_files)]
