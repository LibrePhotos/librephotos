"""Every list endpoint renders in a constant number of queries (#2331).

A list serializer that reads a relation the view did not load, or calls
``.count()`` on one, costs a query per row: invisible in a test with two rows,
seconds on a library page with a thousand. Each list route is filled with
``SMALL`` and then ``LARGE`` rows of what it lists and must answer both with
the same number of queries.

The routes come from the shared walker (``api/tests/infra/routes.py``): every
router route whose GET is a ``list`` action, plus the hand-written list
``APIView``s named in ``HAND_WRITTEN_LIST_ROUTES``. Each needs an entry in
``LIST_ROUTE_FIXTURES`` (how to add one row) or in ``NOT_MEASURED`` with the
reason; a new list route in neither fails the suite, the way
``test_cross_tenant_writes.py`` holds mutating routes to ``NOT_PHOTO_SCOPED``.
"""

import itertools
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal
from unittest.mock import patch

from django.db import connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import serializers
from rest_framework.test import APIClient

from api.models import File, LongRunningJob, Photo, User
from api.models.photo_share import PhotoShare
from api.models.photo_stack import PhotoStack
from api.serializers.job import LongRunningJobSerializer
from api.tests.infra.routes import ApiRoute, api_routes
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_collection,
    create_test_album_date,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_duplicate,
    create_test_face,
    create_test_file,
    create_test_job,
    create_test_person,
    create_test_person_group,
    create_test_photo,
    create_test_stack,
    create_test_tag,
    create_test_user,
    share_test_photos,
)
from api.views.custom_api_view import ListViewSet

SMALL = 2
LARGE = 8

Requester = Literal["user", "admin", "anonymous"]
RowAdder = Callable[[User, int], object]


def result_rows(payload: object) -> int:
    """The rows of a list response: a bare list or a page's ``results``."""
    if isinstance(payload, dict):
        payload = payload["results"]
    assert isinstance(payload, list), payload
    return len(payload)


def grouped_rows(payload: object) -> int:
    """The photos of a response grouped by date (``GroupedPhotosSerializer``)."""
    assert isinstance(payload, dict), payload
    return sum(len(group["items"]) for group in payload["results"])


@dataclass(frozen=True)
class ListFixture:
    """How to fill one list endpoint with rows, and who asks for it.

    ``add_row(requester, index)`` adds one row the requester's list shows.
    ``rows`` counts the rows of a response; the test checks that the second
    request shows exactly ``LARGE - SMALL`` more, so a fixture that adds
    nothing the list renders cannot pass by measuring an empty page.
    """

    add_row: RowAdder
    requester: Requester = "user"
    params: Mapping[str, str] = field(default_factory=dict)
    rows: Callable[[object], int] = result_rows


def _visible_photo(owner: User, **fields: object) -> Photo:
    return create_test_photo(owner=owner, exif_timestamp=timezone.now(), **fields)


def _tile_photo(owner: User, **fields: object) -> Photo:
    """A photo with everything a photo tile reads: a stack and a RAW file."""
    fields.setdefault("exif_timestamp", timezone.now())
    photo = create_test_photo(owner=owner, **fields)
    stack = create_test_stack(owner=owner, stack_type=PhotoStack.StackType.MANUAL)
    stack.photos.add(photo)
    photo.files.add(create_test_file(None, owner, file_type=File.RAW_FILE))
    return photo


def _public_user(requester: User, index: int) -> User:
    user = create_test_user(public_sharing=True)
    _visible_photo(user, public=True)
    _visible_photo(user, public=True)
    _visible_photo(user)
    return user


def _album_user(requester: User, index: int) -> None:
    album = create_test_album_user(owner=requester)
    album.photos.add(_visible_photo(requester))
    album.shared_to.add(create_test_user())
    create_test_album_collection(owner=requester, albums=[album])


def _album_collection(requester: User, index: int) -> None:
    create_test_album_collection(owner=requester)


def _album_shared_to_me(requester: User, index: int) -> None:
    owner = create_test_user()
    album = create_test_album_user(owner=owner)
    album.photos.add(_visible_photo(owner))
    album.shared_to.add(requester)


def _album_auto(requester: User, index: int) -> None:
    album = create_test_album_auto(owner=requester)
    album.photos.add(_visible_photo(requester))


def _album_date(requester: User, index: int) -> None:
    moment = timezone.now() - timezone.timedelta(days=index)
    album = create_test_album_date(
        owner=requester, date=moment.date(), location={"places": ["Lisbon"]}
    )
    album.photos.add(create_test_photo(owner=requester, exif_timestamp=moment))


def _album_thing(requester: User, index: int) -> None:
    album = create_test_album_thing(owner=requester, thing_type="hashtag_attribute")
    album.photos.add(_visible_photo(requester))


def _album_place(requester: User, index: int) -> None:
    album = create_test_album_place(owner=requester)
    album.photos.add(_visible_photo(requester))


def _person(requester: User, index: int) -> None:
    person = create_test_person(cluster_owner=requester)
    create_test_face(photo=_visible_photo(requester), person=person)
    # Each person in a group of their own: the group ids are prefetched (#1126).
    create_test_person_group(owner=requester, persons=[person])


def _person_group(requester: User, index: int) -> None:
    create_test_person_group(
        owner=requester, persons=[create_test_person(cluster_owner=requester)]
    )


def _tag(requester: User, index: int) -> None:
    create_test_tag(owner=requester).photos.add(_visible_photo(requester))


def _photo_shared_to_me(requester: User, index: int) -> None:
    share_test_photos([_tile_photo(create_test_user()).pk], requester)


def _photo_shared_from_me(requester: User, index: int) -> None:
    share_test_photos([_tile_photo(requester).pk], create_test_user())


def _face_without_person(requester: User, index: int) -> None:
    create_test_face(photo=_visible_photo(requester))


def _stack(requester: User, index: int) -> None:
    stack = create_test_stack(
        owner=requester, stack_type=PhotoStack.StackType.BURST_SEQUENCE
    )
    photos = [_visible_photo(requester) for _ in range(2)]
    stack.photos.add(*photos)
    stack.primary_photo = photos[0]
    stack.save()


def _duplicate(requester: User, index: int) -> None:
    duplicate = create_test_duplicate(owner=requester)
    duplicate.photos.add(*(_visible_photo(requester) for _ in range(2)))


def _photo_share(requester: User, index: int) -> None:
    photo = _visible_photo(requester)
    PhotoShare.objects.create(photo=photo, enabled=True, slug=f"share-{photo.pk.hex}")


# Every measured list route: the exact normalised route the walker reports,
# and one fixture per kind of requester whose response differs.
LIST_ROUTE_FIXTURES: dict[str, tuple[ListFixture, ...]] = {
    "api/user/": (
        ListFixture(_public_user, requester="admin"),
        ListFixture(_public_user, requester="user"),
        ListFixture(_public_user, requester="anonymous"),
    ),
    "api/albums/auto/list/": (ListFixture(_album_auto),),
    "api/albums/date/list/": (ListFixture(_album_date),),
    "api/albums/thing/list/": (ListFixture(_album_thing),),
    "api/albums/place/list/": (ListFixture(_album_place),),
    "api/albums/user/list/": (ListFixture(_album_user),),
    "api/albums/collections/": (ListFixture(_album_collection),),
    "api/albums/user/shared/tome/": (ListFixture(_album_shared_to_me),),
    "api/albums/user/shared/fromme/": (ListFixture(_album_user),),
    "api/persons/": (ListFixture(_person),),
    "api/person-groups/": (ListFixture(_person_group),),
    "api/tags/": (ListFixture(_tag),),
    "api/photos/shared/tome/": (ListFixture(_photo_shared_to_me),),
    "api/photos/shared/fromme/": (ListFixture(_photo_shared_from_me),),
    "api/photos/notimestamp/": (
        ListFixture(lambda user, index: _tile_photo(user, exif_timestamp=None)),
    ),
    "api/photos/nolocation/": (
        ListFixture(lambda user, index: _tile_photo(user, exif_gps_lat=None)),
    ),
    # A photo in no album of the requester's (#530).
    "api/photos/no-album/": (ListFixture(lambda user, index: _tile_photo(user)),),
    # The requester's own public photos (#2686).
    "api/photos/public/": (
        ListFixture(lambda user, index: _tile_photo(user, public=True)),
    ),
    "api/photos/edit/": (ListFixture(lambda user, index: _visible_photo(user)),),
    "api/photos/recentlyadded/": (ListFixture(lambda user, index: _tile_photo(user)),),
    "api/photos/searchlist/": (
        ListFixture(
            lambda user, index: _tile_photo(user, search_captions="beach"),
            params={"search": "beach"},
            rows=grouped_rows,
        ),
        # The structured search filters (#2259) join PhotoMetadata, one row
        # per photo, and add no query per result.
        ListFixture(
            lambda user, index: _tile_photo(user, camera="X-T5", iso=400, rating=4),
            params={"camera": "x-t5", "iso_min": "200", "rating_min": "3"},
            rows=grouped_rows,
        ),
    ),
    "api/faces/incomplete/": (ListFixture(_person),),
    "api/faces/": (ListFixture(_face_without_person),),
    "api/jobs/": (ListFixture(lambda user, index: create_test_job(started_by=user)),),
    # Hand-written list views (HAND_WRITTEN_LIST_ROUTES).
    "api/stacks/": (ListFixture(_stack),),
    "api/duplicates/": (ListFixture(_duplicate),),
    "api/photo/share/list/": (ListFixture(_photo_share),),
    # One distinct camera per row: the suggestions are one aggregate query.
    "api/search/metadata-values/": (
        ListFixture(
            lambda user, index: _visible_photo(user, camera=f"Camera {index}"),
            params={"field": "camera"},
        ),
    ),
}

# Plain APIViews whose GET renders a list of rows. The walker cannot tell them
# from any other GET view, so they are named here; each needs a fixture.
HAND_WRITTEN_LIST_ROUTES = frozenset(
    {
        "api/stacks/",
        "api/duplicates/",
        "api/photo/share/list/",
        "api/search/metadata-values/",
    }
)

# List routes that are not measured, each with the reason. An entry must name
# a router list route exactly; a stale one fails the test.
NOT_MEASURED = {
    "api/services/": "a constant list of sidecar names (SERVICES), no database rows",
    "api/photos/": (
        "PhotoViewSet.list renders the detail serializer and no client calls it "
        "(list() is marked unused); it asks the similarity sidecar once per "
        "photo, which no prefetch removes. Removing the verb is the verb "
        "trimming #2328 left open, not a query-count fix"
    ),
}


def is_list_route(route: ApiRoute) -> bool:
    """Whether a router route answers GET with a viewset's ``list`` action."""
    actions = getattr(route.callback, "actions", None) or {}
    return actions.get("get") == "list"


def unmeasured_routes(
    routes: Iterable[ApiRoute],
    fixtures: Mapping[str, object],
    not_measured: Mapping[str, str],
) -> list[str]:
    """List routes with neither a fixture nor a ``NOT_MEASURED`` entry."""
    return sorted(
        f"{route.route} {route.view.__module__}.{route.view.__qualname__}"
        for route in routes
        if is_list_route(route)
        and route.route not in fixtures
        and route.route not in not_measured
    )


def stale_entries(
    routes: Iterable[ApiRoute],
    fixtures: Mapping[str, object],
    not_measured: Mapping[str, str],
    hand_written: Iterable[str],
) -> list[str]:
    """Entries that name no list route (or no route at all, for hand-written ones)."""
    routes = list(routes)
    list_routes = {route.route for route in routes if is_list_route(route)}
    get_routes = {route.route for route in routes if "get" in route.methods}
    hand_written = set(hand_written)
    stale = [
        f"LIST_ROUTE_FIXTURES: {key}"
        for key in fixtures
        if key not in list_routes and key not in hand_written
    ]
    stale += [f"NOT_MEASURED: {key}" for key in not_measured if key not in list_routes]
    stale += [
        f"HAND_WRITTEN_LIST_ROUTES: {key}"
        for key in hand_written
        if key not in get_routes or key not in fixtures
    ]
    return sorted(stale)


class QueryCountMeasurement(TestCase):
    """Fills a list route with rows and compares its query counts."""

    def _requester(self, kind: Requester) -> tuple[User, APIClient]:
        user = create_test_user(is_admin=kind == "admin")
        client = APIClient()
        if kind != "anonymous":
            client.force_authenticate(user=user)
        return user, client

    def _request(
        self, client: APIClient, url: str, fixture: ListFixture
    ) -> tuple[int, int]:
        with CaptureQueriesContext(connection) as queries:
            response = client.get(url, dict(fixture.params))
            self.assertEqual(response.status_code, 200, f"{url}: {response.content!r}")
            rows = fixture.rows(response.json())
        return len(queries.captured_queries), rows

    def assert_constant_queries(self, route: str, fixture: ListFixture) -> None:
        url = "/" + route
        requester, client = self._requester(fixture.requester)
        index = itertools.count()
        for _ in range(SMALL):
            fixture.add_row(requester, next(index))
        # The first request of a test also stores django-constance defaults
        # and fills per-process caches, which have nothing to do with rows.
        self._request(client, url, fixture)
        small_queries, small_rows = self._request(client, url, fixture)
        for _ in range(LARGE - SMALL):
            fixture.add_row(requester, next(index))
        large_queries, large_rows = self._request(client, url, fixture)

        self.assertGreaterEqual(small_rows, SMALL, f"{url}: the fixture adds no rows")
        self.assertEqual(
            large_rows - small_rows,
            LARGE - SMALL,
            f"{url}: the fixture's rows do not all show up in the list",
        )
        self.assertEqual(
            large_queries,
            small_queries,
            f"{url} ({fixture.requester}) issues queries per row: "
            f"{small_queries} queries for {small_rows} rows, {large_queries} for "
            f"{large_rows}. Load what the serializer reads in the view's queryset "
            "(a with_*_relations() function next to the serializer) instead.",
        )


class ListQueryCountTest(QueryCountMeasurement):
    def test_every_list_route_is_measured(self):
        missing = unmeasured_routes(api_routes(), LIST_ROUTE_FIXTURES, NOT_MEASURED)
        self.assertEqual(
            missing,
            [],
            "List routes without a fixture in LIST_ROUTE_FIXTURES and without a "
            "NOT_MEASURED entry. Add a fixture that adds one row of what the list "
            "shows, or name the exact route in NOT_MEASURED with the reason.",
        )

    def test_no_stale_entries(self):
        self.assertEqual(
            stale_entries(
                api_routes(),
                LIST_ROUTE_FIXTURES,
                NOT_MEASURED,
                HAND_WRITTEN_LIST_ROUTES,
            ),
            [],
        )

    def test_list_query_counts_are_constant(self):
        for route, fixtures in LIST_ROUTE_FIXTURES.items():
            for fixture in fixtures:
                with self.subTest(route=route, requester=fixture.requester):
                    # Each route on its own rows: one savepoint per fixture.
                    with transaction.atomic():
                        self.assert_constant_queries(route, fixture)
                        transaction.set_rollback(True)


class PlantedListViewSet(ListViewSet):
    serializer_class = LongRunningJobSerializer
    queryset = LongRunningJob.objects.none()


class PlantedRoutesTest(QueryCountMeasurement):
    """The checks above must notice a route or a query they are meant to catch."""

    def test_a_list_route_in_neither_table_is_reported(self):
        planted = ApiRoute(
            "api/planted/",
            PlantedListViewSet,
            frozenset({"get"}),
            PlantedListViewSet.as_view({"get": "list"}),
        )
        self.assertEqual(
            unmeasured_routes([planted], LIST_ROUTE_FIXTURES, NOT_MEASURED),
            [f"api/planted/ {__name__}.PlantedListViewSet"],
        )
        self.assertEqual(
            unmeasured_routes([planted], {"api/planted/": ()}, NOT_MEASURED),
            [],
        )

    def test_a_detail_route_is_not_a_list_route(self):
        planted = ApiRoute(
            "api/planted/(?P<pk>[^/.]+)/",
            PlantedListViewSet,
            frozenset({"get"}),
            PlantedListViewSet.as_view({"get": "retrieve"}),
        )
        self.assertEqual(unmeasured_routes([planted], {}, {}), [])

    def test_stale_entries_are_reported(self):
        self.assertEqual(
            stale_entries([], {"api/gone/": ()}, {"api/old/": "reason"}, {"api/hand/"}),
            [
                "HAND_WRITTEN_LIST_ROUTES: api/hand/",
                "LIST_ROUTE_FIXTURES: api/gone/",
                "NOT_MEASURED: api/old/",
            ],
        )

    def test_a_per_row_query_in_a_covered_serializer_fails(self):
        def job_type_with_a_query(
            serializer: serializers.Serializer, job: LongRunningJob
        ) -> str:
            User.objects.filter(pk=job.started_by_id).exists()
            return dict(LongRunningJob.JOB_TYPES)[job.job_type]

        (fixture,) = LIST_ROUTE_FIXTURES["api/jobs/"]
        with (
            patch.object(
                LongRunningJobSerializer, "get_job_type_str", job_type_with_a_query
            ),
            self.assertRaisesRegex(AssertionError, "issues queries per row"),
        ):
            self.assert_constant_queries("api/jobs/", fixture)
