"""
Migration to add a default FACE_RECOGNITION_MODEL entry to the constance database.
"""

from django.db import migrations


def add_default_face_recognition_model(apps, schema_editor):
    """Add FACE_RECOGNITION_MODEL default value to constance DB if it doesn't exist."""
    try:
        Constance = apps.get_model("constance", "Constance")
        if not Constance.objects.filter(key="FACE_RECOGNITION_MODEL").exists():
            Constance.objects.create(key="FACE_RECOGNITION_MODEL", value='"buffalo_sc"')
    except LookupError:
        pass


def reverse_migration(apps, schema_editor):
    """Remove FACE_RECOGNITION_MODEL from constance DB if it has the default value."""
    try:
        Constance = apps.get_model("constance", "Constance")
        Constance.objects.filter(
            key="FACE_RECOGNITION_MODEL",
            value='"buffalo_sc"',
        ).delete()
    except LookupError:
        pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0124_photo_local_orientation"),
    ]

    operations = [
        migrations.RunPython(
            add_default_face_recognition_model,
            reverse_migration,
        ),
    ]
