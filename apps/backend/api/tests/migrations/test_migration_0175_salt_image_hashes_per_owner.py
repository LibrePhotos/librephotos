import importlib
import os
import shutil
import tempfile

from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase, override_settings

from api.models import Photo
from api.models.file import hash_for_owner
from api.models.user import get_deleted_user

from ..utils import (
    create_test_face,
    create_test_file,
    create_test_photo,
    create_test_user,
)

# The module name starts with a digit, so a plain import cannot load it.
MIGRATION_NAME = "0175_salt_image_hashes_per_owner"
migration_0175 = importlib.import_module(f"api.migrations.{MIGRATION_NAME}")

THUMBNAIL_FIELDS = ("thumbnail_big", "square_thumbnail", "square_thumbnail_small")


class SaltImageHashesPerOwnerMigrationTest(TestCase):
    """Photos that took another user's salt from a shared File (#1957).

    Run on the historical models, as ``migrate`` runs it: no model method or
    signal receiver helps out.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        state = MigrationLoader(connection).project_state(("api", MIGRATION_NAME))
        cls.state_apps = state.apps

    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix="lp-0175-")
        self.addCleanup(shutil.rmtree, self.media_root, True)
        media = override_settings(MEDIA_ROOT=self.media_root)
        media.enable()
        self.addCleanup(media.disable)
        for directory in ("faces", *self._thumbnail_dirs()):
            os.makedirs(os.path.join(self.media_root, directory))

        self.alice = create_test_user()
        self.bob = create_test_user()
        self.alices = create_test_photo(owner=self.alice)
        self.old_hash = self.alices.image_hash
        # What the scan made of the second user's copy before the fix.
        self.bobs = create_test_photo(owner=self.bob, main_file=self.alices.main_file)
        self.assertEqual(self.old_hash, self.bobs.image_hash)
        self.new_hash = hash_for_owner(self.old_hash, self.bob.id)
        for photo in (self.alices, self.bobs):
            for field in THUMBNAIL_FIELDS:
                self._write(getattr(photo.thumbnail, field).name, b"thumb")

    @staticmethod
    def _thumbnail_dirs():
        return ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")

    def _write(self, name, payload):
        with open(os.path.join(self.media_root, name), "wb") as fh:
            fh.write(payload)

    def _exists(self, name):
        return os.path.exists(os.path.join(self.media_root, name))

    def _run(self):
        with self.captureOnCommitCallbacks(execute=True):
            migration_0175.salt_image_hashes_per_owner(self.state_apps, None)

    def test_the_second_owner_gets_their_own_salt(self):
        before = self.bobs.last_modified

        self._run()

        self.bobs.refresh_from_db()
        self.alices.refresh_from_db()
        self.assertEqual(self.new_hash, self.bobs.image_hash)
        self.assertEqual(self.old_hash, self.alices.image_hash)
        self.assertGreater(self.bobs.last_modified, before)
        self.assertEqual(self.bobs, Photo.objects.get(image_hash=self.new_hash))
        self.assertEqual(self.alices, Photo.objects.get(image_hash=self.old_hash))

    def test_thumbnails_are_copied_and_the_first_owners_stay(self):
        self._run()

        self.bobs.refresh_from_db()
        for field in THUMBNAIL_FIELDS:
            name = getattr(self.bobs.thumbnail, field).name
            self.assertIn(self.new_hash, name)
            self.assertTrue(self._exists(name), name)
            self.assertTrue(self._exists(getattr(self.alices.thumbnail, field).name))

    def test_old_thumbnails_nobody_holds_any_more_are_removed(self):
        old_names = [getattr(self.bobs.thumbnail, f).name for f in THUMBNAIL_FIELDS]
        # The first scanner's photo is gone; only the second owner's copy
        # carried the hash.
        Photo.objects.filter(pk=self.alices.pk).delete()

        self._run()

        for name in old_names:
            self.assertFalse(self._exists(name), name)

    def test_face_crops_move_to_the_new_name(self):
        alices_crop = f"faces/{self.old_hash}_0.jpg"
        bobs_crop = f"faces/{self.old_hash}_0_x1y2z3.jpg"
        self._write(alices_crop, b"a")
        self._write(bobs_crop, b"b")
        create_test_face(photo=self.alices, image=alices_crop)
        face = create_test_face(photo=self.bobs, image=bobs_crop)

        self._run()

        face.refresh_from_db()
        self.assertEqual(f"faces/{self.new_hash}_0_x1y2z3.jpg", face.image.name)
        self.assertTrue(self._exists(face.image.name))
        self.assertFalse(self._exists(bobs_crop))
        self.assertTrue(self._exists(alices_crop))
        # The crop route resolves the photo from the hash in the file name.
        parsed = os.path.basename(face.image.name).split("_", maxsplit=1)[0]
        self.assertEqual(self.bobs, Photo.objects.get(image_hash=parsed))

    def test_a_missing_thumbnail_file_leaves_the_row_alone(self):
        name = self.bobs.thumbnail.thumbnail_big.name
        os.remove(os.path.join(self.media_root, name))

        self._run()

        self.bobs.refresh_from_db()
        self.assertEqual(self.new_hash, self.bobs.image_hash)
        self.assertEqual(name, self.bobs.thumbnail.thumbnail_big.name)

    def test_photos_salted_for_their_owner_are_left_alone(self):
        own = create_test_photo(owner=self.bob)
        before = (own.image_hash, own.last_modified)

        self._run()

        own.refresh_from_db()
        self.assertEqual(before, (own.image_hash, own.last_modified))

    def test_the_deleted_placeholder_users_photos_keep_their_hashes(self):
        deleted = get_deleted_user()
        left_behind = create_test_photo(owner=self.alice)
        Photo.objects.filter(pk=left_behind.pk).update(owner=deleted)

        self._run()

        left_behind.refresh_from_db()
        self.assertEqual(left_behind.main_file.hash, left_behind.image_hash)

    def test_a_hash_that_is_not_md5_and_user_id_is_left_alone(self):
        odd = create_test_photo(owner=self.bob)
        Photo.objects.filter(pk=odd.pk).update(image_hash="not-an-md5-hash")

        self._run()

        odd.refresh_from_db()
        self.assertEqual("not-an-md5-hash", odd.image_hash)

    def test_a_taken_hash_is_left_alone(self):
        # The second owner already has a photo under their own salt.
        file = create_test_file(None, hash_value=self.new_hash)
        create_test_photo(owner=self.bob, main_file=file)

        self._run()

        self.bobs.refresh_from_db()
        self.assertEqual(self.old_hash, self.bobs.image_hash)

    def test_running_twice_changes_nothing_more(self):
        self._run()
        self.bobs.refresh_from_db()
        first = (self.bobs.image_hash, self.bobs.last_modified)

        self._run()

        self.bobs.refresh_from_db()
        self.assertEqual(first, (self.bobs.image_hash, self.bobs.last_modified))

    def test_owner_salted_reads_only_md5_plus_a_user_id(self):
        md5 = "0123456789abcdef0123456789abcdef"
        self.assertEqual(md5 + "2", migration_0175.owner_salted(md5 + "1", 2))
        self.assertIsNone(migration_0175.owner_salted(md5 + "2", 2))
        self.assertIsNone(migration_0175.owner_salted(md5, 2))
        self.assertIsNone(migration_0175.owner_salted(md5.upper() + "1", 2))
        self.assertIsNone(migration_0175.owner_salted("short1", 2))
