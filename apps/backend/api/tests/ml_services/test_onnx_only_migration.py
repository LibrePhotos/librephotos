"""The 0138 data migration moves site settings off the retired models.

Exercised through the migration module's functions with the live app
registry: what matters is the mapping (Places365 -> MobileCLIP-S2, every
retired captioner -> LFM2.5-VL, the LLM slot dropped), that other
values are left alone, and that the retired taggers' AlbumThing rows are
removed while everything else stays.
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

        self.assertEqual(_get("CAPTIONING_MODEL"), "lfm2_vl_450m")
        self.assertEqual(_get("TAGGING_MODEL"), "mobileclip_s2")

    def test_every_retired_captioner_is_mapped(self):
        for old in ("im2txt", "florence2_base", "florence2_base_int8", "moondream"):
            _set("CAPTIONING_MODEL", old)
            migration.forwards(apps, None)
            self.assertEqual(_get("CAPTIONING_MODEL"), "lfm2_vl_450m", old)

    def test_llm_model_key_is_dropped(self):
        _set("LLM_MODEL", "mistral-7b-instruct-v0.2.Q5_K_M")
        migration.forwards(apps, None)
        self.assertFalse(Constance.objects.filter(key="LLM_MODEL").exists())

    def test_untouched_caption_settings_are_switched_on(self):
        from api.models.user import User

        untouched = self.user
        untouched.llm_settings = dict(migration.OLD_DEFAULT_CAPTION_SETTINGS)
        untouched.save()
        customised = create_test_user()
        customised.llm_settings = {
            **migration.OLD_DEFAULT_CAPTION_SETTINGS,
            "add_location": True,
        }
        customised.save()

        migration.forwards(apps, None)

        untouched = User.objects.get(pk=untouched.pk)
        self.assertEqual(untouched.llm_settings, migration.NEW_DEFAULT_CAPTION_SETTINGS)
        customised = User.objects.get(pk=customised.pk)
        self.assertFalse(customised.llm_settings["enabled"])
        self.assertTrue(customised.llm_settings["add_location"])

    def test_other_selections_are_left_alone(self):
        _set("CAPTIONING_MODEL", "none")
        _set("TAGGING_MODEL", "siglip2")

        migration.forwards(apps, None)

        self.assertEqual(_get("CAPTIONING_MODEL"), "none")
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
        _set("CAPTIONING_MODEL", "lfm2_vl_450m")
        _set("TAGGING_MODEL", "mobileclip_s2")

        migration.backwards(apps, None)

        self.assertEqual(_get("CAPTIONING_MODEL"), "im2txt")
        self.assertEqual(_get("TAGGING_MODEL"), "places365")
