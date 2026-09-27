"""Characterization tests for ``Photo.rotate``, a high-CRAP function.

Everything expensive is mocked: ``Thumbnail._regenerate_thumbnails`` and
``api.metadata.photo_writer.write_metadata`` (exiftool). No network, no ML models.

Quirks deliberately pinned (see inline comments):
  * ``rotate`` normalises the angle with ``% 360`` BEFORE the multiple-of-90
    validation, so ``angle=-90`` is valid (becomes 270) and ``angle=360``
    becomes a no-op.
  * ``rotate(0, flip_horizontal=False)`` returns before touching the DB or
    thumbnails.
  * Under MEDIA_FILE, a format that renders its EXIF orientation gets the
    whole rotation written into the file, starting from the file's own tag;
    once exiftool is confirmed to have written it, ``local_orientation``
    goes back to 1 (#2050). Anything else (sidecar, HEIC and the like, an
    unreadable file) writes the stored ``photo.metadata.orientation``
    (default 1 when missing/absent) composed with the delta -- NOT the new
    ``local_orientation`` -- and keeps the rotation in the database.
"""

from unittest.mock import patch

from django.test import TestCase

from api.models.photo_metadata import PhotoMetadata
from api.models.user import User
from api.tests.utils import create_test_photo, create_test_user


class RotateCharacterizationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.on_disk = {}
        patcher = patch(
            "api.metadata.writer.read_orientation",
            side_effect=lambda path: self.on_disk.get(path, 1),
        )
        self.read_orientation = patcher.start()
        self.addCleanup(patcher.stop)

    # ---- validation / early exit --------------------------------------

    def test_non_multiple_of_90_raises_value_error(self):
        with self.assertRaises(ValueError):
            self.photo.rotate(45)
        self.assertEqual(self.photo.local_orientation, 1)

    def test_negative_non_multiple_of_90_raises_value_error(self):
        with self.assertRaises(ValueError):
            self.photo.rotate(-45)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_zero_angle_without_flip_is_noop(self, regen):
        self.photo.rotate(0)

        regen.assert_not_called()
        self.assertEqual(self.photo.local_orientation, 1)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_360_normalises_to_zero_and_is_noop(self, regen):
        self.photo.rotate(360)

        regen.assert_not_called()
        self.assertEqual(self.photo.local_orientation, 1)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_zero_angle_with_flip_still_applies(self, regen):
        self.photo.rotate(0, flip_horizontal=True)

        regen.assert_called_once()
        self.assertEqual(self.photo.local_orientation, 2)

    # ---- rotation maths / persistence ---------------------------------

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_90_sets_orientation_6_and_persists(self, regen):
        self.photo.rotate(90)

        regen.assert_called_once()
        self.assertEqual(self.photo.local_orientation, 6)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.local_orientation, 6)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_180_sets_orientation_3(self, regen):
        self.photo.rotate(180)
        self.assertEqual(self.photo.local_orientation, 3)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_negative_90_normalises_to_270(self, regen):
        self.photo.rotate(-90)
        self.assertEqual(self.photo.local_orientation, 8)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_rotations_accumulate(self, regen):
        self.photo.rotate(90)
        self.photo.rotate(90)

        self.assertEqual(self.photo.local_orientation, 3)
        self.assertEqual(regen.call_count, 2)

    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_90_with_flip(self, regen):
        self.photo.rotate(90, flip_horizontal=True)
        self.assertEqual(self.photo.local_orientation, 7)

    # ---- metadata-to-disk branch --------------------------------------
    #
    # ``read_orientation`` (exiftool reading the media file) is replaced by a
    # dict standing in for the file's EXIF Orientation. A mocked
    # ``write_metadata`` leaves it alone, like an exiftool write that failed;
    # ``_writes_land`` makes it update the dict, like one that worked.
    #
    # The frontend's clockwise button sends -90: ``Photo.rotate`` counts its
    # angle counter-clockwise as rendered, so local 8 is a clockwise quarter
    # turn on screen and EXIF 6 is the value that shows it.

    def _media_file_photo(self, orientation=1):
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, orientation=orientation)
        photo.refresh_from_db()
        return photo

    def _file_says(self, photo, orientation):
        self.on_disk[photo.main_file.path] = orientation

    def _writes_land(self, write_metadata):
        def write(path, tags, use_sidecar=True):
            self.on_disk[path] = next(iter(tags.values()))

        write_metadata.side_effect = write

    def _written(self, write_metadata):
        return list(write_metadata.call_args[0][1].values())

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_save_metadata_off_does_not_write(self, regen, write_metadata):
        self.photo.rotate(90)

        write_metadata.assert_not_called()

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_media_file_mode_writes_without_sidecar(self, regen, write_metadata):
        photo = self._media_file_photo()

        photo.rotate(-90)

        write_metadata.assert_called_once()
        args, kwargs = write_metadata.call_args
        self.assertEqual(args[0], photo.main_file.path)
        # upright file + a clockwise quarter turn == exif 6
        self.assertEqual(list(args[1].values()), [6])
        self.assertFalse(kwargs["use_sidecar"])

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_sidecar_mode_sets_use_sidecar(self, regen, write_metadata):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        photo.refresh_from_db()

        photo.rotate(180)

        self.assertTrue(write_metadata.call_args.kwargs["use_sidecar"])

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_a_confirmed_write_moves_the_rotation_into_the_file(
        self, regen, write_metadata
    ):
        """#2050: once the file's own EXIF carries the rotation,
        ``local_orientation`` goes back to 1 so a rebuild does not apply it a
        second time, and the stored exif orientation becomes what was written.
        """
        photo = self._media_file_photo()
        self._writes_land(write_metadata)

        photo.rotate(-90)

        self.assertEqual(self._written(write_metadata), [6])
        self.assertEqual(photo.local_orientation, 1)
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 1)
        self.assertEqual(photo.metadata.orientation, 6)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_written_value_starts_from_the_files_own_orientation(
        self, regen, write_metadata
    ):
        """A photo shot rotated (exif 6) and turned another quarter clockwise
        gets 3 on disk. The base is the file, not ``PhotoMetadata.orientation``,
        which the scan never fills in: from there the file would be written
        back as 6, unchanged, and the rotation lost with ``local_orientation``.
        """
        photo = self._media_file_photo(orientation=None)
        self._file_says(photo, 6)
        self._writes_land(write_metadata)

        photo.rotate(-90)

        self.assertEqual(self._written(write_metadata), [3])
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 1)
        self.assertEqual(photo.metadata.orientation, 3)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_media_file_rotate_does_not_stack_on_a_second_rotate(
        self, regen, write_metadata
    ):
        """#2050: the second rotate composes from the value actually on disk.

        Before the fix the second rotate composed from the stale stored exif
        orientation, so it wrote the same value as the first one.
        """
        photo = self._media_file_photo()
        self._writes_land(write_metadata)

        photo.rotate(-90)
        self.assertEqual(self._written(write_metadata), [6])

        photo.rotate(-90)
        # A clockwise quarter turn on top of exif 6 is 180, not 6 again.
        self.assertEqual(self._written(write_metadata), [3])
        self.assertEqual(photo.local_orientation, 1)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_a_write_that_does_not_land_keeps_local_orientation(
        self, regen, write_metadata
    ):
        """exiftool reports a failed write (read-only library, locked file) on
        stdout and PyExifTool does not raise. The file still says 1, so the
        rotation must stay in the database."""
        photo = self._media_file_photo()

        with self.assertLogs("api.metadata.photo_writer", "WARNING") as logs:
            photo.rotate(-90)

        write_metadata.assert_called_once()
        self.assertIn("was not written", logs.output[0])
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 8)
        self.assertEqual(photo.metadata.orientation, 1)

    @patch("api.thumbnails.renders_exif_orientation", return_value=False)
    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_a_format_that_ignores_exif_orientation_keeps_local_orientation(
        self, regen, write_metadata, renders
    ):
        """HEIC and the like render without the EXIF orientation exiftool
        writes, so resetting ``local_orientation`` would lose the rotation.
        The tag is still written for other viewers, as before."""
        photo = self._media_file_photo()
        self._writes_land(write_metadata)

        photo.rotate(90)

        self.assertEqual(self._written(write_metadata), [6])
        self.read_orientation.assert_not_called()
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 6)
        self.assertEqual(photo.metadata.orientation, 1)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_an_unreadable_file_is_not_folded(self, regen, write_metadata):
        photo = self._media_file_photo()
        self._file_says(photo, None)

        photo.rotate(90)

        self.assertEqual(self._written(write_metadata), [6])
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 6)

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_sidecar_rotate_keeps_local_orientation(self, regen, write_metadata):
        """A sidecar leaves the image bytes alone, so the renderer still needs
        ``local_orientation`` to know about the rotation."""
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, orientation=1)
        photo.refresh_from_db()

        photo.rotate(90)

        self.assertEqual(self._written(write_metadata), [6])
        self.read_orientation.assert_not_called()
        self.assertEqual(photo.local_orientation, 6)
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 6)
        self.assertEqual(photo.metadata.orientation, 1)

    @patch("api.thumbnails.renders_exif_orientation", return_value=False)
    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_missing_metadata_row_defaults_exif_orientation_to_1(
        self, regen, write_metadata, renders
    ):
        """Without the file to go on, the value composes the stored exif
        orientation, 1 when there is no ``PhotoMetadata`` row."""
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)  # no PhotoMetadata created
        photo.refresh_from_db()

        photo.rotate(90)

        self.assertEqual(self._written(write_metadata), [6])

    @patch("api.thumbnails.renders_exif_orientation", return_value=False)
    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_null_exif_orientation_falls_back_to_1(
        self, regen, write_metadata, renders
    ):
        photo = self._media_file_photo(orientation=None)

        photo.rotate(180)

        self.assertEqual(self._written(write_metadata), [3])

    @patch("api.metadata.photo_writer.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_thumbnails_regenerated_before_metadata_write(self, regen, write_metadata):
        """Ordering contract: the DB save + thumbnail regeneration happen
        first; a failing disk write leaves the rotation already persisted.
        """
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        photo.refresh_from_db()
        write_metadata.side_effect = RuntimeError("exiftool exploded")

        with self.assertRaises(RuntimeError):
            photo.rotate(90)

        regen.assert_called_once()
        photo.refresh_from_db()
        self.assertEqual(photo.local_orientation, 6)
