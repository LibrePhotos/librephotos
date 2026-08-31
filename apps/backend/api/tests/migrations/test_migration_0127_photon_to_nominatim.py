"""Tests for the photon→nominatim Constance migration (0127).

The original 0093 filtered on the wrong storage format and is a no-op for
real installations. This migration re-runs the conversion using
``constance.codecs.loads``/``dumps`` so it matches what django-constance
actually writes to the database.
"""

import importlib

from constance.codecs import dumps, loads
from constance.models import Constance
from django.apps import apps as django_apps
from django.test import TestCase


migration_module = importlib.import_module(
    "api.migrations.0127_migrate_photon_provider_robustly"
)


class MigratePhotonProviderTest(TestCase):
    def _set_provider_value(self, value):
        # Mirror the path django-constance uses internally so the stored
        # ``value`` column matches what the live application would write.
        Constance.objects.update_or_create(
            key="MAP_API_PROVIDER", defaults={"value": dumps(value)}
        )

    def _read_provider(self):
        row = Constance.objects.get(key="MAP_API_PROVIDER")
        return loads(row.value)

    def test_migrates_photon_to_nominatim(self):
        self._set_provider_value("photon")

        migration_module.migrate_photon_provider(django_apps, None)

        self.assertEqual(self._read_provider(), "nominatim")

    def test_leaves_other_providers_alone(self):
        self._set_provider_value("mapbox")

        migration_module.migrate_photon_provider(django_apps, None)

        self.assertEqual(self._read_provider(), "mapbox")

    def test_is_idempotent_when_already_nominatim(self):
        self._set_provider_value("nominatim")

        migration_module.migrate_photon_provider(django_apps, None)
        migration_module.migrate_photon_provider(django_apps, None)

        self.assertEqual(self._read_provider(), "nominatim")

    def test_no_op_when_setting_missing(self):
        Constance.objects.filter(key="MAP_API_PROVIDER").delete()

        # Should not raise.
        migration_module.migrate_photon_provider(django_apps, None)

        self.assertFalse(Constance.objects.filter(key="MAP_API_PROVIDER").exists())

    def test_reverse_migration_restores_photon(self):
        self._set_provider_value("nominatim")

        migration_module.reverse_migrate_photon_provider(django_apps, None)

        self.assertEqual(self._read_provider(), "photon")
