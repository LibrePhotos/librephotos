"""
Re-run of the photon → nominatim Constance migration.

The original 0093_migrate_photon_to_nominatim filtered on
``config.value == '"photon"'``, but django-constance stores values via
``constance.codecs.dumps`` which encodes a bare string as
``{"__type__": "default", "__value__": "photon"}``. The old filter never
matched, so 0093 was effectively a no-op and existing installations were
left pointing at a provider that no longer exists.

This migration decodes each candidate value with the codec, so the check
is robust to whatever JSON shape django-constance happens to be using.
"""

from django.db import migrations

from constance.codecs import dumps, loads


def _decode(raw):
    try:
        return loads(raw)
    except Exception:
        return None


def migrate_photon_provider(apps, schema_editor):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return

    for config in Constance.objects.filter(key="MAP_API_PROVIDER"):
        if _decode(config.value) == "photon":
            config.value = dumps("nominatim")
            config.save()


def reverse_migrate_photon_provider(apps, schema_editor):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return

    for config in Constance.objects.filter(key="MAP_API_PROVIDER"):
        if _decode(config.value) == "nominatim":
            config.value = dumps("photon")
            config.save()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0126_clear_128dim_face_encodings"),
    ]

    operations = [
        migrations.RunPython(migrate_photon_provider, reverse_migrate_photon_provider),
    ]
