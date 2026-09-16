import os
import random
import shutil
import tempfile
from unittest.mock import MagicMock, patch

import pyvips
from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher.file_handlers import (
    create_file_record,
    group_files_into_photo,
)
from api.thumbnails import _apply_local_orientation
from api.models import File, Person, Photo, Thumbnail, User
from api.models.file import calculate_hash, content_hash
from api.perceptual_hash import calculate_hash_from_thumbnail
from api.tests.utils import create_test_face, create_test_person, create_test_user

THUMBNAIL_DIRS = ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")


def _write_image(path, seed, size=(256, 256)):
    """Write a picture whose perceptual hash depends on ``seed``.

    Blocks of colour rather than a flat fill: pHash reads the low frequencies
    of the image, and every flat image hashes the same whatever its colour.
    """
    rng = random.Random(seed)
    blocks = Image.new("RGB", (8, 8))
    blocks.putdata(
        [
            (rng.randrange(256), rng.randrange(256), rng.randrange(256))
            for _ in range(8 * 8)
        ]
    )
    blocks.resize(size, Image.NEAREST).save(path, format="PNG")


class ReplacedFileTestCase(TestCase):
    """Shared fixture: a scan directory and a media root that are torn down."""

    def setUp(self):
        self.user = create_test_user()
        self.tmpdir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, True)
        for directory in THUMBNAIL_DIRS:
            os.makedirs(os.path.join(self.media_root, directory), exist_ok=True)
        media_override = override_settings(MEDIA_ROOT=self.media_root)
        media_override.enable()
        self.addCleanup(media_override.disable)
        self.path = os.path.join(self.tmpdir, "IMG_0001.png")

    def _scan(self, path=None, user=None):
        """Run the two scan phases over a single path, flushing on-commit work."""
        with self.captureOnCommitCallbacks(execute=True):
            file = create_file_record(user or self.user, path or self.path)
            self.assertIsNotNone(file)
            return group_files_into_photo(user or self.user, [file], job_id="test-job")

    def _index(self, path=None, user=None):
        """Scan, then derive what ``_process_photo`` derives from the picture.

        The perceptual hash in particular: it is what tells a rewritten file
        from a replaced one, so a fixture without it would send every test
        down the replacement path.
        """
        photo = self._scan(path, user)
        self._derive(photo)
        return photo

    def _derive(self, photo):
        thumbnail, _ = Thumbnail.objects.get_or_create(photo=photo)
        thumbnail._generate_thumbnail()
        thumbnail._calculate_aspect_ratio()
        photo.perceptual_hash = calculate_hash_from_thumbnail(
            thumbnail.thumbnail_big.path
        )
        photo.save(save_metadata=False, update_fields=["perceptual_hash"])

    def _thumbnail_path(self, photo_hash, directory="thumbnails_big"):
        return os.path.join(self.media_root, directory, photo_hash + ".webp")


class ReplacedFileRescanTest(ReplacedFileTestCase):
    """A file replaced in place (same path, different picture) must be
    re-indexed with the new content instead of keeping the stale hash."""

    def test_replaced_file_is_reindexed_with_new_content(self):
        _write_image(self.path, 1)
        old_hash = calculate_hash(self.user, self.path)
        photo = self._index()
        self.assertEqual(old_hash, photo.image_hash)

        # The user replaces the file on disk, keeping the same name.
        _write_image(self.path, 2)
        new_hash = calculate_hash(self.user, self.path)
        self.assertNotEqual(old_hash, new_hash)

        rescanned = self._scan()

        self.assertEqual(1, Photo.objects.filter(owner=self.user).count())
        self.assertEqual(1, File.objects.filter(path=self.path).count())
        self.assertEqual(new_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(new_hash, rescanned.image_hash)
        self.assertEqual(new_hash, rescanned.main_file.hash)
        self.assertFalse(File.objects.filter(hash=old_hash).exists())
        self.assertEqual(photo.pk, rescanned.pk)

    def test_thumbnails_are_rebuilt_from_the_new_content(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash
        self.assertTrue(os.path.exists(self._thumbnail_path(old_hash)))

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertFalse(os.path.exists(self._thumbnail_path(old_hash)))
        new_thumbnail_path = self._thumbnail_path(rescanned.image_hash)
        self.assertTrue(os.path.exists(new_thumbnail_path))
        # The rebuilt thumbnail shows the picture that is on disk now.
        self.assertEqual(
            calculate_hash_from_thumbnail(self.path),
            calculate_hash_from_thumbnail(new_thumbnail_path),
        )

    def test_derived_content_of_the_old_picture_is_discarded(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash
        old_added_on = photo.added_on
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()
        create_test_face(photo=photo)

        _write_image(self.path, 2)
        with patch("api.transcode_cache.discard") as discard:
            rescanned = self._scan()

        discard.assert_called_once_with(old_hash)
        self.assertEqual(0, rescanned.faces.count())
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        # The tag, geolocation and face jobs select on added_on, so the photo
        # has to look new again for them to re-derive anything.
        self.assertGreater(rescanned.added_on, old_added_on)

    def test_unchanged_file_keeps_its_record(self):
        _write_image(self.path, 1)
        photo = self._index()
        file_hash = photo.main_file.hash

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(file_hash, rescanned.main_file.hash)
        self.assertEqual(1, File.objects.filter(path=self.path).count())

    def test_replacement_with_already_indexed_content_is_left_alone(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.main_file.hash

        other_path = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(other_path, 2)
        self._index(other_path)

        # The first file is replaced by a copy of the second one.
        _write_image(self.path, 2)
        self._scan()

        self.assertEqual(old_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(2, Photo.objects.filter(owner=self.user).count())


class ReplacedFacesTest(ReplacedFileTestCase):
    """Face crops are named after the image hash, so they cannot survive a
    replacement. The people they fed have to be repaired with them."""

    def test_people_are_repaired_when_their_faces_are_discarded(self):
        _write_image(self.path, 1)
        photo = self._index()
        keeper_path = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(keeper_path, 3)
        keeper = self._index(keeper_path)

        person = create_test_person(cluster_owner=self.user, face_count=2)
        doomed_face = create_test_face(photo=photo, person=person)
        create_test_face(photo=keeper, person=person)
        person.cover_photo = photo
        person.cover_face = doomed_face
        person.save()

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertEqual(0, rescanned.faces.count())
        person.refresh_from_db()
        self.assertEqual(1, person.face_count)
        self.assertEqual(keeper.pk, person.cover_photo_id)
        self.assertNotEqual(doomed_face.pk, person.cover_face_id)
        self.assertFalse(Person.objects.filter(pk=person.pk, cover_face=None).exists())


class SharedFileAcrossUsersTest(ReplacedFileTestCase):
    """File rows and thumbnail files are shared between users who scan the
    same directory, so a replacement has to carry every photo holding the
    file across, not just the scanning user's."""

    def test_second_user_scanning_the_same_file_changes_nothing(self):
        _write_image(self.path, 1)
        photo = self._index()
        first_hash = photo.main_file.hash
        first_added_on = photo.added_on

        other_user = create_test_user()
        other_hash = calculate_hash(other_user, self.path)
        self.assertNotEqual(first_hash, other_hash)
        self.assertEqual(content_hash(first_hash), content_hash(other_hash))

        self._scan(user=other_user)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)
        self.assertEqual(first_added_on, photo.added_on)

    def test_file_indexed_by_another_user_is_left_to_their_scan(self):
        _write_image(self.path, 1)
        photo = self._index()
        first_hash = photo.main_file.hash

        other_user = create_test_user()
        _write_image(self.path, 2)
        with self.captureOnCommitCallbacks(execute=True):
            create_file_record(other_user, self.path)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)

    def test_the_other_users_photo_still_renders_after_a_replacement(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash

        other_user = create_test_user()
        other_photo = self._scan(user=other_user)
        self._derive(other_photo)
        self.assertEqual(old_hash, other_photo.image_hash)
        self.assertNotEqual(photo.pk, other_photo.pk)

        # The owner of the directory replaces the picture and rescans.
        _write_image(self.path, 2)
        rescanned = self._scan()

        other_photo.refresh_from_db()
        self.assertEqual(rescanned.image_hash, other_photo.image_hash)
        self.assertTrue(os.path.exists(self._thumbnail_path(other_photo.image_hash)))
        for directory in THUMBNAIL_DIRS:
            self.assertTrue(
                os.path.exists(self._thumbnail_path(other_photo.image_hash, directory)),
                f"{directory} thumbnail missing for the other user's photo",
            )
        self.assertFalse(os.path.exists(self._thumbnail_path(old_hash)))


def _append_a_byte(path, *args, **kwargs):
    """Stand in for exiftool: change the file's bytes without changing the picture."""
    with open(path, "ab") as f:
        f.write(b"\x00")


class MetadataWriteIsNotAReplacementTest(ReplacedFileTestCase):
    """With save_metadata_to_disk=MEDIA_FILE, LibrePhotos rewrites the original
    on every rating or face-tag change. The bytes change but the picture does
    not, so the next scan must re-key the File and nothing else."""

    def setUp(self):
        super().setUp()
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()

    def _rate_photo(self, photo, write_metadata_mock):
        """Rate a photo the way the API does, from a row loaded from the DB.

        Photo.save() only writes the tags it sees as modified, which it works
        out from the values the instance was loaded with, so a photo that was
        built in memory would silently write nothing.
        """
        loaded = Photo.objects.get(pk=photo.pk)
        with patch("api.models.photo.write_metadata", write_metadata_mock):
            loaded.rating = 4
            loaded.save()
        return loaded

    def test_rescan_after_our_own_write_only_rekeys_the_file(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        create_test_face(photo=photo)

        mock = MagicMock(side_effect=_append_a_byte)
        self._rate_photo(photo, mock)
        self.assertTrue(mock.called)

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        # The File is re-keyed so the next scan sees nothing to do ...
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)
        # ... and nothing derived from the picture is thrown away.
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertEqual(1, rescanned.faces.count())
        self.assertTrue(os.path.exists(self._thumbnail_path(image_hash)))

    def test_a_second_rescan_has_nothing_left_to_do(self):
        _write_image(self.path, 1)
        photo = self._index()
        self._rate_photo(photo, MagicMock(side_effect=_append_a_byte))
        self._scan()
        file_hash = File.objects.get(path=self.path).hash

        rescanned = self._scan()

        self.assertEqual(file_hash, rescanned.main_file.hash)
        self.assertEqual(photo.pk, rescanned.pk)

    def test_sidecar_writes_never_touch_the_media_file(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        _write_image(self.path, 1)
        photo = self._index()
        file_hash = photo.main_file.hash

        mock = MagicMock()
        self._rate_photo(photo, mock)

        self.assertTrue(mock.called)
        rescanned = self._scan()
        self.assertEqual(file_hash, rescanned.main_file.hash)


class RotationIsNotAReplacementTest(ReplacedFileTestCase):
    """Rotating a photo rewrites the original under MEDIA_FILE. The file then
    shows the picture the thumbnails already show, so the next scan must not
    read it as a replacement."""

    def setUp(self):
        super().setUp()
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()

    def _exiftool_writing_the_orientation(self, photo):
        """Stand in for exiftool writing Orientation into the media file.

        The real thing writes a tag that pyvips applies when reading, so the
        picture the file presents comes out rotated. Baking the same transform
        into the pixels reproduces that without an exiftool binary, and it uses
        the very transform the thumbnailer applies so the test cannot drift
        from the orientation convention.
        """

        def write(path, tags, **kwargs):
            image = pyvips.Image.new_from_file(path).copy_memory()
            image = _apply_local_orientation(image, photo.local_orientation)
            image.write_to_file(path)

        return write

    def _rotate(self, photo):
        loaded = Photo.objects.get(pk=photo.pk)
        with patch(
            "api.models.photo.write_metadata",
            side_effect=self._exiftool_writing_the_orientation(loaded),
        ):
            loaded.rotate(90)
        return loaded

    def test_rotating_a_photo_does_not_cost_it_its_faces(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        create_test_face(photo=photo)
        hash_before = photo.main_file.hash

        self._rotate(photo)
        self.assertNotEqual(hash_before, calculate_hash(self.user, self.path))

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)

    def test_the_rescan_still_rebuilds_what_the_new_bytes_invalidate(self):
        _write_image(self.path, 1, size=(256, 128))
        photo = self._index()
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()

        self._rotate(photo)
        rescanned = self._scan()

        self.assertIsNone(rescanned.thumbnail.dominant_color)
        self.assertTrue(os.path.exists(self._thumbnail_path(rescanned.image_hash)))


class RemovedPhotoIsNotSweptInTest(ReplacedFileTestCase):
    """manual_delete leaves a photo with its image_hash and its faces but no
    file. A replacement of a live photo with the same hash must not reach it."""

    def test_a_removed_photo_keeps_its_faces(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash

        removed = Photo(
            image_hash=old_hash,
            owner=self.user,
            added_on=photo.added_on,
            removed=True,
            main_file=None,
        )
        removed.save()
        create_test_face(photo=removed)

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertNotEqual(old_hash, rescanned.image_hash)
        removed.refresh_from_db()
        self.assertEqual(old_hash, removed.image_hash)
        self.assertEqual(1, removed.faces.count())


class UncomparableContentTest(ReplacedFileTestCase):
    """A video has no perceptual hash to compare against here. Rebuilding its
    thumbnails is cheap and safe; throwing away labelled faces is not."""

    def test_a_video_keeps_its_faces_when_its_bytes_change(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=photo, person=person)
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()

        _write_image(self.path, 2)
        with (
            patch("api.directory_watcher.file_handlers.is_video", return_value=True),
            patch("api.transcode_cache.discard") as discard,
        ):
            rescanned = self._scan()

        # Nothing a person may have corrected is thrown away ...
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        # ... while what the new bytes certainly invalidate is rebuilt.
        discard.assert_called_once_with(image_hash)
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)
        self.assertEqual(
            calculate_hash_from_thumbnail(self.path),
            calculate_hash_from_thumbnail(self._thumbnail_path(image_hash)),
        )
