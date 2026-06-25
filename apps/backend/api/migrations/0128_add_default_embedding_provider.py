"""
Migration to add a default EMBEDDING_PROVIDER entry to the constance database.

When EMBEDDING_PROVIDER was added to CONSTANCE_CONFIG, existing systems that
upgraded would not have this key in the constance database backend. While
constance normally falls back to the default from CONSTANCE_CONFIG, this
migration explicitly sets the default so that upgraded installs keep using the
bundled local CLIP model unless an admin opts in to the TwelveLabs provider.
"""

from django.db import migrations


def add_default_embedding_provider(apps, schema_editor):
    """Add EMBEDDING_PROVIDER default value to constance DB if it doesn't exist."""
    try:
        Constance = apps.get_model("constance", "Constance")
        if not Constance.objects.filter(key="EMBEDDING_PROVIDER").exists():
            Constance.objects.create(key="EMBEDDING_PROVIDER", value='"local"')
    except LookupError:
        # constance model not available, skip
        pass


def reverse_migration(apps, schema_editor):
    """Remove EMBEDDING_PROVIDER from constance DB if it has the default value."""
    try:
        Constance = apps.get_model("constance", "Constance")
        Constance.objects.filter(key="EMBEDDING_PROVIDER", value='"local"').delete()
    except LookupError:
        pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0127_migrate_photon_provider_robustly"),
    ]

    operations = [
        migrations.RunPython(add_default_embedding_provider, reverse_migration),
    ]
