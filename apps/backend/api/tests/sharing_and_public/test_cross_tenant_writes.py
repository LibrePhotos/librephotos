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

A third test walks the URL router and fails on any mutating ``api/`` route
that is neither exercised here nor listed in ``NOT_PHOTO_SCOPED``. Adding
an endpoint therefore means adding a case, or saying out loud that the
endpoint cannot reference photos.
"""

import json
import uuid
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core import serializers as dj_serializers
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.test import TestCase
from django.urls import get_resolver, resolve
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser, Photo
from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.models.tag import Tag
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

# Mutating api/ routes that cannot reference a photo, an album, a tag, a
# stack, a duplicate group, a face or a person belonging to someone else.
# A route listed here is exempt from the cross-tenant cases; keep the reason
# next to each entry.
NOT_PHOTO_SCOPED = {
    "api/user/": "profile settings of the requester",
    "api/manage/user": "admin-only user management",
    "api/delete/user": "admin-only user deletion",
    "api/jobs": "the requester's own job rows",
    "api/services": "admin-only service control",
    "api/exists": "upload dedup check on the requester's own hash",
    "api/upload/": "chunked upload into the requester's library",
    "api/sitesettings": "admin-only site config",
    "api/email-config": "admin-only mail config",
    "api/savemetadata": "writes the requester's own photos' metadata to disk",
    "api/trainfaces": "queues a job on the requester's own faces",
    "api/clusterfaces": "queues a job on the requester's own faces",
    "api/scanphotos": "scans the requester's own library",
    "api/scanuploadedphotos": "scans the requester's own uploads",
    "api/fullscanphotos": "scans the requester's own library",
    "api/scanfaces": "queues a job on the requester's own photos",
    "api/deletemissingphotos": "queues a job on the requester's own photos",
    "api/classifymedia": "queues a job on the requester's own photos",
    "api/generateocr": "queues a job on the requester's own photos",
    "api/autoalbumgen": "queues a job on the requester's own photos",
    "api/autoalbumtitlegen": "queues a job on the requester's own albums",
    "api/stacks/detect": "queues a job on the requester's own photos",
    "api/duplicates/detect": "queues a job on the requester's own photos",
    "api/auth/": "authentication",
    "api/nextcloud/": "the requester's own Nextcloud credentials",
    "api/geocode/search": "stateless lookup",
    "api/delete/zip/": "zip files are named by the requester's own user id",
    "api/django-admin/": "Django admin, staff only",
    "api/accounts/": "allauth account pages",
}


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

        self.v_tag = Tag.objects.create(name="victim-tag", owner=self.victim)
        self.v_tag.photos.add(self.v_pub, self.v_priv)

        self.v_album = AlbumUser.objects.create(title="Victim Trip", owner=self.victim)
        self.v_album.photos.add(self.v_pub, self.v_priv)
        self.v_auto = AlbumAuto.objects.create(
            title="Victim Event", owner=self.victim, timestamp=now, created_on=now
        )
        self.v_auto.photos.add(self.v_pub, self.v_priv)
        self.v_thing = AlbumThing.objects.create(
            title="cat", thing_type="places365_attribute", owner=self.victim
        )
        self.v_thing.photos.add(self.v_pub, self.v_priv)
        self.v_place = AlbumPlace.objects.create(
            title="Berlin", geolocation_level=1, owner=self.victim
        )
        self.v_place.photos.add(self.v_pub, self.v_priv)
        self.v_date = AlbumDate.objects.create(date=now.date(), owner=self.victim)
        self.v_date.photos.add(self.v_pub, self.v_priv)

        self.v_stack = PhotoStack.objects.create(
            owner=self.victim, stack_type="manual", primary_photo=self.v_pub
        )
        self.v_stack.photos.add(self.v_pub, self.v_priv)
        self.v_dup = Duplicate.objects.create(owner=self.victim)
        self.v_dup.photos.add(self.v_pub, self.v_priv)

        self.a_photo = create_test_photo(owner=self.attacker)
        self.a_photo2 = create_test_photo(owner=self.attacker)
        self.a_tag = Tag.objects.create(name="attacker-tag", owner=self.attacker)
        self.a_album = AlbumUser.objects.create(title="Loot", owner=self.attacker)
        self.a_stack = PhotoStack.objects.create(
            owner=self.attacker, stack_type="manual", primary_photo=self.a_photo
        )
        self.a_stack.photos.add(self.a_photo, self.a_photo2)
        self.a_person = create_test_person(name="Mallory", cluster_owner=self.attacker)
        create_test_face(photo=self.a_photo, person=self.a_person)

        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.attacker)

        self.victim_markers = {str(p.pk) for p in self.victim_photos} | {
            p.image_hash for p in self.victim_photos
        }

        disk = patch("shutil.disk_usage")
        disk.start().return_value.free = 10**12
        self.addCleanup(disk.stop)
        self.download_job = patch("api.views.views.create_download_job").start()
        self.download_job.return_value = "job"
        self.addCleanup(patch.stopall)

    # ------------------------------------------------------------ cases
    def _hashes(self):
        return [self.v_pub.image_hash, self.v_priv.image_hash]

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

    def cases(self):
        public_query = {"public": True, "username": self.victim.username}
        edit = "/api/albums/user/edit/"
        cases = []
        cases += self._bulk("/api/photosedit/setdeleted", deleted=True)
        cases += self._bulk("/api/photosedit/setdeleted", deleted=False)
        cases += self._bulk("/api/photosedit/favorite", favorite=True)
        cases += self._bulk("/api/photosedit/hide", hidden=True)
        cases += self._bulk("/api/photosedit/makepublic", val_public=False)
        cases += self._bulk("/api/photosedit/makepublic", val_public=True)
        cases += self._bulk(
            "/api/photosedit/share", val_shared=True, target_user_id=self.target.id
        )
        cases += self._bulk("/api/photosedit/delete", method="delete")
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
            # other album kinds
            ("post", "/api/albums/user/", {"title": "Loot 4", "photos": self._ids()}),
            ("post", "/api/albums/auto/", {"title": "Loot 5", "photos": self._ids()}),
            ("post", "/api/albums/auto/delete_all/", {}),
            ("post", "/api/albums/thing/", {"title": "cat", "photos": self._ids()}),
            ("post", "/api/albums/place/", {"title": "Berlin", "photos": self._ids()}),
            ("post", "/api/albums/date/", {"photos": self._ids()}),
            ("post", "/api/photos/", {"image_hash": self.v_pub.image_hash}),
            (
                "post",
                "/api/photos/edit/",
                {"image_hash": self.v_pub.image_hash, "rating": 5},
            ),
            ("patch", f"/api/albums/auto/{self.v_auto.pk}/", {"favorited": True}),
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
            ("post", "/api/albums/person/", {"name": self.v_person.name}),
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
            ("patch", f"/api/albums/person/{self.v_person.pk}/", {"name": "pwned"}),
            ("put", f"/api/albums/person/{self.v_person.pk}/", {"name": "pwned"}),
            ("delete", f"/api/albums/person/{self.v_person.pk}/", None),
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
                covered.add(_normalise(resolve(url).route))

        missing = []
        for route, methods in _mutating_api_routes().items():
            if route in covered:
                continue
            if any(route.startswith(prefix) for prefix in NOT_PHOTO_SCOPED):
                continue
            missing.append(f"{route} [{', '.join(sorted(methods))}]")

        self.assertFalse(
            missing,
            "Mutating routes with no cross-tenant case. Add one to cases(), or "
            "list the route in NOT_PHOTO_SCOPED with the reason it cannot "
            "reference another user's data:\n  " + "\n  ".join(missing),
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
            "api.Tag",
            "api.AlbumUser",
            "api.PhotoStack",
            "api.Duplicate",
        ):
            self.assertIn(label, owned)


def _normalise(route):
    return (
        route.lstrip("^").lstrip("/").rstrip("$").replace("\\.", ".").replace("/?", "/")
    )


def _mutating_api_routes():
    """Every api/ route whose view answers POST, PUT, PATCH or DELETE."""
    routes = {}

    def walk(patterns, prefix):
        for pattern in patterns:
            route = prefix + str(pattern.pattern).lstrip("^")
            if hasattr(pattern, "url_patterns"):
                walk(pattern.url_patterns, route)
                continue
            callback = pattern.callback
            view = getattr(callback, "cls", None) or getattr(
                callback, "view_class", None
            )
            if view is None or "(?P<format>" in route:
                continue
            actions = getattr(callback, "actions", None)
            if actions:
                methods = set(actions)
            else:
                methods = {
                    m for m in ("post", "put", "patch", "delete") if hasattr(view, m)
                }
            methods &= {"post", "put", "patch", "delete"}
            normalised = _normalise(route)
            if methods and normalised.startswith("api/"):
                routes[normalised] = methods

    walk(get_resolver().url_patterns, "")
    return routes
