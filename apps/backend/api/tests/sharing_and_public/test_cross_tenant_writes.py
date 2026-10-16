"""No mutating endpoint may touch, or reveal, another user's photos.

This is the generic form of the regression tests written for
CVE-2026-57943, #1985-#1988 and GHSA-phvg-g65q-rhq3. Rather than one test
per hole, every mutating photo-adjacent endpoint is driven as an attacker
with the victim's ids, hashes, and album / tag / stack / duplicate / face /
person ids, plus the ``select_all`` + public-query payload where the
endpoint accepts it. Two properties are asserted for each request:

* a snapshot of every row any model attributes to the victim through a
  user foreign key, plus every row related to the victim's photos (both
  walked from model metadata, so a new model is covered without editing
  this file), is unchanged;
* the response body does not carry a victim photo id or image hash.

A third test walks the URL router and fails on any route it does not hold to
a rule: a mutating class-based ``api/`` route, or any function view under
``api/``, that is neither exercised here nor named exactly in
``NOT_PHOTO_SCOPED``. Adding an endpoint therefore means adding a case, or
naming the route and saying out loud that it cannot reference photos.
"""

import json
import os
import uuid
from collections.abc import Iterable, Mapping
from collections.abc import Set as AbstractSet
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core import serializers as dj_serializers
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.http import HttpRequest, HttpResponse
from django.test import SimpleTestCase, TestCase
from django.urls import resolve
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

from api.models import Photo
from api.models.photo_share import PhotoShare
from api.tests.infra.routes import (
    MUTATING_METHODS,
    ApiRoute,
    FunctionRoute,
    Route,
    api_routes,
    drop_verified_format_twins,
    function_routes,
    normalise,
)
from api.tests.uploads.test_upload_into_album import UploadIntoAlbumTestBase
from api.tests.utils import (
    TEST_MEDIA_ROOT,
    create_test_album_auto,
    create_test_album_collection,
    create_test_album_date,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_duplicate,
    create_test_face,
    create_test_person,
    create_test_person_group,
    create_test_photo,
    create_test_stack,
    create_test_tag,
    create_test_user,
)

# URLconfs LibrePhotos does not write (Django admin, allauth). A route under
# one of these prefixes is out of scope, unless its view lives in the api
# package: those are ours and must be named below like any other route.
THIRD_PARTY_PREFIXES = ("api/django-admin/", "api/accounts/")

# Routes that cannot reference a photo, an album, a tag, a stack, a duplicate
# group, a face or a person belonging to someone else. Each key is the exact
# normalised route the walker reports, so an entry covers that route and no
# other: a route added below it needs its own case or its own entry. A key
# that matches no mutating or function route fails the test. Keep the reason
# next to each entry.
NOT_PHOTO_SCOPED = {
    "api/user/": "sign-up creates a new account; touches no existing rows",
    "api/user/(?P<pk>[^/.]+)/": "PATCH is IsAdminOrSelf: staff or the account itself",
    "api/manage/user/(?P<pk>[^/.]+)/": "admin-only user management",
    "api/delete/user/(?P<pk>[^/.]+)/": "admin and superuser only: user deletion",
    "api/jobs/(?P<pk>[^/.]+)/": "the requester's own job rows (get_queryset)",
    "api/jobs/(?P<pk>[^/.]+)/cancel/": "the requester's own job rows (get_queryset)",
    "api/services/(?P<pk>[^/.]+)/start/": "admin-only service control",
    "api/services/(?P<pk>[^/.]+)/stop/": "admin-only service control",
    "api/sitesettings/": "admin-only site config",
    "api/email-config/": "admin-only mail config",
    "api/email-config/test/": "admin-only mail config",
    "api/upload/": "chunked upload into the requester's library",
    "api/upload/complete/": "completes only the requester's own upload; its album_id is owner-scoped (UploadIntoAlbumCrossTenantTest)",
    "api/savemetadata/": "queues a job writing the requester's own photos' metadata to disk",
    "api/trainfaces/": "queues a job on the requester's own faces",
    "api/clusterfaces/": "queues a job on the requester's own faces",
    "api/scanphotos/": "scans the requester's own library",
    "api/scanuploadedphotos/": "scans the requester's own uploads",
    "api/fullscanphotos/": "scans the requester's own library",
    "api/deletemissingphotos/": "queues a job on the requester's own photos",
    "api/classifymedia/": "queues a job on the requester's own photos",
    "api/generateocr/": "queues a job on the requester's own photos",
    "api/generate-captions/": "queues a job on the requester's own photos",
    "api/photos/reapply-date-rules/": "queues a job on the requester's own photos",
    "api/strip-thumbnail-metadata/": "admin-only, instance-wide thumbnail cleanup job",
    "api/upgrade-tasks/<slug:key>/start/": "admin-only, instance-wide post-upgrade jobs",
    "api/upgrade-tasks/<slug:key>/dismiss/": "admin-only, instance-wide post-upgrade card state",
    "api/look-up-places/": "admin-only, instance-wide place name lookup job",
    "api/autoalbumgen/": "queues a job on the requester's own photos",
    "api/autoalbumtitlegen/": "queues a job on the requester's own albums",
    "api/stacks/detect/": "queues a job on the requester's own photos",
    "api/duplicates/detect/": "queues a job on the requester's own photos",
    "api/auth/token/obtain/": "authentication: the body's credentials are the caller's",
    "api/auth/token/refresh/": "authentication: refreshes the token in the body",
    "api/auth/token/blacklist/": "authentication: revokes the token in the body",
    "api/auth/password/reset/": "authentication: same answer for every address",
    "api/auth/password/reset/confirm/": "authentication: needs the emailed token",
    "api/auth/sso/finish/": "authentication: mints a JWT for the session's user",
    "api/accounts/oidc/(?P<provider_id>[^/]+)/login/": "authentication: OIDC start",
    "api/accounts/oidc/(?P<provider_id>[^/]+)/login/callback/": "authentication: OIDC",
    "api/nextcloud/scanphotos/": "the requester's own Nextcloud credentials",
    "api/delete/zip/(?P<fname>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/": "only the requester's own <uuid><user id>.zip (test_zip_and_photo_scope)",
    "api/static/(?P<path>.*)": "Django's serve() for STATIC_URL; GET only",
}


class UploadIntoAlbumCrossTenantTest(UploadIntoAlbumTestBase):
    """An upload names an album by id (#612): someone else's album is refused
    like a missing one, and its photos and title stay as they were."""

    def test_another_users_album_is_refused_and_untouched(self):
        victim = create_test_user()
        album = create_test_album_user(owner=victim, title="Victim Trip")
        album.photos.add(create_test_photo(owner=victim))
        before = snapshot_owned_rows(victim)
        upload_id = self.stage()

        response = self.complete(upload_id, album_id=str(album.id))

        self.assert_refused(response, "album_not_found", upload_id)
        self.assertNotIn("Victim Trip", response.content.decode())
        self.assertEqual(snapshot_owned_rows(victim), before)

    def test_a_shared_album_is_not_the_recipients_to_fill(self):
        owner = create_test_user()
        album = create_test_album_user(owner=owner, title="Shared Trip")
        album.shared_to.add(self.user)
        upload_id = self.stage()

        response = self.complete(upload_id, album_id=str(album.id))

        self.assert_refused(response, "album_not_found", upload_id)
        self.assertEqual(album.photos.count(), 0)


# Routed only with DEBUG (django.conf.urls.static adds it then), so absent
# under the test runner, which runs with DEBUG off.
DEBUG_ONLY_ROUTES = frozenset({"api/static/(?P<path>.*)"})


def _in_scope(route: Route) -> bool:
    """Whether the walk must account for ``route``.

    A class-based route is in scope when its view answers a mutating method.
    A function view always is: the URLconf does not say what it accepts.
    """
    return isinstance(route, FunctionRoute) or bool(route.methods & MUTATING_METHODS)


def _describe(route: Route) -> str:
    if isinstance(route, FunctionRoute):
        name = getattr(route.callback, "__qualname__", repr(route.callback))
        return f"{route.route} [function] {name}"
    methods = ", ".join(sorted(m.upper() for m in route.methods & MUTATING_METHODS))
    return f"{route.route} [{methods}] {route.view.__qualname__}"


def uncovered_routes(
    routes: Iterable[Route],
    covered: AbstractSet[str],
    exempt: Mapping[str, str],
    third_party: tuple[str, ...],
) -> list[str]:
    """In-scope routes that are neither exercised nor exempt by exact name.

    A route under a third-party prefix is skipped when its view is not from
    the api package. Prefixes are only a scope rule here, never an exemption.
    """
    return [
        _describe(route)
        for route in routes
        if _in_scope(route)
        and route.route not in covered
        and route.route not in exempt
        and not (
            route.route.startswith(third_party)
            and route.module.split(".", 1)[0] != "api"
        )
    ]


def stale_exemptions(
    routes: list[Route],
    exempt: Iterable[str],
    debug_only: AbstractSet[str] = frozenset(),
) -> list[str]:
    """Exempt keys that name no route the walk holds to the rules.

    A ``debug_only`` key may be absent: its route is only routed with DEBUG.
    """
    live = {route.route for route in routes if _in_scope(route)}
    return [key for key in exempt if key not in live and key not in debug_only]


def _walked_routes() -> list[Route]:
    return [*api_routes(), *function_routes()]


def _fields(obj):
    return dj_serializers.serialize("python", [obj])[0]["fields"]


def snapshot_owned_rows(user):
    """Every row of every model that points at ``user`` through a foreign key."""
    user_model = get_user_model()
    snap = {}
    for model in apps.get_models():
        if model is user_model:
            continue
        for field in model._meta.get_fields():
            if not (
                getattr(field, "concrete", False)
                and field.many_to_one
                and field.related_model is user_model
            ):
                continue
            rows = model._default_manager.filter(**{field.name: user}).order_by("pk")
            snap[(model._meta.label, field.name)] = [(r.pk, _fields(r)) for r in rows]
    return snap


def snapshot_photos(photos):
    """Everything the database knows about ``photos`` and the rows around them."""
    snap = {}
    for photo in photos:
        photo = Photo.objects.get(pk=photo.pk)
        snap[("photo", photo.pk)] = _fields(photo)
        for rel in Photo._meta.related_objects:
            accessor = rel.get_accessor_name()
            if accessor is None:
                continue
            try:
                related = getattr(photo, accessor)
            except ObjectDoesNotExist:
                snap[(accessor, photo.pk)] = None
                continue
            if hasattr(related, "all"):
                rows = list(related.all().order_by("pk"))
            else:
                rows = [related]
            snap[(accessor, photo.pk)] = [(row.pk, _fields(row)) for row in rows]
    return snap


class CrossTenantWriteTest(TestCase):
    def setUp(self):
        self.victim = create_test_user()
        self.attacker = create_test_user()
        self.target = create_test_user()

        now = timezone.now()
        self.v_pub = create_test_photo(
            owner=self.victim, public=True, camera="VictimCam", captions_json={}
        )
        self.v_priv = create_test_photo(owner=self.victim, public=False)
        self.v_trash = create_test_photo(owner=self.victim, in_trashcan=True)
        self.victim_photos = [self.v_pub, self.v_priv, self.v_trash]

        self.v_person = create_test_person(
            name="Victim Friend", cluster_owner=self.victim
        )
        self.v_face = create_test_face(photo=self.v_pub, person=self.v_person)
        self.v_face2 = create_test_face(photo=self.v_priv, person=self.v_person)
        self.v_face_deleted = create_test_face(
            photo=self.v_priv, person=self.v_person, deleted=True
        )

        self.v_tag = create_test_tag(name="victim-tag", owner=self.victim)
        self.v_tag.photos.add(self.v_pub, self.v_priv)

        self.v_album = create_test_album_user(title="Victim Trip", owner=self.victim)
        self.v_album.photos.add(self.v_pub, self.v_priv)
        self.v_collection = create_test_album_collection(
            name="Victim Collection", owner=self.victim, albums=[self.v_album]
        )
        self.v_auto = create_test_album_auto(
            title="Victim Event", owner=self.victim, timestamp=now, created_on=now
        )
        self.v_auto.photos.add(self.v_pub, self.v_priv)
        self.v_thing = create_test_album_thing(
            title="cat", thing_type="openclip_vitb32_tag", owner=self.victim
        )
        self.v_thing.photos.add(self.v_pub, self.v_priv)
        self.v_place = create_test_album_place(
            title="Berlin", geolocation_level=1, owner=self.victim
        )
        self.v_place.photos.add(self.v_pub, self.v_priv)
        self.v_date = create_test_album_date(date=now.date(), owner=self.victim)
        self.v_date.photos.add(self.v_pub, self.v_priv)

        self.v_stack = create_test_stack(
            owner=self.victim, stack_type="manual", primary_photo=self.v_pub
        )
        self.v_stack.photos.add(self.v_pub, self.v_priv)
        self.v_dup = create_test_duplicate(owner=self.victim)
        self.v_dup.photos.add(self.v_pub, self.v_priv)
        # A live link, so revoking or rotating someone else's share shows up.
        PhotoShare.objects.create(photo=self.v_pub, enabled=True)

        self.a_photo = create_test_photo(owner=self.attacker)
        self.a_photo2 = create_test_photo(owner=self.attacker)
        self.a_tag = create_test_tag(name="attacker-tag", owner=self.attacker)
        self._attacker_albums()
        self.a_stack = create_test_stack(
            owner=self.attacker, stack_type="manual", primary_photo=self.a_photo
        )
        self.a_stack.photos.add(self.a_photo, self.a_photo2)
        self.a_person = create_test_person(name="Mallory", cluster_owner=self.attacker)
        self.a_face = create_test_face(photo=self.a_photo, person=self.a_person)
        self._person_groups()

        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.attacker)

        self.victim_markers = {str(p.pk) for p in self.victim_photos} | {
            p.image_hash for p in self.victim_photos
        }

        self._stub_side_effects()

    def _stub_side_effects(self):
        """No disk check, no download job; the attacker gets a library (#352)."""
        disk = patch("shutil.disk_usage")
        disk.start().return_value.free = 10**12
        self.addCleanup(disk.stop)
        self.download_job = patch("api.views.zip_downloads.create_download_job").start()
        self.download_job.return_value = "job"
        # So a move gets past the target check and reaches the photo scope.
        patch("api.photos.moves.library_roots", return_value=[TEST_MEDIA_ROOT]).start()
        self.addCleanup(patch.stopall)

    # ------------------------------------------------------------ cases
    def _hashes(self):
        return [self.v_pub.image_hash, self.v_priv.image_hash]

    def _face_labels(self, face, person):
        return {
            "id": face.pk,
            "person": person.pk,
            "cluster_person": person.pk,
            "classification_person": person.pk,
        }

    def _ids(self):
        return [str(self.v_pub.pk), str(self.v_priv.pk)]

    def _bulk(self, url, method="post", **extra):
        """The explicit-hashes and select_all shapes of one bulk endpoint."""
        public_query = {"public": True, "username": self.victim.username}
        return [
            (method, url, {"image_hashes": self._hashes(), **extra}),
            (method, url, {"image_hashes": [self.v_trash.image_hash], **extra}),
            (method, url, {"select_all": True, "query": public_query, **extra}),
            (
                method,
                url,
                {
                    "select_all": True,
                    "query": {**public_query, "in_trashcan": True},
                    **extra,
                },
            ),
        ]

    def _attacker_albums(self):
        """An album, an event of their own photos (#429) and a collection."""
        self.a_album = create_test_album_user(title="Loot", owner=self.attacker)
        self.a_auto = create_test_album_auto(title="Loot Event", owner=self.attacker)
        self.a_auto.photos.add(self.a_photo, self.a_photo2)
        self.a_collection = create_test_album_collection(
            name="Loot Collection", owner=self.attacker
        )

    def _person_groups(self):
        """A group of each user's (#1126): the victim's holds their person."""
        self.v_group = create_test_person_group(
            name="Victim Family", owner=self.victim, persons=[self.v_person]
        )
        self.a_group = create_test_person_group(name="Loot Group", owner=self.attacker)

    def cases(self):
        public_query = {"public": True, "username": self.victim.username}
        edit = "/api/albums/user/edit/"
        cases = []
        cases += self._bulk("/api/photosedit/setdeleted", deleted=True)
        cases += self._bulk("/api/photosedit/setdeleted", deleted=False)
        cases += self._bulk("/api/photosedit/favorite", favorite=True)
        cases += self._bulk("/api/photosedit/rating", rating=5)
        cases += self._bulk("/api/photosedit/hide", hidden=True)
        cases += self._bulk("/api/photosedit/archive/", archived=True)
        cases += self._bulk("/api/photosedit/archive/", archived=False)
        cases += self._bulk("/api/photosedit/makepublic", val_public=False)
        cases += self._bulk("/api/photosedit/makepublic", val_public=True)
        cases += self._bulk("/api/photosedit/category", category="document")
        cases += self._bulk("/api/photosedit/datetime/", mode="shift", seconds=-3600)
        cases += self._bulk(
            "/api/photosedit/datetime/", mode="set", datetime="2025-10-11T10:18:00"
        )
        cases += self._bulk("/api/photos/date-summary/")
        cases += self._bulk("/api/photosedit/location/", lat=41.1, lon=-8.6)
        cases += self._bulk(
            "/api/photosedit/location/", lat=41.1, lon=-8.6, overwrite=True
        )
        cases += self._bulk("/api/photos/location-summary/")
        cases += self._bulk("/api/photos/move/preview/", target_folder=TEST_MEDIA_ROOT)
        cases += self._bulk(
            "/api/photos/move/", target_folder=TEST_MEDIA_ROOT, on_conflict="rename"
        )
        cases += self._bulk(
            "/api/photosedit/share", val_shared=True, target_user_id=self.target.id
        )
        cases += self._bulk("/api/photosedit/delete", method="delete")
        # Queues a job on the attacker's own trash (the job itself is held to
        # that in api/tests/jobs/test_empty_trash_job.py).
        cases += [("post", "/api/photosedit/empty-trash/", {})]
        cases += self._bulk("/api/photos/download")
        cases += [
            (
                "post",
                "/api/photosedit/generateim2txt",
                {"image_hash": self.v_pub.image_hash},
            ),
            (
                "post",
                "/api/photosedit/savecaption",
                {"image_hash": self.v_pub.image_hash, "caption": "pwned"},
            ),
            (
                "post",
                "/api/photosedit/rotate",
                {"image_hash": self.v_pub.image_hash, "angle": 90},
            ),
            (
                "post",
                f"/api/photos/{self.v_pub.image_hash}/main-file",
                {"file_hash": self.v_pub.main_file.hash},
            ),
            (
                "get",
                f"/api/photos/{self.v_pub.image_hash}/file/{self.v_pub.main_file.hash}",
                None,
            ),
            ("patch", f"/api/photos/{self.v_pub.pk}/", {"hidden": True}),
            ("put", f"/api/photos/{self.v_pub.pk}/", {"hidden": True}),
            ("delete", f"/api/photos/{self.v_pub.pk}/", None),
            ("patch", f"/api/photos/edit/{self.v_pub.image_hash}/", {"rating": 5}),
            ("patch", f"/api/photos/edit/{self.v_pub.pk}/", {"rating": 5}),
            ("put", f"/api/photos/edit/{self.v_pub.image_hash}/", {"rating": 5}),
            ("delete", f"/api/photos/edit/{self.v_pub.image_hash}/", None),
            ("patch", f"/api/photos/{self.v_pub.pk}/metadata", {"title": "pwned"}),
            (
                "patch",
                f"/api/photos/{self.v_pub.image_hash}/metadata",
                {"title": "pwned"},
            ),
            ("post", f"/api/photos/{self.v_pub.pk}/metadata/revert-all", {}),
            ("post", f"/api/photos/{self.v_pub.pk}/metadata/revert/{uuid.uuid4()}", {}),
            (
                "patch",
                "/api/photos/metadata/bulk",
                {"photo_ids": self._ids(), "updates": {"title": "pwned"}},
            ),
            (
                "patch",
                "/api/photos/metadata/bulk",
                {"photo_ids": self._hashes(), "updates": {"title": "pwned"}},
            ),
            # album collections
            ("post", "/api/albums/collections/", {"name": "Victim Collection"}),
            (
                "patch",
                f"/api/albums/collections/{self.v_collection.pk}/",
                {"name": "pwned"},
            ),
            ("delete", f"/api/albums/collections/{self.v_collection.pk}/", None),
            (
                "put",
                f"/api/albums/user/{self.v_album.pk}/collections/",
                {"collection_ids": [self.a_collection.pk]},
            ),
            (
                "put",
                f"/api/albums/user/{self.v_album.pk}/collections/",
                {"collection_ids": []},
            ),
            (
                "put",
                f"/api/albums/user/{self.a_album.pk}/collections/",
                {"collection_ids": [self.v_collection.pk]},
            ),
            # tags
            ("post", "/api/tags/", {"name": "new", "photos": self._ids()}),
            ("post", f"/api/tags/{self.a_tag.pk}/add/", {"photos": self._ids()}),
            ("post", f"/api/tags/{self.a_tag.pk}/add/", {"photos": self._hashes()}),
            (
                "post",
                f"/api/tags/{self.a_tag.pk}/add/",
                {"photos": [str(self.a_photo.pk), str(self.v_pub.pk)]},
            ),
            (
                "post",
                f"/api/tags/{self.a_tag.pk}/add/",
                {"select_all": True, "query": public_query},
            ),
            (
                "post",
                f"/api/tags/{self.v_tag.pk}/add/",
                {"photos": [str(self.a_photo.pk)]},
            ),
            ("post", f"/api/tags/{self.v_tag.pk}/remove/", {"photos": self._ids()}),
            (
                "post",
                f"/api/tags/{self.v_tag.pk}/remove/",
                {"select_all": True, "query": public_query},
            ),
            ("post", f"/api/tags/{self.a_tag.pk}/merge/", {"tag": self.v_tag.pk}),
            ("post", f"/api/tags/{self.v_tag.pk}/merge/", {"tag": self.a_tag.pk}),
            ("patch", f"/api/tags/{self.v_tag.pk}/", {"name": "pwned"}),
            ("put", f"/api/tags/{self.v_tag.pk}/", {"name": "pwned"}),
            ("delete", f"/api/tags/{self.v_tag.pk}/", None),
            # user albums
            ("post", edit, {"title": "Loot 2", "photos": self._ids()}),
            (
                "post",
                edit,
                {
                    "title": "Loot 3",
                    "photos": [],
                    "select_all": True,
                    "query": public_query,
                },
            ),
            ("patch", f"{edit}{self.a_album.pk}/", {"photos": self._ids()}),
            ("patch", f"{edit}{self.a_album.pk}/", {"cover_photo": str(self.v_pub.pk)}),
            (
                "patch",
                f"{edit}{self.a_album.pk}/",
                {"select_all": True, "query": public_query},
            ),
            ("patch", f"{edit}{self.v_album.pk}/", {"title": "pwned"}),
            ("patch", f"{edit}{self.v_album.pk}/", {"removedPhotos": self._hashes()}),
            ("put", f"{edit}{self.v_album.pk}/", {"title": "pwned", "photos": []}),
            ("delete", f"{edit}{self.v_album.pk}/", None),
            ("patch", f"/api/albums/user/{self.v_album.pk}/", {"title": "pwned"}),
            ("put", f"/api/albums/user/{self.v_album.pk}/", {"title": "pwned"}),
            ("delete", f"/api/albums/user/{self.v_album.pk}/", None),
            (
                "post",
                "/api/useralbum/share",
                {
                    "shared": True,
                    "target_user_id": self.target.id,
                    "album_id": self.v_album.pk,
                },
            ),
            (
                "post",
                "/api/useralbum/makepublic",
                {"album_id": self.v_album.pk, "val_public": True},
            ),
            # leaving an album that is not shared with the attacker
            ("post", "/api/useralbum/leave/", {"album_id": self.v_album.pk}),
            # per-photo share links, by id and by hash, for every action
            *(
                ("post", "/api/photo/share", {"photo_id": ref, "action": action})
                for ref in (*self._ids(), *self._hashes())
                for action in ("enable", "rotate", "disable")
            ),
            # other album kinds
            ("post", "/api/albums/auto/delete_all/", {}),
            ("post", "/api/photos/", {"image_hash": self.v_pub.image_hash}),
            (
                "post",
                "/api/photos/edit/",
                {"image_hash": self.v_pub.image_hash, "rating": 5},
            ),
            ("patch", f"/api/albums/auto/{self.v_auto.pk}/", {"favorited": True}),
            # the cover of an event (#429): a victim's photo on the attacker's
            # event, and any photo on the victim's
            (
                "patch",
                f"/api/albums/auto/{self.a_auto.pk}/",
                {"cover_photo": str(self.v_pub.pk)},
            ),
            (
                "patch",
                f"/api/albums/auto/{self.v_auto.pk}/",
                {"cover_photo": str(self.v_pub.pk)},
            ),
            (
                "patch",
                f"/api/albums/auto/{self.v_auto.pk}/",
                {"cover_photo": str(self.a_photo.pk)},
            ),
            ("patch", f"/api/albums/auto/{self.v_auto.pk}/", {"cover_photo": None}),
            ("put", f"/api/albums/auto/{self.v_auto.pk}/", {"favorited": True}),
            ("delete", f"/api/albums/auto/{self.v_auto.pk}/", None),
            ("patch", f"/api/albums/thing/{self.v_thing.pk}/", {"favorited": True}),
            ("put", f"/api/albums/thing/{self.v_thing.pk}/", {"favorited": True}),
            ("delete", f"/api/albums/thing/{self.v_thing.pk}/", None),
            ("patch", f"/api/albums/place/{self.v_place.pk}/", {"favorited": True}),
            ("put", f"/api/albums/place/{self.v_place.pk}/", {"favorited": True}),
            ("delete", f"/api/albums/place/{self.v_place.pk}/", None),
            ("patch", f"/api/albums/date/{self.v_date.pk}/", {"favorited": True}),
            ("put", f"/api/albums/date/{self.v_date.pk}/", {"favorited": True}),
            ("delete", f"/api/albums/date/{self.v_date.pk}/", None),
            # people and faces
            ("post", "/api/persons/", {"name": self.v_person.name}),
            (
                "patch",
                f"/api/persons/{self.a_person.pk}/",
                {"cover_photo": self.v_pub.image_hash},
            ),
            (
                "patch",
                f"/api/persons/{self.a_person.pk}/",
                {"cover_photo": str(self.v_pub.pk)},
            ),
            ("patch", f"/api/persons/{self.v_person.pk}/", {"newPersonName": "pwned"}),
            ("put", f"/api/persons/{self.v_person.pk}/", {"name": "pwned"}),
            ("delete", f"/api/persons/{self.v_person.pk}/", None),
            (
                "post",
                f"/api/persons/{self.v_person.pk}/remove-photos/",
                {"photo_ids": self._ids()},
            ),
            # Reading the victim's files again (#2214, #900) or detecting
            # their faces again (#524): by photo id, by path and by folder.
            ("post", "/api/photos/rescan/", {"photo_ids": self._ids()}),
            (
                "post",
                "/api/scan-files/",
                {"paths": [p.main_file.path for p in self.victim_photos]},
            ),
            ("post", "/api/scanfaces/", {"photo_ids": self._ids()}),
            (
                "post",
                "/api/scanfaces/",
                {"path": os.path.dirname(self.v_pub.main_file.path)},
            ),
            (
                "post",
                f"/api/persons/{self.a_person.pk}/remove-photos/",
                {"photo_ids": self._ids()},
            ),
            # Pulling the victim's person (and its faces) into the attacker's,
            # and pushing the attacker's into the victim's.
            (
                "post",
                f"/api/persons/{self.a_person.pk}/merge/",
                {"person": self.v_person.pk},
            ),
            (
                "post",
                f"/api/persons/{self.v_person.pk}/merge/",
                {"person": self.a_person.pk},
            ),
            # person groups (#1126)
            ("post", "/api/person-groups/", {"name": "Victim Family"}),
            (
                "patch",
                f"/api/person-groups/{self.v_group.pk}/",
                {"name": "pwned"},
            ),
            ("delete", f"/api/person-groups/{self.v_group.pk}/", None),
            (
                "put",
                f"/api/persons/{self.v_person.pk}/groups/",
                {"group_ids": [self.a_group.pk]},
            ),
            ("put", f"/api/persons/{self.v_person.pk}/groups/", {"group_ids": []}),
            (
                "put",
                f"/api/persons/{self.a_person.pk}/groups/",
                {"group_ids": [self.v_group.pk]},
            ),
            (
                "post",
                "/api/labelfaces",
                {
                    "person_name": "Mallory",
                    "face_ids": [self.v_face.pk, self.v_face2.pk],
                },
            ),
            (
                "post",
                "/api/deletefaces",
                {"face_ids": [self.v_face.pk, self.v_face2.pk]},
            ),
            ("post", "/api/restore-faces/", {"face_ids": [self.v_face_deleted.pk]}),
            # Relabelling the victim's faces, and putting the attacker's face
            # on the victim's person (which would change its count and cover).
            (
                "post",
                "/api/restore-face-labels/",
                {
                    "faces": [
                        self._face_labels(self.v_face, self.a_person),
                        self._face_labels(self.v_face_deleted, self.a_person),
                        self._face_labels(self.a_face, self.v_person),
                    ]
                },
            ),
            (
                "post",
                "/api/addface",
                {
                    "person_name": "Mallory",
                    "photo": str(self.v_pub.pk),
                    "box": {"top": 0.1, "right": 0.5, "bottom": 0.5, "left": 0.1},
                },
            ),
            (
                "post",
                "/api/addface",
                {
                    "person_name": "Mallory",
                    "photo": self.v_priv.image_hash,
                    "box": {"top": 0.1, "right": 0.5, "bottom": 0.5, "left": 0.1},
                },
            ),
            # stacks
            ("post", "/api/stacks/manual/", {"photo_hashes": self._hashes()}),
            (
                "post",
                "/api/stacks/manual/",
                {"photo_hashes": [self.a_photo.image_hash, self.v_pub.image_hash]},
            ),
            (
                "post",
                f"/api/stacks/{self.a_stack.pk}/add/",
                {"photo_hashes": self._hashes()},
            ),
            (
                "post",
                f"/api/stacks/{self.v_stack.pk}/add/",
                {"photo_hashes": [self.a_photo.image_hash]},
            ),
            (
                "post",
                f"/api/stacks/{self.v_stack.pk}/remove/",
                {"photo_hashes": [self.v_pub.image_hash]},
            ),
            (
                "post",
                f"/api/stacks/{self.v_stack.pk}/primary/",
                {"photo_hash": self.v_priv.image_hash},
            ),
            ("delete", f"/api/stacks/{self.v_stack.pk}/delete/", None),
            ("delete", f"/api/stacks/{self.v_stack.pk}/", None),
            ("post", "/api/stacks/merge/", {"photo_hashes": self._hashes()}),
            (
                "post",
                "/api/stacks/merge/",
                {"photo_hashes": [self.a_photo.image_hash, self.v_pub.image_hash]},
            ),
            # duplicates
            (
                "post",
                f"/api/duplicates/{self.v_dup.pk}/resolve",
                {"keep_photo_hash": self.v_pub.image_hash, "trash_others": True},
            ),
            ("post", f"/api/duplicates/{self.v_dup.pk}/dismiss", {}),
            ("post", f"/api/duplicates/{self.v_dup.pk}/revert", {}),
            ("delete", f"/api/duplicates/{self.v_dup.pk}/delete", None),
        ]
        return cases

    # ------------------------------------------------------------ tests
    def _request(self, method, url, data):
        kwargs = {"format": "json"}
        if data is not None:
            kwargs["data"] = data
        return getattr(self.client, method)(url, **kwargs)

    def _snapshot(self):
        return {
            **snapshot_owned_rows(self.victim),
            **snapshot_photos(self.victim_photos),
        }

    def test_no_endpoint_touches_or_reveals_the_victims_photos(self):
        before = self._snapshot()
        for method, url, data in self.cases():
            with self.subTest(f"{method.upper()} {url} {data}"):
                # Each case runs in its own savepoint so a hole in one endpoint
                # cannot change what the next case starts from.
                with transaction.atomic():
                    self.download_job.reset_mock()
                    # The request gets a savepoint of its own: an endpoint that
                    # 500s mid-insert leaves the connection needing a rollback,
                    # and the snapshot below must still be readable.
                    with transaction.atomic():
                        response = self._request(method, url, data)
                    after = self._snapshot()
                    transaction.set_rollback(True)

                changed = {
                    key: (before.get(key), after.get(key))
                    for key in before.keys() | after.keys()
                    if before.get(key) != after.get(key)
                }
                self.assertEqual(
                    changed, {}, f"{response.status_code}: victim rows changed"
                )

                # Echoing back an id the attacker supplied is not a leak; a
                # victim marker the request never mentioned is.
                sent = url + json.dumps(data or {})
                body = response.content.decode("utf-8", "replace")
                leaked = sorted(
                    m for m in self.victim_markers if m in body and m not in sent
                )
                self.assertEqual(leaked, [], f"{response.status_code}: {body[:300]}")
                if self.download_job.called:
                    queued = self.download_job.call_args.kwargs["photos"]
                    self.assertEqual(
                        [p for p in queued if p.owner_id == self.victim.id], []
                    )

    def test_every_mutating_api_route_is_covered_or_exempted(self):
        covered = set()
        for method, url, data in self.cases():
            if method != "get":
                covered.add(normalise(resolve(url).route))

        missing = uncovered_routes(
            _walked_routes(), covered, NOT_PHOTO_SCOPED, THIRD_PARTY_PREFIXES
        )

        self.assertFalse(
            missing,
            "Routes with no cross-tenant case and no exact NOT_PHOTO_SCOPED "
            "entry. Add a case to cases(), or name the exact route in "
            "NOT_PHOTO_SCOPED with the reason it cannot reference another "
            "user's data (a prefix does not count):\n  " + "\n  ".join(missing),
        )

    def test_every_exemption_names_a_live_route(self):
        stale = stale_exemptions(_walked_routes(), NOT_PHOTO_SCOPED, DEBUG_ONLY_ROUTES)
        self.assertEqual(
            stale,
            [],
            "NOT_PHOTO_SCOPED entries that match no mutating or function route:\n  "
            + "\n  ".join(stale),
        )

    def test_the_fixture_actually_gives_the_victim_every_kind_of_row(self):
        # Guard against the snapshot silently shrinking to bare Photo rows.
        snap = snapshot_photos([self.v_pub])
        populated = {key[0] for key, rows in snap.items() if rows}
        for accessor in (
            "faces",
            "tags",
            "albumuser_set",
            "albumauto_set",
            "albumthing_set",
            "albumplace_set",
            "albumdate_set",
            "primary_in_stack",
            "thumbnail",
            "metadata",
            "caption_instance",
            "share",
        ):
            self.assertIn(accessor, populated)
        photo_fields = snap[("photo", self.v_pub.pk)]
        self.assertTrue(photo_fields["stacks"])
        self.assertTrue(photo_fields["duplicates"])
        owned = {
            key[0] for key, rows in snapshot_owned_rows(self.victim).items() if rows
        }
        for label in (
            "api.Person",
            "api.PersonGroup",
            "api.Tag",
            "api.AlbumUser",
            "api.AlbumCollection",
            "api.PhotoStack",
            "api.Duplicate",
        ):
            self.assertIn(label, owned)


class PlantedView(APIView):
    def post(self, request: Request) -> Response:
        return Response({})


def planted_function_view(request: HttpRequest) -> HttpResponse:
    return HttpResponse()


class RouteWalkRulesTest(SimpleTestCase):
    """The walk's rules, checked on planted routes rather than the real URLconf."""

    def uncovered(self, routes: list[Route]) -> list[str]:
        return uncovered_routes(routes, set(), NOT_PHOTO_SCOPED, THIRD_PARTY_PREFIXES)

    def test_a_route_below_an_exempt_route_is_not_exempt(self):
        below = ApiRoute("api/user/planted/", PlantedView, frozenset({"post"}))
        self.assertEqual(
            self.uncovered([below]), ["api/user/planted/ [POST] PlantedView"]
        )

    def test_the_exact_exempt_route_stays_exempt(self):
        exact = ApiRoute("api/user/", PlantedView, frozenset({"post"}))
        self.assertEqual(self.uncovered([exact]), [])

    def test_a_planted_function_view_under_api_is_reported(self):
        planted = FunctionRoute("api/planted/", planted_function_view)
        self.assertEqual(
            self.uncovered([planted]),
            ["api/planted/ [function] planted_function_view"],
        )

    def test_a_project_view_under_a_third_party_prefix_is_reported(self):
        ours = ApiRoute("api/accounts/planted/", PlantedView, frozenset({"post"}))
        vendored = ApiRoute("api/accounts/planted/", APIView, frozenset({"post"}))
        self.assertEqual(
            self.uncovered([ours, vendored]),
            ["api/accounts/planted/ [POST] PlantedView"],
        )

    def test_a_read_only_route_is_not_in_scope(self):
        read = ApiRoute("api/planted/", PlantedView, frozenset({"get"}))
        self.assertEqual(self.uncovered([read]), [])

    def test_a_format_route_without_a_plain_twin_is_reported(self):
        copy = ApiRoute(
            "api/planted.(?P<format>[a-z0-9]+)/", PlantedView, frozenset({"post"})
        )
        self.assertEqual(
            self.uncovered(drop_verified_format_twins([copy])),
            ["api/planted.(?P<format>[a-z0-9]+)/ [POST] PlantedView"],
        )

    def test_a_format_route_with_a_plain_twin_is_skipped(self):
        plain = ApiRoute("api/planted/", PlantedView, frozenset({"post"}))
        copy = ApiRoute(
            "api/planted.(?P<format>[a-z0-9]+)/", PlantedView, frozenset({"post"})
        )
        self.assertEqual(drop_verified_format_twins([plain, copy]), [plain])

    def test_a_format_route_whose_twin_serves_another_view_is_kept(self):
        plain = ApiRoute("api/planted/", PlantedView, frozenset({"post"}))
        copy = ApiRoute(
            "api/planted.(?P<format>[a-z0-9]+)/", APIView, frozenset({"post"})
        )
        self.assertEqual(drop_verified_format_twins([plain, copy]), [plain, copy])

    def test_a_stale_exemption_fails(self):
        self.assertEqual(stale_exemptions([], {"api/gone/": "reason"}), ["api/gone/"])

    def test_an_exemption_for_a_read_only_route_is_stale(self):
        read = ApiRoute("api/geocode/search", PlantedView, frozenset({"get"}))
        self.assertEqual(
            stale_exemptions([read], {"api/geocode/search": "stateless"}),
            ["api/geocode/search"],
        )

    def test_an_exemption_for_a_live_route_is_not_stale(self):
        live = ApiRoute("api/planted/", PlantedView, frozenset({"post"}))
        self.assertEqual(stale_exemptions([live], {"api/planted/": "reason"}), [])
