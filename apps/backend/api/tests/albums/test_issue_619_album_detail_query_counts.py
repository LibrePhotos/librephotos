"""Repro for issue #619 - "elapsed time before seeing 1st photo of an album maybe long".

The reporter measured the wall-clock delay before the first thumbnail of an album
shows up:

    person album      1500 photos:  4s
    manual album       800 photos:  4s
    auto album        1145 photos: 14s
    auto album        2875 photos: 19s
    things album      2127 photos: 23s

The delay scales with the number of photos in the album, not with the network,
which is the signature of an N+1 query in the album *detail* endpoints.

``AlbumThingViewSet``/``AlbumPlaceViewSet``.retrieve serialize the album through
``GroupedThingPhotosSerializer``/``GroupedPlacePhotosSerializer`` ->
``GroupedPhotosSerializer`` -> ``PhotoSummarySerializer``. ``PhotoSummarySerializer``
touches ``photo.thumbnail``, ``photo.search_instance``, ``photo.main_file``,
``photo.main_file.embedded_media``, ``photo.stacks`` and ``photo.files`` for *every*
photo, but the viewsets' ``get_queryset()`` prefetches none of those relations:
``AlbumThingViewSet`` prefetches only ``photos``/``photos__owner``, and
``AlbumPlaceViewSet`` prefetches ``photos`` with a ``.only(...)`` that additionally
*defers* fields the serializer reads (``video_length``, ``owner``, ``main_file``),
costing yet another query each. ``AlbumAutoViewSet`` is worse still - its serializer
walks ``photo.faces -> face.person`` and re-serializes a ``PersonSerializer`` per
face, and the viewset carries a literal
``# TODO: This is a fetches with too many queries. We need to optimize this.``

The correct behaviour is that the number of queries for an album detail response is
O(1) in the album size - a fixed set of prefetches - exactly like ``AlbumDateViewSet``
already does. These tests assert that and currently fail.
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumAuto, AlbumPlace, AlbumThing, AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class AlbumDetailQueryCountTestMixin:
    """An album detail response must not issue per-photo queries.

    Subclasses set ``KIND`` (the URL segment) and implement ``_make_album``.
    """

    SMALL = 2
    LARGE = 12

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

    def _photos(self, count):
        return [
            create_test_photo(owner=self.user, video=False, exif_timestamp=self.now)
            for _ in range(count)
        ]

    @staticmethod
    def _hashes(response):
        """Pull every returned image_hash out of the (differently shaped) payloads."""
        data = response.json()
        if isinstance(data, dict) and "results" in data:
            data = data["results"]
        groups = data.get("grouped_photos")
        if groups is not None:
            return {item["image_hash"] for group in groups for item in group["items"]}
        return {item["image_hash"] for item in data.get("photos", [])}

    def _url(self, album):
        return f"/api/albums/{self.KIND}/{album.id}/"

    def _count_queries(self, url):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            # Force full rendering of the lazily-serialized payload.
            response.json()
        return len(ctx.captured_queries), response

    def test_album_detail_query_count_is_constant(self):
        small_album = self._make_album(self._photos(self.SMALL))
        large_album = self._make_album(self._photos(self.LARGE))

        # Warm the endpoint once before measuring. The first request of a fresh
        # database also materialises the django-constance defaults, which is a
        # one-time INSERT unrelated to album size; counting it would make the
        # first measurement look worse than the second for reasons that have
        # nothing to do with the N+1 this test is about.
        self._count_queries(self._url(small_album))

        small_queries, small_response = self._count_queries(self._url(small_album))
        large_queries, large_response = self._count_queries(self._url(large_album))

        # Sanity: both endpoints actually returned the photos we asked for, so
        # the query counts below are comparing like with like.
        self.assertEqual(len(self._hashes(small_response)), self.SMALL)
        self.assertEqual(len(self._hashes(large_response)), self.LARGE)

        per_photo = (large_queries - small_queries) / (self.LARGE - self.SMALL)
        self.assertEqual(
            large_queries,
            small_queries,
            f"/api/albums/{self.KIND}/ detail issues per-photo queries (N+1): "
            f"{small_queries} queries for {self.SMALL} photos vs "
            f"{large_queries} queries for {self.LARGE} photos "
            f"(~{per_photo:.1f} extra queries per photo). "
            "The query count must be constant in the album size, otherwise a "
            "2000-photo album costs thousands of round trips before the first "
            "thumbnail can be rendered (issue #619).",
        )


class AlbumThingDetailQueryCountTest(AlbumDetailQueryCountTestMixin, TestCase):
    KIND = "thing"

    def _make_album(self, photos):
        album = AlbumThing.objects.create(
            title=f"beach-{len(photos)}",
            owner=self.user,
            thing_type="hashtag_attribute",
        )
        album.photos.add(*photos)
        return album


class AlbumPlaceDetailQueryCountTest(AlbumDetailQueryCountTestMixin, TestCase):
    KIND = "place"

    def _make_album(self, photos):
        album = AlbumPlace.objects.create(
            title=f"Lisbon-{len(photos)}", owner=self.user
        )
        album.photos.add(*photos)
        return album


class AlbumAutoDetailQueryCountTest(AlbumDetailQueryCountTestMixin, TestCase):
    KIND = "auto"

    def _make_album(self, photos):
        album = AlbumAuto.objects.create(
            title=f"Sunday Afternoon {len(photos)}",
            owner=self.user,
            timestamp=self.now - timezone.timedelta(days=len(photos)),
            created_on=self.now,
        )
        album.photos.add(*photos)
        return album


class AlbumAutoWithPeopleDetailQueryCountTest(AlbumDetailQueryCountTestMixin, TestCase):
    """Every photo shows the same person, who has no cover (the worst case).

    The people list used to serialize a PersonSerializer per face, each of
    which looked up the person's first face for its cover.
    """

    KIND = "auto"

    def _make_album(self, photos):
        album = AlbumAuto.objects.create(
            title=f"Birthday {len(photos)}",
            owner=self.user,
            timestamp=self.now - timezone.timedelta(days=len(photos)),
            created_on=self.now,
        )
        album.photos.add(*photos)
        person = create_test_person(cluster_owner=self.user)
        for photo in photos:
            create_test_face(photo=photo, person=person)
        return album

    def test_each_person_is_listed_once(self):
        album = self._make_album(self._photos(3))
        response = self.client.get(self._url(album))
        self.assertEqual(len(response.json()["people"]), 1)


class AlbumUserDetailQueryCountTest(AlbumDetailQueryCountTestMixin, TestCase):
    KIND = "user"

    def _make_album(self, photos):
        album = AlbumUser.objects.create(
            title=f"Holiday {len(photos)}", owner=self.user
        )
        album.photos.add(*photos)
        return album


class AlbumUserSharedDetailQueryCountTest(AlbumUserDetailQueryCountTest):
    """The same album, opened by someone it is shared with."""

    def setUp(self):
        super().setUp()
        self.recipient = create_test_user()

    def _make_album(self, photos):
        album = super()._make_album(photos)
        album.shared_to.add(self.recipient)
        return album

    def _count_queries(self, url):
        self.client.force_authenticate(user=self.recipient)
        return super()._count_queries(url)


class PublicAlbumDetailQueryCountTest(AlbumUserDetailQueryCountTest):
    """The public link of a user album (/api/public/albums/s/<slug>/)."""

    def _make_album(self, photos):
        album = super()._make_album(photos)
        AlbumUserShare.objects.create(
            album=album, enabled=True, slug=f"holiday-{len(photos)}"
        )
        return album

    def _url(self, album):
        return f"/api/public/albums/s/{album.share.slug}/"

    def _count_queries(self, url):
        self.client.force_authenticate(user=None)
        return super()._count_queries(url)


class AlbumUserHiddenAndTrashedPhotosTest(TestCase):
    """A user album lists what the library lists, for its owner and its guests."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.client = APIClient()
        self.visible = create_test_photo(owner=self.owner)
        self.hidden = create_test_photo(owner=self.owner, hidden=True)
        self.trashed = create_test_photo(owner=self.owner, in_trashcan=True)
        self.album = AlbumUser.objects.create(title="Mixed", owner=self.owner)
        self.album.photos.add(self.visible, self.hidden, self.trashed)
        self.album.shared_to.add(self.recipient)

    def _hashes(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get(f"/api/albums/user/{self.album.id}/")
        self.assertEqual(response.status_code, 200)
        groups = response.json()["grouped_photos"]
        return {item["image_hash"] for group in groups for item in group["items"]}

    def test_the_owner_sees_only_visible_photos(self):
        self.assertEqual(self._hashes(self.owner), {self.visible.image_hash})

    def test_a_share_recipient_sees_only_visible_photos(self):
        self.assertEqual(self._hashes(self.recipient), {self.visible.image_hash})

    def test_the_album_date_is_the_newest_photo(self):
        older = create_test_photo(
            owner=self.owner, exif_timestamp=timezone.now() - timezone.timedelta(30)
        )
        newer = create_test_photo(owner=self.owner, exif_timestamp=timezone.now())
        self.album.photos.add(older, newer)
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(f"/api/albums/user/{self.album.id}/")
        self.assertEqual(
            response.json()["date"],
            newer.exif_timestamp.isoformat().replace("+00:00", "Z"),
        )
