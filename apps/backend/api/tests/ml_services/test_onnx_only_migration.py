"""The 0138 data migration moves site settings off the retired PyTorch models.

Exercised through the migration module's functions with the live app
registry: what matters is the mapping (Places365 -> MobileCLIP-S2, im2txt and
BLIP -> Florence-2 int8), that other values are left alone, and that the
retired taggers' AlbumThing rows are removed while everything else stays.
"""

from importlib import import_module

from constance.models import Constance
from django.apps import apps
from django.test import TestCase

from api.models.album_thing import AlbumThing
from api.tests.utils import create_test_user

migration = import_module("api.migrations.0138_onnx_only_ml_models")


def _set(key, value):
    Constance.objects.update_or_create(key=key, defaults={"value": f'"{value}"'})


def _get(key):
    return Constance.objects.get(key=key).value.strip('"')


class OnnxOnlyMigrationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_retired_models_are_mapped_to_their_successors(self):
        _set("CAPTIONING_MODEL", "blip_base_capfilt_large")
        _set("TAGGING_MODEL", "places365")

        migration.forwards(apps, None)

        self.assertEqual(_get("CAPTIONING_MODEL"), "florence2_base_int8")
        self.assertEqual(_get("TAGGING_MODEL"), "mobileclip_s2")

    def test_im2txt_is_mapped_too(self):
        _set("CAPTIONING_MODEL", "im2txt")
        migration.forwards(apps, None)
        self.assertEqual(_get("CAPTIONING_MODEL"), "florence2_base_int8")

    def test_other_selections_are_left_alone(self):
        _set("CAPTIONING_MODEL", "moondream")
        _set("TAGGING_MODEL", "siglip2")

        migration.forwards(apps, None)

        self.assertEqual(_get("CAPTIONING_MODEL"), "moondream")
        self.assertEqual(_get("TAGGING_MODEL"), "siglip2")

    def test_missing_keys_are_not_created(self):
        migration.forwards(apps, None)
        self.assertFalse(Constance.objects.filter(key="CAPTIONING_MODEL").exists())

    def test_places365_album_things_are_removed_and_others_kept(self):
        for thing_type in (
            "places365_attribute",
            "places365_category",
            "siglip2_tag",
            "hashtag_attribute",
        ):
            AlbumThing.objects.create(
                title=f"t-{thing_type}", owner=self.user, thing_type=thing_type
            )

        migration.forwards(apps, None)

        self.assertEqual(
            set(AlbumThing.objects.values_list("thing_type", flat=True)),
            {"siglip2_tag", "hashtag_attribute"},
        )

    def test_backwards_restores_the_old_selections(self):
        _set("CAPTIONING_MODEL", "florence2_base_int8")
        _set("TAGGING_MODEL", "mobileclip_s2")

        migration.backwards(apps, None)

        self.assertEqual(_get("CAPTIONING_MODEL"), "im2txt")
        self.assertEqual(_get("TAGGING_MODEL"), "places365")
