"""The 0152 data migration makes OpenCLIP the only image-text model.

Exercised through the migration module's functions with the live app registry
(as ``test_onnx_only_migration`` does for 0138), on whichever database the
suite runs on: SQLite or PostgreSQL each take their own SQL path, and the
row-by-row fallback is run directly. What matters:

  * the retired model settings are dropped, other settings kept;
  * the retired taggers' tags leave ``captions_json`` (other keys stay) and
    their tag albums are deleted, OpenCLIP's and other albums kept;
  * every library with another model's embeddings (NULL included) is queued
    for re-embedding at startup, and only those;
  * the similarity index files and the retired model directories go, and a
    linked model directory is unlinked, never followed.
"""

import os
import shutil
import sys
import tempfile
import types
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from constance.models import Constance
from django.apps import apps
from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from api.batch_jobs import batch_calculate_clip_embedding
from api.models import Photo
from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.semantic_search import OPENCLIP, TAG_THING_TYPE
from api.tests.utils import create_test_photo, create_test_user

migration = import_module("api.migrations.0152_openclip_only")
RETIRED_TAGGER, OTHER_RETIRED_TAGGER = migration.RETIRED_TAG_KEYS


def _forwards():
    migration.forwards(apps, types.SimpleNamespace(connection=connection))


def _set(key, value):
    Constance.objects.update_or_create(key=key, defaults={"value": f'"{value}"'})


class RetiredSettingsTest(TestCase):
    def test_the_model_settings_are_dropped_and_others_kept(self):
        for key in migration.RETIRED_SETTINGS:
            _set(key, RETIRED_TAGGER)
        _set("CAPTIONING_MODEL", "lfm2_vl_450m")

        _forwards()

        self.assertFalse(
            Constance.objects.filter(key__in=migration.RETIRED_SETTINGS).exists()
        )
        self.assertTrue(Constance.objects.filter(key="CAPTIONING_MODEL").exists())


class RetiredTagsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _photo(self, captions_json):
        photo = create_test_photo(owner=self.user)
        PhotoCaption.objects.update_or_create(
            photo=photo, defaults={"captions_json": captions_json}
        )
        return photo

    def _captions(self, photo):
        return PhotoCaption.objects.get(photo=photo).captions_json

    def _seed(self):
        return {
            "both": self._photo(
                {
                    RETIRED_TAGGER: {"tags": ["dog"]},
                    OTHER_RETIRED_TAGGER: {"tags": ["cat"]},
                    "im2txt": "a dog",
                    "user_caption": "Rex #pets",
                    "places365": {"categories": ["park"]},
                }
            ),
            "one": self._photo(
                {RETIRED_TAGGER: {"tags": ["dog"]}, OPENCLIP: {"tags": []}}
            ),
            "untouched": self._photo({"im2txt": "a cat"}),
            "empty": self._photo(None),
        }

    def _assert_retired_keys_dropped(self, photos):
        self.assertEqual(
            self._captions(photos["both"]),
            {
                "im2txt": "a dog",
                "user_caption": "Rex #pets",
                "places365": {"categories": ["park"]},
            },
        )
        self.assertEqual(self._captions(photos["one"]), {OPENCLIP: {"tags": []}})
        self.assertEqual(self._captions(photos["untouched"]), {"im2txt": "a cat"})
        self.assertIsNone(self._captions(photos["empty"]))

    def test_retired_tags_leave_captions_json(self):
        photos = self._seed()
        _forwards()
        self._assert_retired_keys_dropped(photos)

    def test_the_row_by_row_fallback_does_the_same(self):
        photos = self._seed()
        migration.drop_retired_tags(apps.get_model("api", "PhotoCaption"), batch_size=1)
        self._assert_retired_keys_dropped(photos)

    def test_retired_tag_albums_are_deleted_and_others_kept(self):
        photo = create_test_photo(owner=self.user)
        kept = {TAG_THING_TYPE, "hashtag_attribute", "places365_attribute"}
        for thing_type in kept | set(migration.RETIRED_THING_TYPES):
            AlbumThing.objects.create(
                title=f"t-{thing_type}", owner=self.user, thing_type=thing_type
            ).photos.add(photo)

        _forwards()

        self.assertEqual(
            set(AlbumThing.objects.values_list("thing_type", flat=True)), kept
        )
        self.assertEqual(AlbumThing.objects.filter(photos=photo).count(), len(kept))


class ReEmbeddingQueuedTest(TestCase):
    """After the migration, startup re-embeds every other model's library."""

    def _user_with(self, model):
        user = create_test_user()
        photo = create_test_photo(owner=user)
        photo.clip_embeddings = [1.0]
        photo.clip_embeddings_model = model
        photo.save()
        return user

    def test_null_and_other_models_are_queued_openclip_is_not(self):
        legacy = self._user_with(None)  # CLIP ViT-B/32
        retired = self._user_with(RETIRED_TAGGER)
        current = self._user_with(OPENCLIP)
        create_test_photo(owner=create_test_user())  # never embedded

        _forwards()
        with (
            patch("django_q.tasks.AsyncTask") as task,
            patch("api.management.commands.build_similarity_index.AsyncTask"),
        ):
            call_command("build_similarity_index")

        self.assertEqual(
            {call.args for call in task.call_args_list},
            {
                (batch_calculate_clip_embedding, legacy),
                (batch_calculate_clip_embedding, retired),
            },
        )
        self.assertTrue(
            Photo.objects.filter(owner=current, clip_embeddings_model=OPENCLIP).exists()
        )


class FilesTest(TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_similarity_indices_are_removed(self):
        root = self.tmp / "similarity"
        root.mkdir()
        for name in ("1.npz", "27.npz", "notes.txt", ".1.tmp", "x.npz"):
            (root / name).write_bytes(b"x")

        removed = migration.remove_similarity_indices(root)

        self.assertEqual({p.name for p in removed}, {"1.npz", "27.npz"})
        self.assertEqual(
            {p.name for p in root.iterdir()}, {"notes.txt", ".1.tmp", "x.npz"}
        )
        self.assertEqual(migration.remove_similarity_indices(self.tmp / "nope"), [])

    def test_only_the_retired_model_directories_are_removed(self):
        models = self.tmp / "data_models"
        for name in (*migration.RETIRED_MODEL_DIRS, OPENCLIP, "face_recognition"):
            (models / name).mkdir(parents=True)
            (models / name / "model.onnx").write_bytes(b"x")

        with self.assertLogs(migration.logger, level="INFO") as logs:
            removed = migration.remove_retired_model_dirs(models)

        self.assertEqual(
            sorted(p.name for p in removed), sorted(migration.RETIRED_MODEL_DIRS)
        )
        self.assertEqual(
            {p.name for p in models.iterdir()}, {OPENCLIP, "face_recognition"}
        )
        self.assertEqual(len(logs.output), len(migration.RETIRED_MODEL_DIRS))
        # Nothing left to do the second time.
        self.assertEqual(migration.remove_retired_model_dirs(models), [])

    @unittest.skipUnless(sys.platform == "win32", "junctions are Windows only")
    def test_a_junction_is_unlinked_and_its_target_kept(self):
        import _winapi

        target = self.tmp / "elsewhere"
        target.mkdir()
        (target / "vision_model.onnx").write_bytes(b"x")
        models = self.tmp / "data_models"
        models.mkdir()
        _winapi.CreateJunction(str(target), str(models / RETIRED_TAGGER))

        removed = migration.remove_retired_model_dirs(models)

        self.assertEqual([p.name for p in removed], [RETIRED_TAGGER])
        self.assertFalse(os.path.lexists(models / RETIRED_TAGGER))
        self.assertTrue((target / "vision_model.onnx").exists())

    def test_a_symlink_is_unlinked_and_its_target_kept(self):
        target = self.tmp / "elsewhere"
        target.mkdir()
        (target / "vision_model.onnx").write_bytes(b"x")
        models = self.tmp / "data_models"
        models.mkdir()
        try:
            os.symlink(target, models / RETIRED_TAGGER, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("this account cannot create symlinks")

        removed = migration.remove_retired_model_dirs(models)

        self.assertEqual([p.name for p in removed], [RETIRED_TAGGER])
        self.assertFalse(os.path.lexists(models / RETIRED_TAGGER))
        self.assertTrue((target / "vision_model.onnx").exists())
