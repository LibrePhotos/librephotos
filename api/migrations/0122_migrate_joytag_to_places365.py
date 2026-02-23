"""
Migration to reset any TAGGING_MODEL value of 'joytag' to 'places365'.

The JoyTag tagging algorithm was removed, but users who had previously
selected it will still have 'joytag' stored in the constance database.
Since there is no longer any code that handles the 'joytag' model, those
users would silently fall back to places365 behaviour without this migration.
This migration makes that fallback explicit so their setting reflects reality.
"""

from django.db import migrations


def migrate_joytag_to_places365(apps, schema_editor):
    """Replace any stored TAGGING_MODEL value of 'joytag' with 'places365'.

    Constance stores values as JSON-serialized strings, so a Python string
    'places365' is stored as '"places365"' (with surrounding quotes).
    """
    try:
        Constance = apps.get_model("constance", "Constance")
        # Values are JSON-serialized: '"joytag"' is the stored form of 'joytag'
        Constance.objects.filter(key="TAGGING_MODEL", value='"joytag"').update(
            value='"places365"'
        )
    except LookupError:
        # constance model not available, skip
        pass


def reverse_migration(apps, schema_editor):
    """No-op reverse: we cannot know which users had joytag before the migration."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0121_add_default_tagging_model"),
    ]

    operations = [
        migrations.RunPython(migrate_joytag_to_places365, reverse_migration),
    ]
