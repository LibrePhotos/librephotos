"""Every write of a column the mobile delta feed sends moves ``last_modified``.

``GET /api/sync/<entity>/`` sends a row again only when its ``last_modified``
moved past the phone's cursor, and ``auto_now`` skips a queryset ``update()``,
a ``bulk_update()`` and a ``save(update_fields=[...])`` that does not name it
(``api.models.synced``). The guard below fails on a feed column its model
does not list in ``SYNCED_FIELDS``, and on a column of a related row the feed
starts to send without a writer that bumps the photo.
"""

import uuid
from datetime import datetime, timedelta
from unittest import mock

from django.core.exceptions import FieldDoesNotExist
from django.db import models
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumThing, Person, Photo, Tag
from api.models.synced import SyncedModel
from api.models.tag import refresh_tag_photo_counts
from api.tests.utils import (
    create_test_album_thing,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
    share_test_photos,
)
from api.thumbnails import render
from api.views import sync

# Feeds whose rows are not a SyncedModel, with the reason.
NOT_SYNCED_MODELS = {
    # The profile fields change only through a full save of the user.
    sync.SyncSharingView: "user profiles",
}

# Columns of related rows the photo feed sends, and what bumps the photo.
RELATED_PHOTO_COLUMNS = {
    "thumbnail__aspect_ratio": "render.calculate_aspect_ratio",
    "thumbnail__dominant_color": "render.calculate_dominant_color",
    "search_instance__search_location": "the place writers save GEOCODED_COLUMNS",
    "owner__favorite_min_rating": "the phone keeps the last one it saw",
}


def _feed_views() -> list[type[sync.BaseSyncView[models.Model]]]:
    return [
        view
        for view in vars(sync).values()
        if isinstance(view, type)
        and issubclass(view, sync.BaseSyncView)
        and view is not sync.BaseSyncView
    ]


def _concrete_name(model: type[models.Model], name: str) -> str | None:
    """The field ``name`` (or attname) is, or None for an annotation."""
    try:
        return model._meta.get_field(name).name
    except FieldDoesNotExist:
        return None


def _age[M: models.Model](row: M) -> datetime:
    """Put the row's ``last_modified`` a day back; that time."""
    before = timezone.now() - timedelta(days=1)
    type(row)._default_manager.filter(pk=row.pk).update(last_modified=before)
    return before


def _last_modified(row: models.Model) -> datetime:
    value = (
        type(row)
        ._default_manager.filter(pk=row.pk)
        .values_list("last_modified", flat=True)[0]
    )
    assert isinstance(value, datetime)
    return value


class FeedColumnsAreSyncedFieldsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_every_feed_column_is_listed_on_its_model(self):
        for view in _feed_views():
            model = view().scoped_queryset(self.user).model
            if view in NOT_SYNCED_MODELS:
                continue
            with self.subTest(view=view.__name__):
                self.assertTrue(issubclass(model, SyncedModel), model)
                assert issubclass(model, SyncedModel)
                for name in view.values_fields:
                    if "__" in name:
                        continue
                    field = _concrete_name(model, name)
                    if field in (None, "id", "last_modified"):
                        continue
                    self.assertIn(field, model.SYNCED_FIELDS, name)

    def test_every_related_photo_column_has_a_writer_that_bumps(self):
        related = {name for name in sync.SyncPhotosView.values_fields if "__" in name}
        self.assertEqual(related, set(RELATED_PHOTO_COLUMNS))


class QuerysetWritesBumpTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_an_update_of_a_synced_column_bumps(self):
        photo = create_test_photo(owner=self.user)
        before = _age(photo)

        Photo.objects.filter(pk=photo.pk).update(rating=4)

        self.assertGreater(_last_modified(photo), before)

    def test_an_update_of_bookkeeping_only_does_not_bump(self):
        photo = create_test_photo(owner=self.user)
        before = _age(photo)

        Photo.objects.filter(pk=photo.pk).update(ocr_failures=2, faces_scanned_at=None)

        self.assertEqual(_last_modified(photo), before)

    def test_an_explicit_last_modified_is_kept(self):
        photo = create_test_photo(owner=self.user)
        then = timezone.now() - timedelta(hours=3)

        Photo.objects.filter(pk=photo.pk).update(hidden=True, last_modified=then)

        self.assertEqual(_last_modified(photo), then)

    def test_a_foreign_key_attname_counts(self):
        person = create_test_person(cluster_owner=self.user)
        photo = create_test_photo(owner=self.user)
        before = _age(person)

        Person.objects.filter(pk=person.pk).update(cover_photo_id=photo.pk)

        self.assertGreater(_last_modified(person), before)

    def test_a_bulk_update_of_a_synced_column_bumps(self):
        photo = create_test_photo(owner=self.user)
        before = _age(photo)
        photo.refresh_from_db()
        photo.video = True

        Photo.objects.bulk_update([photo], ["video"])

        self.assertGreater(_last_modified(photo), before)

    def test_refreshed_tag_counts_reach_the_feed(self):
        tag = create_test_tag(self.user)
        tag.photos.add(create_test_photo(owner=self.user))
        Tag.objects.filter(pk=tag.pk).update(photo_count=0)
        before = _age(tag)

        refresh_tag_photo_counts([tag.pk])

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)
        self.assertGreater(tag.last_modified, before)


class SaveWithUpdateFieldsBumpsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_a_thing_album_count_saved_alone_bumps(self):
        album = create_test_album_thing(self.user)
        before = _age(album)
        album = AlbumThing.objects.get(pk=album.pk)
        album.photo_count = 7

        album.save(update_fields=["photo_count"])

        self.assertGreater(_last_modified(album), before)

    def test_a_person_cover_saved_alone_bumps(self):
        person = create_test_person(cluster_owner=self.user)
        before = _age(person)
        person = Person.objects.get(pk=person.pk)
        person.cover_photo = create_test_photo(owner=self.user)

        person.save(update_fields=["cover_photo"])

        self.assertGreater(_last_modified(person), before)

    def test_a_save_of_other_columns_does_not_bump(self):
        photo = create_test_photo(owner=self.user)
        before = _age(photo)
        photo = Photo.objects.get(pk=photo.pk)
        photo.perceptual_hash = "ffff"

        photo.save(update_fields=["perceptual_hash"])

        self.assertEqual(_last_modified(photo), before)


class ThumbnailColumnsBumpThePhotoTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_a_new_aspect_ratio_bumps_the_photo(self):
        photo = create_test_photo(owner=self.user)
        thumbnail = photo.thumbnail
        thumbnail.aspect_ratio = None
        thumbnail.save()
        before = _age(photo)
        image = mock.MagicMock(size=(300, 200))
        image.__enter__.return_value = image

        with mock.patch.object(render.Image, "open", return_value=image):
            render.calculate_aspect_ratio(thumbnail)

        self.assertEqual(thumbnail.aspect_ratio, 1.5)
        self.assertGreater(_last_modified(photo), before)

    def test_the_same_aspect_ratio_does_not_bump(self):
        photo = create_test_photo(owner=self.user)
        thumbnail = photo.thumbnail
        thumbnail.aspect_ratio = 1.5
        thumbnail.save()
        before = _age(photo)
        image = mock.MagicMock(size=(300, 200))
        image.__enter__.return_value = image

        with mock.patch.object(render.Image, "open", return_value=image):
            render.calculate_aspect_ratio(thumbnail)

        self.assertEqual(_last_modified(photo), before)

    def test_a_new_dominant_color_bumps_the_photo(self):
        photo = create_test_photo(owner=self.user)
        thumbnail = photo.thumbnail
        thumbnail.dominant_color = None
        thumbnail.save()
        before = _age(photo)

        with mock.patch.object(render, "_most_common_color", return_value=[1, 2, 3]):
            render.calculate_dominant_color(thumbnail)

        self.assertGreater(_last_modified(photo), before)


class LibraryShareChangesResendSharedPhotosTest(TestCase):
    """The feed redacts a shared photo by its owner's library share (#2731),
    so starting, changing or ending the share re-sends those photos."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.photo = create_test_photo(owner=self.owner, exif_gps_lat=52.5)
        share_test_photos([self.photo.pk], self.recipient)
        self.client = APIClient()
        self.client.force_authenticate(user=self.recipient)

    def _pull_since(self, cursor: datetime) -> list[dict[str, object]]:
        token = sync.encode_cursor(cursor, uuid.UUID(int=2**128 - 1))
        response = self.client.get("/api/sync/photos/", {"cursor": token})
        return response.json()["items"]

    def test_a_new_share_resends_the_photo_redacted(self):
        before = _age(self.photo)

        create_test_library_share(self.owner, self.recipient)

        items = self._pull_since(before)
        self.assertEqual([item["id"] for item in items], [str(self.photo.pk)])
        self.assertIsNone(items[0]["latitude"])

    def test_a_switch_turned_off_resends_the_photo(self):
        share = create_test_library_share(
            self.owner, self.recipient, share_location=True
        )
        before = _age(self.photo)
        share.share_location = False

        share.save(update_fields=["share_location"])

        items = self._pull_since(before)
        self.assertEqual([item["id"] for item in items], [str(self.photo.pk)])
        self.assertIsNone(items[0]["latitude"])

    def test_a_copy_budget_write_does_not_resend(self):
        share = create_test_library_share(self.owner, self.recipient)
        before = _age(self.photo)
        share.copies_made = 3

        share.save(update_fields=["copies_made"])

        self.assertEqual(self._pull_since(before), [])

    def test_ending_the_share_resends_the_photo_whole(self):
        share = create_test_library_share(self.owner, self.recipient)
        before = _age(self.photo)

        response = APIClient()
        response.force_authenticate(user=self.owner)
        self.assertEqual(
            response.delete(f"/api/library-shares/{share.pk}/").status_code, 204
        )

        items = self._pull_since(before)
        self.assertEqual([item["id"] for item in items], [str(self.photo.pk)])
        self.assertEqual(items[0]["latitude"], 52.5)
