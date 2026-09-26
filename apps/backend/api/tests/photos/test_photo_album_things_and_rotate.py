"""Characterization tests for ``Photo._add_to_album_thing`` and ``Photo.rotate``.

These pin the CURRENT behaviour of two high-CRAP methods on
``api.models.photo.Photo`` before they are refactored.

Everything expensive is mocked: ``Thumbnail._regenerate_thumbnails`` and
``api.models.photo.write_metadata`` (exiftool). No network, no ML models.

Quirks deliberately pinned (see inline comments):
  * ``_add_to_album_thing`` reads the tags the ACTIVE tagging model stored
    for the photo (``captions_json[TAGGING_MODEL]["tags"]``) and files the
    photo under ``<model>_tag`` albums, looked up by title, owner AND
    thing_type -- so repeated titles, second photos and reruns are all
    idempotent (the old Places365 code looked albums up without a type and
    hit the unique constraint on every repeat).
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

from constance.test import override_config
from django.test import TestCase

from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.models.user import User
from api.tests.utils import create_test_photo, create_test_user


def _tags(tags, model="mobileclip_s2"):
    return {model: {"tags": tags}}


@override_config(TAGGING_MODEL="mobileclip_s2")
class AddToAlbumThingTest(TestCase):
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
        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_captions_json_without_active_model_is_noop(self):
        photo = self._photo({"im2txt": "a dog", "siglip2": {"tags": ["dog"]}})

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_non_dict_captions_json_is_noop(self):
        """``type(x) is dict`` rejects lists (and dict subclasses)."""
        photo = create_test_photo(owner=self.user)
        PhotoCaption.objects.create(photo=photo, captions_json=["mobileclip_s2"])

        photo.refresh_from_db()
        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_non_dict_tag_result_is_noop(self):
        photo = self._photo({"mobileclip_s2": "nope"})

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    def test_missing_tags_key_and_empty_list_create_nothing(self):
        self._photo({"mobileclip_s2": {}})._add_to_album_thing()
        self._photo(_tags([]))._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 0)

    # ---- happy path ---------------------------------------------------

    def test_creates_one_typed_album_per_tag(self):
        photo = self._photo(_tags(["sunny", "natural light", "beach"]))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.count(), 3)
        for title in ("sunny", "natural light", "beach"):
            thing = AlbumThing.objects.get(title=title)
            self.assertEqual(thing.thing_type, "mobileclip_s2_tag")
            self.assertEqual(thing.owner, self.user)
            self.assertEqual(list(thing.photos.all()), [photo])

    @override_config(TAGGING_MODEL="siglip2")
    def test_active_model_decides_which_tags_and_which_type(self):
        photo = self._photo(
            {"mobileclip_s2": {"tags": ["beach"]}, "siglip2": {"tags": ["dog"]}}
        )

        photo._add_to_album_thing()

        thing = AlbumThing.objects.get()
        self.assertEqual((thing.title, thing.thing_type), ("dog", "siglip2_tag"))

    def test_photo_count_receiver_updates_count(self):
        photo = self._photo(_tags(["sunny"]))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.get(title="sunny").photo_count, 1)

    def test_second_photo_with_same_title_joins_the_same_album(self):
        first = self._photo(_tags(["sunny"]))
        second = self._photo(_tags(["sunny"]))

        first._add_to_album_thing()
        second._add_to_album_thing()

        thing = AlbumThing.objects.get(title="sunny")
        self.assertEqual(set(thing.photos.all()), {first, second})

    def test_rerunning_for_same_photo_is_idempotent(self):
        photo = self._photo(_tags(["sunny", "sunny"]))

        photo._add_to_album_thing()
        photo._add_to_album_thing()

        thing = AlbumThing.objects.get(title="sunny")
        self.assertEqual(list(thing.photos.all()), [photo])

    def test_membership_check_uses_image_hash_not_pk(self):
        """The existence check filters on ``image_hash``: a *different* photo
        sharing the hash counts as already-present, so the new photo is never
        added.
        """
        photo = self._photo(_tags(["sunny"]))
        twin = create_test_photo(owner=self.user)
        twin.image_hash = photo.image_hash
        twin.save()

        thing = AlbumThing.objects.create(
            title="sunny", owner=self.user, thing_type="mobileclip_s2_tag"
        )
        thing.photos.add(twin)

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.filter(title="sunny").count(), 1)
        self.assertEqual(list(thing.photos.all()), [twin])

    def test_albums_are_scoped_to_the_photo_owner(self):
        other = create_test_user()
        AlbumThing.objects.create(
            title="sunny", owner=other, thing_type="mobileclip_s2_tag"
        )
        photo = self._photo(_tags(["sunny"]))

        photo._add_to_album_thing()

        self.assertEqual(AlbumThing.objects.filter(title="sunny").count(), 2)
        mine = AlbumThing.objects.get(title="sunny", owner=self.user)
        self.assertEqual(list(mine.photos.all()), [photo])
        theirs = AlbumThing.objects.get(title="sunny", owner=other)
        self.assertEqual(theirs.photos.count(), 0)

    def test_untyped_album_with_same_title_is_left_alone(self):
        """A legacy NULL-typed album is a different row from the typed one."""
        legacy = AlbumThing.objects.create(title="sunny", owner=self.user)
        photo = self._photo(_tags(["sunny"]))

        photo._add_to_album_thing()

        legacy.refresh_from_db()
        self.assertEqual(legacy.photos.count(), 0)
        self.assertEqual(AlbumThing.objects.filter(title="sunny").count(), 2)


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
