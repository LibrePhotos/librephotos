"""Tests for keeping ``Tag.photo_count`` true when photos stop counting.

The ``m2m_changed`` receiver on ``Tag.photos`` only fires when a photo is
attached to or detached from a tag. Everything here covers the other ways a
photo leaves a tag's count -- trashed, hidden, or deleted outright -- which
fire no signal at all.
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.models import Photo, Tag
from api.models.tag import refresh_tag_photo_counts, tag_ids_for_photos
from api.tests.utils import create_test_photo, create_test_photos, create_test_user


def _results(response):
    data = response.json()
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


class TagPhotoCountStaysTrueTest(TestCase):
    """``photo_count`` when a photo stops counting without leaving the tag.

    The ``m2m_changed`` receiver only fires on attach/detach. A photo that is
    trashed, hidden or deleted outright keeps (or loses) its through-row
    without any signal, and the stored count used to be left behind -- an
    emptied tag showed "1 photo" over a placeholder tile.
    """

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)
        self.tag = Tag.objects.create(name="beach", owner=self.user)
        self.tag.photos.add(*self.photos)
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.photo_count, 2)

    def _count(self):
        self.tag.refresh_from_db()
        return self.tag.photo_count

    def test_trashing_a_photo_drops_it_from_the_count(self):
        self.client.post(
            "/api/photosedit/setdeleted",
            {"image_hashes": [self.photos[0].image_hash], "deleted": True},
            format="json",
        )

        self.assertEqual(self._count(), 1)

    def test_restoring_a_photo_brings_it_back_to_the_count(self):
        self.client.post(
            "/api/photosedit/setdeleted",
            {"image_hashes": [self.photos[0].image_hash], "deleted": True},
            format="json",
        )
        self.client.post(
            "/api/photosedit/setdeleted",
            {"image_hashes": [self.photos[0].image_hash], "deleted": False},
            format="json",
        )

        self.assertEqual(self._count(), 2)

    def test_trashing_through_select_all_drops_the_photos(self):
        self.client.post(
            "/api/photosedit/setdeleted",
            {"select_all": True, "query": {}, "deleted": True},
            format="json",
        )

        self.assertEqual(self._count(), 0)

    def test_hiding_a_photo_drops_it_from_the_count(self):
        self.client.post(
            "/api/photosedit/hide",
            {"image_hashes": [self.photos[0].image_hash], "hidden": True},
            format="json",
        )

        self.assertEqual(self._count(), 1)

    def test_unhiding_a_photo_brings_it_back(self):
        self.client.post(
            "/api/photosedit/hide",
            {"image_hashes": [self.photos[0].image_hash], "hidden": True},
            format="json",
        )
        self.client.post(
            "/api/photosedit/hide",
            {"image_hashes": [self.photos[0].image_hash], "hidden": False},
            format="json",
        )

        self.assertEqual(self._count(), 2)

    def test_hiding_through_select_all_drops_the_photos(self):
        self.client.post(
            "/api/photosedit/hide",
            {"select_all": True, "query": {}, "hidden": True},
            format="json",
        )

        self.assertEqual(self._count(), 0)

    def test_the_tag_survives_losing_its_last_photo(self):
        # Deliberate: a tag can be created before anything carries it, and
        # deleting photos must not silently delete tags.
        self.client.post(
            "/api/photosedit/setdeleted",
            {"select_all": True, "query": {}, "deleted": True},
            format="json",
        )

        self.assertTrue(Tag.objects.filter(pk=self.tag.pk).exists())
        self.assertEqual(self._count(), 0)

    def test_an_emptied_tag_is_still_listed_with_a_zero_count(self):
        # Unlike AlbumThing, the tag list has no photo_count > 0 filter: an
        # empty tag has to stay reachable so the user can rename or delete it.
        self.client.post(
            "/api/photosedit/setdeleted",
            {"select_all": True, "query": {}, "deleted": True},
            format="json",
        )

        listed = _results(self.client.get("/api/tags/"))

        self.assertEqual([tag["name"] for tag in listed], ["beach"])
        self.assertEqual(listed[0]["photo_count"], 0)
        self.assertEqual(listed[0]["cover_photos"], [])

    def test_a_hard_deleted_photo_drops_out_of_the_count(self):
        affected = tag_ids_for_photos(Photo.objects.filter(pk=self.photos[0].pk))
        self.photos[0].delete()
        refresh_tag_photo_counts(affected)

        self.assertEqual(self._count(), 1)

    def test_the_refresh_leaves_other_users_tags_alone(self):
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        other_tag = Tag.objects.create(name="beach", owner=other_user)
        other_tag.photos.add(other_photo)

        self.client.post(
            "/api/photosedit/setdeleted",
            {"select_all": True, "query": {}, "deleted": True},
            format="json",
        )

        other_tag.refresh_from_db()
        self.assertEqual(other_tag.photo_count, 1)

    def test_the_refresh_is_one_statement_however_many_tags_it_touches(self):
        for name in ("holiday", "sunset", "family"):
            tag = Tag.objects.create(name=name, owner=self.user)
            tag.photos.add(*self.photos)
        tag_ids = list(Tag.objects.filter(owner=self.user).values_list("pk", flat=True))

        with CaptureQueriesContext(connection) as queries:
            refresh_tag_photo_counts(tag_ids)

        self.assertEqual(len(queries.captured_queries), 1)
        for tag in Tag.objects.filter(pk__in=tag_ids):
            self.assertEqual(tag.photo_count, 2)

    def test_refreshing_nothing_touches_the_database(self):
        with CaptureQueriesContext(connection) as queries:
            refresh_tag_photo_counts([])

        self.assertEqual(len(queries.captured_queries), 0)
