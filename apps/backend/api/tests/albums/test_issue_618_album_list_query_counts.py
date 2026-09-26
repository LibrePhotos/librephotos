"""Repro for issue #618 - "elapsed time before seeing 1st album cover maybe long".

The reporter measured the wall-clock delay before the first *cover* of an album
overview shows up:

    people           370 persons:  7s
    auto albums     1196 albums:   7s
    things albums    463 things:   9s
    things albums  11900 things:  19s

The delay scales with the number of albums on the page rather than with the
network, which is the signature of an N+1 query in the album *list* endpoints.
Those endpoints paginate at 1000 entries, so a library of this size really does
render in one request.

The thing, place, auto and date list endpoints already load their covers with a
fixed set of prefetches. Two did not:

``PersonViewSet`` (``/api/persons/``, the people page) selects ``cover_photo``
and ``cover_face``, but people generally have neither, and ``PersonSerializer``
then falls back to the person's first face in ``get_face_url``,
``get_face_photo_url`` *and* ``get_video``. Each of those runs an ``exists()``
plus a ``first()``, and two of them additionally walk to ``face.photo``: eight
queries per person, so 370 people cost roughly 2960 round trips.

``AlbumUserListViewSet`` (``/api/albums/user/list/``) joins nothing at all, while
``AlbumUserListSerializer`` renders ``owner``, ``shared_to``, the public ``share``
settings and a ``cover_photo`` that falls back to ``obj.photos.first()``: four
queries per album.

The correct behaviour is that an album list response costs a constant number of
queries in the number of albums, exactly like the album *detail* endpoints after
issue #619. These tests assert that and fail before the fix.
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class AlbumListQueryCountTestMixin:
    """An album list response must not issue per-album queries.

    Subclasses set ``URL`` and implement ``_make_album(index)``.
    """

    SMALL = 2
    LARGE = 10

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

    def _photo(self):
        return create_test_photo(owner=self.user, video=False, exif_timestamp=self.now)

    def _count_queries(self):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(self.URL)
            self.assertEqual(response.status_code, 200)
            # Force full rendering of the lazily-serialized payload.
            payload = response.json()
        return len(ctx.captured_queries), payload["results"]

    def test_album_list_query_count_is_constant(self):
        for index in range(self.SMALL):
            self._make_album(index)

        # Warm the endpoint once before measuring. The first request against a
        # fresh database also materialises the django-constance defaults, a
        # one-time INSERT that has nothing to do with the number of albums.
        self._count_queries()
        small_queries, small_results = self._count_queries()

        for index in range(self.SMALL, self.LARGE):
            self._make_album(index)
        large_queries, large_results = self._count_queries()

        # Sanity: the endpoint really did return every album, so the two query
        # counts below compare like with like.
        self.assertEqual(len(small_results), self.SMALL)
        self.assertEqual(len(large_results), self.LARGE)

        per_album = (large_queries - small_queries) / (self.LARGE - self.SMALL)
        self.assertEqual(
            large_queries,
            small_queries,
            f"{self.URL} issues per-album queries (N+1): "
            f"{small_queries} queries for {self.SMALL} albums vs "
            f"{large_queries} queries for {self.LARGE} albums "
            f"(~{per_album:.1f} extra queries per album). "
            "The query count must be constant in the number of albums, "
            "otherwise an overview of a few hundred albums costs thousands of "
            "round trips before the first cover can be rendered (issue #618).",
        )


class PersonListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    """The people page, the 370-person / 7s case in the report."""

    URL = "/api/persons/"

    def _make_album(self, index):
        # Deliberately no cover_photo/cover_face: that is the common case and
        # the one that used to fall back to a per-person face lookup.
        person = create_test_person(name=f"person-{index:03d}", cluster_owner=self.user)
        create_test_face(photo=self._photo(), person=person)


class AlbumUserListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    URL = "/api/albums/user/list/"

    def _make_album(self, index):
        album = AlbumUser.objects.create(title=f"album-{index:03d}", owner=self.user)
        album.photos.add(self._photo())


class AlbumAutoListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    URL = "/api/albums/auto/list/"

    def _make_album(self, index):
        album = AlbumAuto.objects.create(
            title=f"album-{index:03d}",
            owner=self.user,
            timestamp=self.now - timezone.timedelta(days=index),
            created_on=self.now,
        )
        album.photos.add(self._photo())


class AlbumThingListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    URL = "/api/albums/thing/list/"

    def _make_album(self, index):
        album = AlbumThing.objects.create(
            title=f"thing-{index:03d}",
            owner=self.user,
            thing_type="hashtag_attribute",
        )
        album.photos.add(self._photo())


class AlbumPlaceListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    URL = "/api/albums/place/list/"

    def _make_album(self, index):
        album = AlbumPlace.objects.create(title=f"place-{index:03d}", owner=self.user)
        album.photos.add(self._photo())


class AlbumDateListQueryCountTest(AlbumListQueryCountTestMixin, TestCase):
    URL = "/api/albums/date/list/"

    def _make_album(self, index):
        timestamp = self.now - timezone.timedelta(days=index)
        album = AlbumDate.objects.create(
            date=timestamp.date(), owner=self.user, location={"places": ["Lisbon"]}
        )
        album.photos.add(
            create_test_photo(owner=self.user, video=False, exif_timestamp=timestamp)
        )


class PersonListCoverFallbackTest(TestCase):
    """The people page must still name the right cover face after the fix."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _results(self):
        response = self.client.get("/api/persons/")
        self.assertEqual(response.status_code, 200)
        return {entry["name"]: entry for entry in response.json()["results"]}

    def test_person_without_cover_uses_first_face(self):
        person = create_test_person(name="no-cover", cluster_owner=self.user)
        photo = create_test_photo(owner=self.user, video=False)
        first = create_test_face(photo=photo, person=person, image="faces/first.jpg")
        create_test_face(
            photo=create_test_photo(owner=self.user, video=False),
            person=person,
            image="faces/second.jpg",
        )

        entry = self._results()["no-cover"]
        self.assertEqual(entry["face_url"], "/media/" + first.image.name)
        self.assertEqual(entry["face_photo_url"], photo.image_hash)
        self.assertFalse(entry["video"])

    def test_person_with_cover_uses_cover(self):
        cover_photo = create_test_photo(owner=self.user, video=True)
        person = create_test_person(name="has-cover", cluster_owner=self.user)
        cover_face = create_test_face(
            photo=cover_photo, person=person, image="faces/cover.jpg"
        )
        person.cover_photo = cover_photo
        person.cover_face = cover_face
        person.save()
        # A different, earlier face that must not win over the explicit cover.
        create_test_face(
            photo=create_test_photo(owner=self.user, video=False),
            person=person,
            image="faces/other.jpg",
        )

        entry = self._results()["has-cover"]
        self.assertEqual(entry["face_url"], "/media/" + cover_face.image.name)
        self.assertEqual(entry["face_photo_url"], cover_photo.image_hash)
        self.assertTrue(entry["video"])

    def test_person_without_any_face(self):
        create_test_person(name="faceless", cluster_owner=self.user)

        entry = self._results()["faceless"]
        self.assertEqual(entry["face_url"], "")
        self.assertEqual(entry["face_photo_url"], "")
        self.assertEqual(entry["video"], "False")


class AlbumUserListCoverFallbackTest(TestCase):
    """The user album list must still name the right cover after the fix."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _results(self):
        response = self.client.get("/api/albums/user/list/")
        self.assertEqual(response.status_code, 200)
        return {entry["title"]: entry for entry in response.json()["results"]}

    def test_album_without_cover_uses_first_photo(self):
        album = AlbumUser.objects.create(title="no-cover", owner=self.user)
        first = create_test_photo(owner=self.user, video=False)
        album.photos.add(first, create_test_photo(owner=self.user, video=False))

        entry = self._results()["no-cover"]
        self.assertEqual(
            entry["cover_photo"]["image_hash"],
            album.photos.order_by("pk").first().image_hash,
        )
        self.assertEqual(entry["photo_count"], 2)

    def test_album_with_cover_uses_cover(self):
        album = AlbumUser.objects.create(title="has-cover", owner=self.user)
        other = create_test_photo(owner=self.user, video=False)
        cover = create_test_photo(owner=self.user, video=False)
        album.photos.add(other, cover)
        album.cover_photo = cover
        album.save()

        entry = self._results()["has-cover"]
        self.assertEqual(entry["cover_photo"]["image_hash"], cover.image_hash)
