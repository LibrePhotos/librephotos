"""Characterization tests for ``Photo._add_to_album_thing`` and ``Photo.rotate``.

These pin the CURRENT behaviour of two high-CRAP methods on
``api.models.photo.Photo`` before they are refactored.

Everything expensive is mocked: ``Thumbnail._regenerate_thumbnails`` and
``api.models.photo.write_metadata`` (exiftool). No network, no ML models.

Quirks deliberately pinned (see inline comments):
  * BUG (pinned, not fixed): ``_add_to_album_thing`` calls
    ``get_album_thing(title=..., owner=...)`` WITHOUT ``thing_type``, so the
    get_or_create lookup is always ``thing_type=None`` -- but the method then
    stamps ``places365_attribute`` / ``places365_category`` on the row. Any
    later call for the same title therefore misses the existing album,
    creates a duplicate NULL-typed row, and its final ``save()`` violates the
    ``(title, thing_type, owner)`` unique constraint -> ``IntegrityError``.
    This fires for a repeated title in one list, for a second photo with the
    same title, and for re-running the method on the same photo.
  * A title present in both ``attributes`` and ``categories`` escapes that
    collision (the two rows differ in ``thing_type``) and yields two albums.
  * ``captions_json`` that is a non-dict (e.g. a list) is rejected by the
    ``type(...) is dict`` check.
  * ``rotate`` normalises the angle with ``% 360`` BEFORE the multiple-of-90
    validation, so ``angle=-90`` is valid (becomes 270) and ``angle=360``
    becomes a no-op.
  * ``rotate(0, flip_horizontal=False)`` returns before touching the DB or
    thumbnails.
  * The disk write uses the ORIGINAL exif orientation from
    ``photo.metadata.orientation`` (default 1 when missing/absent) composed
    with the delta -- NOT the new ``local_orientation``.
"""

from unittest.mock import patch

from django.db.utils import IntegrityError
from django.test import TestCase

from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.models.user import User
from api.tests.utils import create_test_photo, create_test_user


def _places365(attributes=None, categories=None):
    return {
        "places365": {
            "attributes": attributes if attributes is not None else [],
            "categories": categories if categories is not None else [],
        }
    }


class AddToAlbumThingCharacterizationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _photo(self, captions_json):
        return create_test_photo(owner=self.user, captions_json=captions_json)

    # ---- guard clauses (no album things created) ----------------------

    def test_no_caption_instance_is_noop(self):
        photo = create_test_photo(owner=self.user)
        self.assertFalse(hasattr(photo, "caption_instance"))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_empty_captions_json_is_noop(self):
        photo = self._photo({})
        # falsy dict short-circuits before the places365 lookup
        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_captions_json_without_places365_is_noop(self):
        photo = self._photo({"im2txt": "a dog"})

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_non_dict_captions_json_is_noop(self):
        """``type(x) is dict`` rejects lists (and dict subclasses)."""
        photo = create_test_photo(owner=self.user)
        PhotoCaption.objects.create(photo=photo, captions_json=["places365"])

        photo.refresh_from_db()
        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_missing_attributes_key_raises_keyerror(self):
        """No defensive ``.get()``: a malformed places365 payload blows up."""
        photo = self._photo({"places365": {"categories": ["outdoor"]}})

        with self.assertRaises(KeyError):
            photo._add_to_album_thing()

    def test_missing_categories_key_raises_keyerror_after_attributes(self):
        photo = self._photo({"places365": {"attributes": ["sunny"]}})

        with self.assertRaises(KeyError):
            photo._add_to_album_thing()

        # the attributes loop already ran and committed its album thing
        self.assertTrue(
            AlbumThing.objects.filter(
                title="sunny", thing_type="places365_attribute"
            ).exists()
        )

    def test_empty_lists_create_nothing(self):
        photo = self._photo(_places365([], []))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    # ---- happy path ---------------------------------------------------

    def test_creates_attribute_and_category_album_things(self):
        photo = self._photo(
            _places365(attributes=["sunny", "natural light"], categories=["beach"])
        )

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 3)
        for title in ("sunny", "natural light"):
            thing = AlbumThing.objects.get(title=title)
            self.assertEqual(thing.thing_type, "places365_attribute")
            self.assertEqual(thing.owner, self.user)
            self.assertEqual(list(thing.photos.all()), [photo])
        beach = AlbumThing.objects.get(title="beach")
        self.assertEqual(beach.thing_type, "places365_category")
        self.assertEqual(list(beach.photos.all()), [photo])

    def test_photo_count_receiver_updates_count(self):
        photo = self._photo(_places365(attributes=["sunny"]))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.get(title="sunny").photo_count, 1)

    def test_second_photo_with_same_title_raises_integrity_error(self):
        """BUG, pinned as-is. ``get_album_thing`` is called WITHOUT
        ``thing_type``, so the lookup is ``(title, owner, thing_type=None)``.
        The album saved by the first photo now has
        ``thing_type='places365_attribute'`` and is therefore invisible to
        that lookup: a fresh ``thing_type=None`` row is created, the photo is
        added, and the final ``save()`` -- which stamps
        ``places365_attribute`` -- collides with the first row on the
        ``(title, thing_type, owner)`` unique constraint.

        Net effect in production: the second photo is never grouped, and the
        caller sees an IntegrityError. A refactor that passes ``thing_type``
        into ``get_album_thing`` would fix this; the test must then be
        updated deliberately.
        """
        first = self._photo(_places365(attributes=["sunny"]))
        second = self._photo(_places365(attributes=["sunny"]))

        first._add_to_album_thing()
        with self.assertRaises(IntegrityError):
            second._add_to_album_thing()

    def test_rerunning_for_same_photo_raises_integrity_error(self):
        """Not idempotent: the second call cannot find the album (its
        ``thing_type`` is no longer ``None``) and its duplicate collides.
        """
        photo = self._photo(_places365(attributes=["sunny"]))

        photo._add_to_album_thing()
        with self.assertRaises(IntegrityError):
            photo._add_to_album_thing()

    def test_membership_check_uses_image_hash_not_pk(self):
        """The existence check filters on ``image_hash``: a *different* photo
        sharing the hash counts as already-present, so the new photo is never
        added and ``thing_type`` is left untouched (``None``).
        """
        photo = self._photo(_places365(attributes=["sunny"]))
        twin = create_test_photo(owner=self.user)
        twin.image_hash = photo.image_hash
        twin.save()

        thing = AlbumThing.objects.create(title="sunny", owner=self.user)
        thing.photos.add(twin)

        photo._add_to_album_thing()

        thing.refresh_from_db()
        self.assertEqual(AlbumThing.objects.filter(title="sunny").count(), 1)
        self.assertIsNone(thing.thing_type)
        self.assertEqual(list(thing.photos.all()), [twin])

    def test_title_in_both_lists_creates_two_rows(self):
        """The category pass cannot see the attribute album (thing_type no
        longer NULL), so it creates a second row -- which happens to be legal
        because ``(beach, places365_category, owner)`` is free. The photo ends
        up in both.
        """
        photo = self._photo(_places365(attributes=["beach"], categories=["beach"]))

        photo._add_to_album_thing()

        things = AlbumThing.objects.filter(title="beach")
        self.assertEqual(things.count(), 2)
        self.assertEqual(
            sorted(t.thing_type for t in things),
            ["places365_attribute", "places365_category"],
        )
        for thing in things:
            self.assertEqual(list(thing.photos.all()), [photo])

    def test_albums_are_scoped_to_the_photo_owner(self):
        other = create_test_user()
        AlbumThing.objects.create(title="sunny", owner=other)
        photo = self._photo(_places365(attributes=["sunny"]))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.filter(title="sunny").count(), 2)
        mine = AlbumThing.objects.get(title="sunny", owner=self.user)
        self.assertEqual(mine.thing_type, "places365_attribute")
        theirs = AlbumThing.objects.get(title="sunny", owner=other)
        self.assertIsNone(theirs.thing_type)
        self.assertEqual(theirs.photos.count(), 0)

    def test_duplicate_titles_within_one_list_raise_integrity_error(self):
        """Same root cause as the two-photo case: the second occurrence of the
        title re-creates a NULL-typed row whose save collides.
        """
        photo = self._photo(_places365(attributes=["sunny", "sunny"]))

        with self.assertRaises(IntegrityError):
            photo._add_to_album_thing()


class RotateCharacterizationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

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

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_save_metadata_off_does_not_write(self, regen, write_metadata):
        self.photo.rotate(90)

        write_metadata.assert_not_called()

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_media_file_mode_writes_without_sidecar(self, regen, write_metadata):
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, orientation=1)
        photo.refresh_from_db()

        photo.rotate(90)

        write_metadata.assert_called_once()
        args, kwargs = write_metadata.call_args
        self.assertEqual(args[0], photo.main_file.path)
        # Tags.ORIENTATION -> composed value; exif 1 + 90cw == 6
        self.assertEqual(list(args[1].values()), [6])
        self.assertFalse(kwargs["use_sidecar"])

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_sidecar_mode_sets_use_sidecar(self, regen, write_metadata):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        photo.refresh_from_db()

        photo.rotate(180)

        self.assertTrue(write_metadata.call_args.kwargs["use_sidecar"])

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_missing_metadata_row_defaults_exif_orientation_to_1(
        self, regen, write_metadata
    ):
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)  # no PhotoMetadata created
        photo.refresh_from_db()

        photo.rotate(90)

        self.assertEqual(list(write_metadata.call_args[0][1].values()), [6])

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_written_value_composes_original_exif_not_local_orientation(
        self, regen, write_metadata
    ):
        """The disk value is composed from the file's ORIGINAL exif
        orientation, so a photo shot rotated (exif 6) and rotated another 90
        CW gets 3 on disk while ``local_orientation`` only reflects the
        LibrePhotos-local delta (6).
        """
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, orientation=6)
        photo.refresh_from_db()

        photo.rotate(90)

        self.assertEqual(photo.local_orientation, 6)
        self.assertEqual(list(write_metadata.call_args[0][1].values()), [3])

    @patch("api.models.photo.write_metadata")
    @patch("api.models.thumbnail.Thumbnail._regenerate_thumbnails")
    def test_null_exif_orientation_falls_back_to_1(self, regen, write_metadata):
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, orientation=None)
        photo.refresh_from_db()

        photo.rotate(180)

        self.assertEqual(list(write_metadata.call_args[0][1].values()), [3])

    @patch("api.models.photo.write_metadata")
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
