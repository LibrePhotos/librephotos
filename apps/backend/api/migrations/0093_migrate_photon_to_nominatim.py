"""
Migration to change MAP_API_PROVIDER from 'photon' to 'nominatim'.

Photon's public API at photon.komoot.io has become unreliable (502 errors),
so we're switching the default to Nominatim which is more stable.
"""

from django.db import migrations


def migrate_photon_to_nominatim(apps, schema_editor):
    """Update constance config from photon to nominatim."""
    try:
        Constance = apps.get_model("constance", "Constance")
        config = Constance.objects.filter(key="MAP_API_PROVIDER").first()
        if config and config.value == '"photon"':
            config.value = '"nominatim"'
            config.save()
    except LookupError:
        # constance model not available, skip
        pass


def reverse_migration(apps, schema_editor):
    """Reverse: change nominatim back to photon (not recommended)."""
    try:
        Constance = apps.get_model("constance", "Constance")
        config = Constance.objects.filter(key="MAP_API_PROVIDER").first()
        if config and config.value == '"nominatim"':
            config.value = '"photon"'
            config.save()
    except LookupError:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0092_add_skip_raw_files_field"),
    ]

    operations = [
        migrations.RunPython(migrate_photon_to_nominatim, reverse_migration),
    ]

