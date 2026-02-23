"""
Migration to add a default TAGGING_MODEL entry to the constance database.

When TAGGING_MODEL was added to CONSTANCE_CONFIG, existing systems that upgraded
would not have this key in the constance database backend. While constance normally
falls back to the default from CONSTANCE_CONFIG, this migration explicitly sets the
default to ensure compatibility with old systems.
"""

from django.db import migrations


def add_default_tagging_model(apps, schema_editor):
    """Add TAGGING_MODEL default value to constance DB if it doesn't exist."""
    try:
        Constance = apps.get_model("constance", "Constance")
        if not Constance.objects.filter(key="TAGGING_MODEL").exists():
            Constance.objects.create(key="TAGGING_MODEL", value='"places365"')
    except LookupError:
        # constance model not available, skip
        pass


def reverse_migration(apps, schema_editor):
    """Remove TAGGING_MODEL from constance DB if it has the default value."""
    try:
        Constance = apps.get_model("constance", "Constance")
        Constance.objects.filter(key="TAGGING_MODEL", value='"places365"').delete()
    except LookupError:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0120_rename_thumbnails_uuid_to_hash"),
    ]

    operations = [
        migrations.RunPython(add_default_tagging_model, reverse_migration),
    ]
