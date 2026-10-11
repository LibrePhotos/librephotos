"""Conventions every API endpoint follows, checked against the live URLconf.

Each test here walks the routes through ``api.tests.infra.routes``, so a new
endpoint is held to the rule without anyone remembering to add it.

Viewsets compose exactly the mixins of the actions they serve (#2328):
``viewsets.GenericViewSet`` plus ``ListModelMixin``/``RetrieveModelMixin``/
``CreateModelMixin``/``DestroyModelMixin``, ``UpdateModelMixin`` only when
PUT is wanted (``api.views.mixins.PartialUpdateModelMixin`` for PATCH
alone), or ``ReadOnlyModelViewSet``. Never ``ModelViewSet``, never an
``http_method_names`` blocklist. ``ROUTER_VERBS`` pins what every router
prefix serves; a new prefix, or a new verb on an old one, fails until it is
added there on purpose.
"""

import ast
import datetime
import uuid
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework import mixins, routers, viewsets
from rest_framework.test import APIClient

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser, Tag
from api.models.long_running_job import LongRunningJob
from api.serializers.job import LongRunningJobSerializer
from api.serializers.tag import TagSerializer
from api.tests.infra.routes import router_verbs
from api.tests.utils import create_test_person, create_test_photo, create_test_user
from api.views.albums import AlbumThingViewSet
from librephotos.urls import router

# Every router prefix and the "METHOD action" pairs it serves. Adding a
# viewset or a verb means adding it here, and a mutating one also needs a
# case in sharing_and_public/test_cross_tenant_writes.py.
ROUTER_VERBS: dict[str, set[str]] = {
    "api/user": {"GET list", "GET retrieve", "POST create", "PATCH partial_update"},
    "api/manage/user": {"PATCH partial_update"},
    "api/delete/user": {"DELETE destroy"},
    "api/albums/auto/list": {"GET list"},
    "api/albums/date/list": {"GET list"},
    "api/albums/thing/list": {"GET list"},
    "api/albums/place/list": {"GET list"},
    "api/albums/user/list": {"GET list"},
    "api/albums/user/edit": {"POST create", "PATCH partial_update"},
    "api/albums/user/shared/tome": {"GET list"},
    "api/albums/user/shared/fromme": {"GET list"},
    "api/albums/auto": {"GET retrieve", "DELETE destroy", "POST delete_all"},
    "api/folders": {"GET subfolders"},
    "api/albums/date": {"GET retrieve"},
    "api/albums/thing": {"GET retrieve"},
    "api/albums/place": {"GET retrieve"},
    "api/albums/user": {"GET retrieve", "PATCH partial_update", "DELETE destroy"},
    # Retrieve has no client yet: kept for the person page (#2207).
    "api/persons": {
        "GET list",
        "GET retrieve",
        "PATCH partial_update",
        "DELETE destroy",
    },
    "api/tags": {
        "GET list",
        "GET retrieve",
        "POST create",
        "PATCH partial_update",
        "DELETE destroy",
        "POST add_photos",
        "POST remove_photos",
        "POST merge",
    },
    "api/photos/shared/tome": {"GET list"},
    "api/photos/shared/fromme": {"GET list"},
    "api/photos/notimestamp": {"GET list"},
    # The two photo viewsets keep every verb ModelViewSet gave them; #2328
    # only made them explicit.
    "api/photos/edit": {
        "GET list",
        "GET retrieve",
        "POST create",
        "PUT update",
        "PATCH partial_update",
        "DELETE destroy",
    },
    "api/photos/recentlyadded": {"GET list"},
    "api/photos/searchlist": {"GET list"},
    "api/photos": {
        "GET list",
        "GET retrieve",
        "POST create",
        "PUT update",
        "PATCH partial_update",
        "DELETE destroy",
        "GET summary",
        "GET albums",
    },
    "api/faces/incomplete": {"GET list"},
    "api/faces": {"GET list"},
    "api/exists": {"GET retrieve"},
    "api/jobs": {"GET list", "GET retrieve", "DELETE destroy", "POST cancel"},
    "api/services": {"GET list", "GET retrieve", "POST start", "POST stop"},
}

# Where viewsets live: every class in these trees is checked by the ast test.
VIEW_SOURCES = ("api/views", "nextcloud")


def router_verb_drift(
    checked: routers.SimpleRouter, expected: dict[str, set[str]]
) -> list[str]:
    """How the verbs ``checked`` serves differ from ``expected``, one line each."""
    actual = router_verbs(checked)
    problems = []
    for prefix in sorted(actual.keys() | expected.keys()):
        served = actual.get(prefix, set())
        pinned = expected.get(prefix, set())
        if prefix not in expected:
            problems.append(f"{prefix}: new prefix, serves {sorted(served)}")
        elif prefix not in actual:
            problems.append(f"{prefix}: pinned but no longer registered")
        else:
            if served - pinned:
                problems.append(f"{prefix}: serves unpinned {sorted(served - pinned)}")
            if pinned - served:
                problems.append(f"{prefix}: no longer serves {sorted(pinned - served)}")
    return problems


def forbidden_viewset_patterns(source: str, filename: str) -> list[str]:
    """Classes in ``source`` that subclass ModelViewSet or set http_method_names."""
    problems = []
    for node in ast.walk(ast.parse(source, filename)):
        if not isinstance(node, ast.ClassDef):
            continue
        for base in node.bases:
            name = base.attr if isinstance(base, ast.Attribute) else None
            if isinstance(base, ast.Name):
                name = base.id
            if name == "ModelViewSet":
                problems.append(
                    f"{filename}:{node.lineno} {node.name} subclasses ModelViewSet"
                )
        for statement in node.body:
            targets: list[ast.expr] = []
            if isinstance(statement, ast.Assign):
                targets = statement.targets
            elif isinstance(statement, ast.AnnAssign):
                targets = [statement.target]
            if any(
                isinstance(t, ast.Name) and t.id == "http_method_names" for t in targets
            ):
                problems.append(
                    f"{filename}:{statement.lineno} {node.name} sets "
                    "http_method_names (compose the mixins it serves instead)"
                )
    return problems


def _copy_of_project_router() -> routers.DefaultRouter:
    copy = routers.DefaultRouter()
    for prefix, viewset, basename in router.registry:
        copy.register(prefix, viewset, basename=basename)
    return copy


class RouterVerbsTest(SimpleTestCase):
    def test_every_router_prefix_serves_exactly_its_pinned_verbs(self):
        problems = router_verb_drift(router, ROUTER_VERBS)
        self.assertEqual(
            problems,
            [],
            "The router serves other verbs than ROUTER_VERBS pins. Compose only "
            "the mixins a client needs, then update ROUTER_VERBS (and the "
            "cross-tenant cases for a mutating verb):\n  " + "\n  ".join(problems),
        )

    def test_a_planted_model_viewset_under_a_new_prefix_is_caught(self):
        class PlantedViewSet(viewsets.ModelViewSet):
            queryset = Tag.objects.none()
            serializer_class = TagSerializer

        planted = _copy_of_project_router()
        planted.register("api/planted", PlantedViewSet, basename="planted")

        problems = router_verb_drift(planted, ROUTER_VERBS)

        self.assertEqual(len(problems), 1, problems)
        self.assertIn("api/planted: new prefix", problems[0])
        self.assertIn("PUT update", problems[0])

    def test_a_planted_extra_verb_on_an_existing_viewset_is_caught(self):
        class PlantedViewSet(mixins.DestroyModelMixin, AlbumThingViewSet):
            pass

        planted = routers.DefaultRouter()
        for prefix, viewset, basename in router.registry:
            if viewset is AlbumThingViewSet:
                viewset = PlantedViewSet
            planted.register(prefix, viewset, basename=basename)

        problems = router_verb_drift(planted, ROUTER_VERBS)

        self.assertEqual(
            problems, ["api/albums/thing: serves unpinned ['DELETE destroy']"]
        )

    def test_a_viewset_dropping_a_pinned_verb_is_caught(self):
        expected = {**ROUTER_VERBS, "api/albums/date": {"GET retrieve", "GET list"}}

        self.assertEqual(
            router_verb_drift(router, expected),
            ["api/albums/date: no longer serves ['GET list']"],
        )


class NoModelViewSetTest(SimpleTestCase):
    def test_no_view_subclasses_model_viewset_or_blocklists_methods(self):
        root = Path(settings.BASE_DIR)
        problems = []
        for tree in VIEW_SOURCES:
            for path in sorted((root / tree).rglob("*.py")):
                relative = path.relative_to(root).as_posix()
                if "/tests/" in f"/{relative}" or "/migrations/" in relative:
                    continue
                source = path.read_text(encoding="utf-8")
                problems += forbidden_viewset_patterns(source, relative)
        self.assertEqual(problems, [], "\n".join(problems))

    def test_the_source_check_catches_both_patterns(self):
        source = (
            "from rest_framework import viewsets\n"
            "from rest_framework.viewsets import ModelViewSet\n"
            "class A(viewsets.ModelViewSet):\n"
            "    pass\n"
            "class B(ModelViewSet):\n"
            "    pass\n"
            "class C(viewsets.GenericViewSet):\n"
            "    http_method_names = ['get']\n"
        )

        problems = forbidden_viewset_patterns(source, "planted.py")

        self.assertEqual(len(problems), 3, problems)
        self.assertIn("planted.py:3 A subclasses ModelViewSet", problems[0])
        self.assertIn("planted.py:5 B subclasses ModelViewSet", problems[1])
        self.assertIn("planted.py:8 C sets http_method_names", problems[2])


class RemovedVerbsTest(TestCase):
    """Every verb #2328 removed is refused before it reaches the database.

    A detail or collection URL that still serves another verb answers 405.
    Where a viewset kept no collection verb at all, the router no longer
    generates the collection URL, so it answers 404.
    """

    def setUp(self):
        # Staff and superuser, so no permission class answers first: the
        # status is the router's.
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.admin)

        now = timezone.now()
        admin = self.admin
        # The auto album detail only opens an album holding a photo.
        auto = AlbumAuto.objects.create(
            title="Event", owner=admin, timestamp=now, created_on=now
        )
        auto.photos.add(create_test_photo(owner=admin))
        self.ids = {
            "auto": auto.pk,
            "thing": AlbumThing.objects.create(
                title="cat", thing_type="hashtag_attribute", owner=admin
            ).pk,
            "place": AlbumPlace.objects.create(
                title="Berlin", geolocation_level=1, owner=admin
            ).pk,
            "date": AlbumDate.objects.create(
                date=datetime.date(2021, 3, 4), owner=admin
            ).pk,
            "user_album": AlbumUser.objects.create(title="Trip", owner=admin).pk,
            "person": create_test_person(name="Ana", cluster_owner=admin).pk,
            "tag": Tag.objects.create(name="beach", owner=admin).pk,
            "job": LongRunningJob.objects.create(
                started_by=admin,
                job_id=str(uuid.uuid4()),
                job_type=LongRunningJob.JOB_SCAN_PHOTOS,
                queued_at=now,
            ).pk,
            "user": admin.pk,
        }

    def removed_verbs(self):
        ids = self.ids
        return [
            # (method, url, status)
            ("get", "/api/albums/auto/", 404),
            ("post", "/api/albums/auto/", 404),
            ("put", f"/api/albums/auto/{ids['auto']}/", 405),
            ("patch", f"/api/albums/auto/{ids['auto']}/", 405),
            ("get", "/api/albums/person/", 404),
            ("post", "/api/albums/person/", 404),
            ("get", f"/api/albums/person/{ids['person']}/", 404),
            ("patch", f"/api/albums/person/{ids['person']}/", 404),
            ("delete", f"/api/albums/person/{ids['person']}/", 404),
            ("post", "/api/persons/", 405),
            ("put", f"/api/persons/{ids['person']}/", 405),
            ("get", "/api/albums/thing/", 404),
            ("post", "/api/albums/thing/", 404),
            ("put", f"/api/albums/thing/{ids['thing']}/", 405),
            ("patch", f"/api/albums/thing/{ids['thing']}/", 405),
            ("delete", f"/api/albums/thing/{ids['thing']}/", 405),
            ("get", "/api/albums/place/", 404),
            ("post", "/api/albums/place/", 404),
            ("put", f"/api/albums/place/{ids['place']}/", 405),
            ("patch", f"/api/albums/place/{ids['place']}/", 405),
            ("delete", f"/api/albums/place/{ids['place']}/", 405),
            ("get", "/api/albums/user/", 404),
            ("post", "/api/albums/user/", 404),
            ("put", f"/api/albums/user/{ids['user_album']}/", 405),
            ("post", "/api/albums/date/", 404),
            ("post", "/api/albums/date/?public=1", 404),
            ("put", f"/api/albums/date/{ids['date']}/", 405),
            ("patch", f"/api/albums/date/{ids['date']}/", 405),
            ("delete", f"/api/albums/date/{ids['date']}/", 405),
            ("get", "/api/albums/user/edit/", 405),
            ("get", f"/api/albums/user/edit/{ids['user_album']}/", 405),
            ("put", f"/api/albums/user/edit/{ids['user_album']}/", 405),
            ("delete", f"/api/albums/user/edit/{ids['user_album']}/", 405),
            ("post", "/api/jobs/", 405),
            ("put", f"/api/jobs/{ids['job']}/", 405),
            ("patch", f"/api/jobs/{ids['job']}/", 405),
            ("put", f"/api/tags/{ids['tag']}/", 405),
            ("put", f"/api/user/{ids['user']}/", 405),
            ("delete", f"/api/user/{ids['user']}/", 405),
            ("get", "/api/manage/user/", 404),
            ("post", "/api/manage/user/", 404),
            ("get", f"/api/manage/user/{ids['user']}/", 405),
            ("put", f"/api/manage/user/{ids['user']}/", 405),
            ("delete", f"/api/manage/user/{ids['user']}/", 405),
        ]

    def _rows(self):
        return {
            model._meta.label: [
                repr(row) for row in model.objects.order_by("pk").values()
            ]
            for model in (
                AlbumAuto,
                AlbumThing,
                AlbumPlace,
                AlbumDate,
                AlbumUser,
                Tag,
                LongRunningJob,
            )
        }

    def test_every_removed_verb_is_refused(self):
        before = self._rows()
        for method, url, expected in self.removed_verbs():
            with self.subTest(f"{method.upper()} {url}"):
                response = getattr(self.client, method)(
                    url, {"title": "pwned", "name": "pwned"}, format="json"
                )
                self.assertEqual(response.status_code, expected)
        self.assertEqual(self._rows(), before)

    def test_the_kept_verbs_still_answer(self):
        ids = self.ids
        for method, url in (
            ("get", f"/api/albums/auto/{ids['auto']}/"),
            ("get", f"/api/albums/date/{ids['date']}/"),
            ("get", f"/api/albums/user/{ids['user_album']}/"),
            ("get", "/api/persons/"),
            ("get", f"/api/persons/{ids['person']}/"),
            ("get", f"/api/tags/{ids['tag']}/"),
            ("get", "/api/jobs/"),
            ("get", f"/api/jobs/{ids['job']}/"),
            ("get", "/api/user/"),
            ("get", f"/api/user/{ids['user']}/"),
        ):
            with self.subTest(f"{method.upper()} {url}"):
                response = getattr(self.client, method)(url)
                self.assertEqual(response.status_code, 200)

    def test_patch_still_edits_through_the_partial_update_mixin(self):
        ids = self.ids
        for url, body, model, field, value in (
            (
                f"/api/albums/user/{ids['user_album']}/",
                {"title": "Renamed"},
                AlbumUser,
                "title",
                "Renamed",
            ),
            (f"/api/tags/{ids['tag']}/", {"name": "sea"}, Tag, "name", "sea"),
        ):
            with self.subTest(url):
                response = self.client.patch(url, body, format="json")
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(
                    getattr(model.objects.get(pk=url.split("/")[-2]), field), value
                )


class JobSerializerReadOnlyTest(SimpleTestCase):
    def test_every_job_field_is_read_only(self):
        writable = [
            name
            for name, field in LongRunningJobSerializer().fields.items()
            if not field.read_only
        ]
        self.assertEqual(writable, [])
