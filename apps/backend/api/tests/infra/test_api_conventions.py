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

Every DRF view under ``api/`` says who may call it (#2329): its class, or a
project base class it names, sets ``permission_classes`` or overrides
``get_permissions()``; the ``IsAuthenticated`` default is a safety net, not a
declaration. Role requirements are permission classes (``IsAdminUser``,
``api.permissions.IsSuperUser``), never an ``is_staff`` check in the body that
builds its own 401 or 403. The endpoints that take credentials without a
session are throttled (``api/throttling.py``).
"""

import ast
import datetime
import types
import uuid
from collections.abc import Iterable
from pathlib import Path

from django.conf import settings
from django.http import HttpResponseBase
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import re_path
from django.utils import timezone
from rest_framework import mixins, routers, viewsets
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import BasePermission, IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser, Tag
from api.models.long_running_job import LongRunningJob
from api.permissions import IsSuperUser
from api.serializers.job import LongRunningJobSerializer
from api.serializers.tag import TagSerializer
from api.tests.infra.routes import ApiRoute, api_routes, router_verbs
from api.tests.utils import create_test_person, create_test_photo, create_test_user
from api.views.albums import AlbumThingViewSet
from api.views.password_reset import PasswordResetConfirmView, PasswordResetView
from api.views.user import UserViewSet
from librephotos import urls as project_urls
from librephotos.urls import (
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    router,
)

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
            served = PlantedViewSet if viewset is AlbumThingViewSet else viewset
            planted.register(prefix, served, basename=basename)

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


def view_source_files() -> list[tuple[str, Path]]:
    """Every module under VIEW_SOURCES: (path relative to the backend, path)."""
    root = Path(settings.BASE_DIR).parent
    files = []
    for tree in VIEW_SOURCES:
        for path in sorted((root / tree).rglob("*.py")):
            relative = path.relative_to(root).as_posix()
            if "/tests/" in f"/{relative}" or "/migrations/" in relative:
                continue
            files.append((relative, path))
    return files


class NoModelViewSetTest(SimpleTestCase):
    def test_the_source_walk_reaches_the_view_modules(self):
        # settings.BASE_DIR is apps/backend/librephotos, not apps/backend: a
        # walk from there found no files and the check below passed on nothing.
        scanned = {relative for relative, _ in view_source_files()}
        self.assertIn("api/views/photos.py", scanned)
        self.assertIn("nextcloud/views.py", scanned)

    def test_no_view_subclasses_model_viewset_or_blocklists_methods(self):
        problems = []
        for relative, path in view_source_files():
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


# --- Permissions and throttles (#2329) ---------------------------------------

PROJECT_PACKAGES = ("api", "nextcloud", "librephotos")

# Routed DRF views from other packages. They keep their own access rules.
THIRD_PARTY_VIEWS: dict[str, str] = {
    "drf_spectacular.views.SpectacularAPIView": "the OpenAPI schema",
    "drf_spectacular.views.SpectacularRedocView": "schema UI",
    "drf_spectacular.views.SpectacularSwaggerView": "schema UI",
}

# Routed only with DEBUG (librephotos/urls.py), so absent under the test runner.
DEBUG_ONLY_VIEWS = {
    "api.views.server_info.ApiHelpView",
    "drf_spectacular.views.SpectacularAPIView",
    "drf_spectacular.views.SpectacularRedocView",
    "drf_spectacular.views.SpectacularSwaggerView",
}

# Views an anonymous caller gets past the permission check of, for at least one
# of their methods. Every other view under api/ answers 401 before its body runs.
ANONYMOUS_VIEWS: dict[str, str] = {
    "api.views.health.HealthzView": "health probe",
    "api.views.health.HealthzPostgresqlView": "health probe",
    "api.views.health.HealthzQueueView": "health probe",
    "api.views.health.HealthzReadyView": "health probe",
    "api.views.password_reset.PasswordResetView": "requests a reset mail",
    "api.views.password_reset.PasswordResetConfirmView": "sets the new password",
    "api.views.public_albums.PublicAlbumBySlug": "public album links",
    "api.views.public_albums.PublicPhotoDetailBySlug": "public album links",
    "api.views.public_photos.PublicPhotoBySlug": "public photo links",
    "api.views.public_photos.PublicPhotoMediaBySlug": "public photo links",
    "api.views.server_info.ApiHelpView": "API overview",
    "api.views.site_settings.SiteSettingsView": "GET: read before sign-in",
    "api.views.sso.SSOConfigView": "which SSO buttons the sign-in page shows",
    "api.views.user.IsFirstTimeSetupView": "read before sign-in",
    "api.views.user.UserViewSet": (
        "list/retrieve of public users; create for first-time setup and sign-up"
    ),
    "api.views.photos.PhotoViewSet": (
        "retrieve/summary/albums of a public or shared photo"
    ),
    "librephotos.urls.CustomTokenObtainPairView": "sign-in",
    "librephotos.urls.CustomTokenRefreshView": "the refresh token is the credential",
    "librephotos.urls.LogoutView": (
        "the refresh token is the credential; not throttled, like the "
        "upstream view it replaced, since a refresh token cannot be guessed"
    ),
    **THIRD_PARTY_VIEWS,
}

# Views whose static permission_classes require staff. Dropping IsAdminUser
# from one of them, or adding a new staff-only view, fails until it is here.
STAFF_ONLY_VIEWS = {
    "api.views.dataviz.ServerLogsView",
    "api.views.dataviz.ServerLogsViewerView",
    "api.views.dataviz.ServerStatsView",
    "api.views.email_config.EmailConfigView",
    "api.views.email_config.EmailTestView",
    "api.views.services.ServiceViewSet",
    "api.views.serving_diagnostics.MediaPermissionDiagnosticsView",
    "api.views.user.DeleteUserViewSet",
    "api.views.user.ManageUserViewSet",
    "api.views.user.RootPathTreeView",
}

# Unauthenticated endpoints that accept credentials or send mail. Each one sets
# throttle_classes or overrides get_throttles().
THROTTLED_AUTH_VIEWS: tuple[type[APIView], ...] = (
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    PasswordResetView,
    PasswordResetConfirmView,
    UserViewSet,  # create: sign-up and first-time setup
)

# What a view must not build itself: a role check is a permission class, and
# the exception handler writes the error body.
BANNED_RESPONSE_NAMES = frozenset({"HttpResponseForbidden", "HTTP_401_UNAUTHORIZED"})
BANNED_RESPONSE_EXEMPTIONS: dict[str, frozenset[str]] = {
    # The media endpoints' bodiless 403 carries X-Media-Error, which tells the
    # web client a refused file apart from an expired session (#2325).
    "api/views/media.py": frozenset({"HttpResponseForbidden"}),
}


def qualname(view: type) -> str:
    return f"{view.__module__}.{view.__qualname__}"


def permission_declarer(view: type) -> type | None:
    """The class whose permission_classes or get_permissions the view runs."""
    return next(
        (
            klass
            for klass in view.__mro__
            if "permission_classes" in vars(klass) or "get_permissions" in vars(klass)
        ),
        None,
    )


def _project_class(klass: type | None) -> bool:
    return klass is not None and klass.__module__.split(".")[0] in PROJECT_PACKAGES


def drf_views(routes: Iterable[ApiRoute]) -> dict[type, ApiRoute]:
    """Each DRF view class under api/ with the first route that serves it."""
    views: dict[type, ApiRoute] = {}
    for route in routes:
        if issubclass(route.view, APIView):
            views.setdefault(route.view, route)
    return views


def undeclared_permission_views(routes: Iterable[ApiRoute]) -> list[str]:
    """Views that run a permission policy no project class chose."""
    problems = []
    for view, route in drf_views(routes).items():
        if qualname(view) in THIRD_PARTY_VIEWS:
            continue
        declarer = permission_declarer(view)
        if not _project_class(declarer):
            inherited = qualname(declarer) if declarer else "nothing"
            problems.append(
                f"{route.route} {qualname(view)}: declares no permission_classes "
                f"or get_permissions (runs {inherited}'s)"
            )
    return problems


def static_permissions(view: type) -> list[object]:
    """permission_classes, or [] when a project get_permissions() decides."""
    declarer = permission_declarer(view)
    if declarer is None or "get_permissions" in vars(declarer):
        return []
    return list(getattr(view, "permission_classes", ()))


def object_only_permissions_on_plain_views(routes: Iterable[ApiRoute]) -> list[str]:
    """Object-level permission classes on views that never call get_object()."""
    problems = []
    for view, route in drf_views(routes).items():
        if issubclass(view, GenericAPIView):
            continue
        for permission in static_permissions(view):
            if not (
                isinstance(permission, type) and issubclass(permission, BasePermission)
            ):
                continue
            object_only = (
                permission.has_permission is BasePermission.has_permission
                and permission.has_object_permission
                is not BasePermission.has_object_permission
            )
            if object_only:
                problems.append(
                    f"{route.route} {qualname(view)}: {permission.__name__} only "
                    "checks objects and this view has no get_object(), so it "
                    "never runs"
                )
    return problems


def hand_built_auth_responses(
    source: str, filename: str, allowed: frozenset[str] = frozenset()
) -> list[str]:
    """Places in ``source`` that build a 401 or an HttpResponseForbidden."""
    problems = []
    for node in ast.walk(ast.parse(source, filename)):
        name = None
        if isinstance(node, ast.Name):
            name = node.id
        elif isinstance(node, ast.Attribute):
            name = node.attr
        elif isinstance(node, ast.alias):
            name = node.name.rsplit(".", 1)[-1]
        if name in BANNED_RESPONSE_NAMES and name not in allowed:
            problems.append(f"{filename}:{node.lineno} uses {name}")
        if (
            isinstance(node, ast.keyword)
            and node.arg == "status"
            and isinstance(node.value, ast.Constant)
            and node.value.value == 401
        ):
            problems.append(f"{filename}:{node.lineno} builds a 401 response")
    return sorted(problems, key=lambda p: int(p.split(":")[1].split()[0]))


def _planted_urlconf(view: type[APIView]) -> types.ModuleType:
    """The project URLconf with ``view`` routed at api/planted/."""
    planted = types.ModuleType("planted_urls")
    planted.__dict__["urlpatterns"] = [
        re_path(r"^api/planted/$", view.as_view()),
        *project_urls.urlpatterns,
    ]
    return planted


class PermissionDeclarationTest(SimpleTestCase):
    def test_every_api_view_declares_its_permissions(self):
        problems = undeclared_permission_views(api_routes())
        self.assertEqual(
            problems,
            [],
            "Say who may call each view: permission_classes = (IsAuthenticated,) "
            "or the stricter class, in the view or a project base class it "
            "names.\n  " + "\n  ".join(problems),
        )

    def test_a_planted_view_without_permissions_is_caught(self):
        class PlantedView(APIView):
            def get(self, request: Request) -> Response:
                return Response({})

        with override_settings(ROOT_URLCONF=_planted_urlconf(PlantedView)):
            problems = undeclared_permission_views(api_routes())

        self.assertEqual(len(problems), 1, problems)
        self.assertIn("api/planted/", problems[0])
        self.assertIn("runs rest_framework.views.APIView's", problems[0])

    def test_the_third_party_exemptions_are_still_routed(self):
        routed = {qualname(view) for view in drf_views(api_routes())}
        self.assertEqual(set(THIRD_PARTY_VIEWS) - routed - DEBUG_ONLY_VIEWS, set())

    def test_object_only_permissions_sit_on_views_that_fetch_objects(self):
        self.assertEqual(object_only_permissions_on_plain_views(api_routes()), [])

    def test_an_inert_object_permission_is_caught(self):
        class OwnerOnly(BasePermission):
            def has_object_permission(
                self, request: Request, view: APIView, obj: object
            ) -> bool:
                return False

        class PlantedView(APIView):
            permission_classes = (OwnerOnly,)

            def post(self, request: Request) -> Response:
                return Response({})

        with override_settings(ROOT_URLCONF=_planted_urlconf(PlantedView)):
            problems = object_only_permissions_on_plain_views(api_routes())

        self.assertEqual(len(problems), 1, problems)
        self.assertIn("OwnerOnly only checks objects", problems[0])

    def test_staff_only_views_are_pinned(self):
        staff_only = {
            qualname(view)
            for view in drf_views(api_routes())
            if IsAdminUser in static_permissions(view)
        }
        self.assertEqual(staff_only, STAFF_ONLY_VIEWS)


class HandBuiltAuthResponseTest(SimpleTestCase):
    def test_no_view_builds_its_own_401_or_forbidden_response(self):
        problems = []
        for relative, source_path in view_source_files():
            problems += hand_built_auth_responses(
                source_path.read_text(encoding="utf-8"),
                relative,
                BANNED_RESPONSE_EXEMPTIONS.get(relative, frozenset()),
            )
        self.assertEqual(
            problems,
            [],
            "Refuse with a permission class, or raise NotAuthenticated or "
            "PermissionDenied:\n  " + "\n  ".join(problems),
        )

    def test_the_source_check_catches_each_form(self):
        source = (
            "from django.http import HttpResponseForbidden\n"
            "from rest_framework import status\n"
            "def a(request):\n"
            "    return HttpResponseForbidden()\n"
            "def b(request):\n"
            "    return Response(status=status.HTTP_401_UNAUTHORIZED)\n"
            "def c(request):\n"
            "    return HttpResponse(status=401)\n"
        )

        problems = hand_built_auth_responses(source, "planted.py")

        self.assertEqual(
            problems,
            [
                "planted.py:1 uses HttpResponseForbidden",
                "planted.py:4 uses HttpResponseForbidden",
                "planted.py:6 uses HTTP_401_UNAUTHORIZED",
                "planted.py:8 builds a 401 response",
            ],
        )

    def test_the_media_exemption_covers_only_its_forbidden_response(self):
        source = "x = HttpResponseForbidden()\ny = Response(status=401)\n"

        problems = hand_built_auth_responses(
            source,
            "api/views/media.py",
            BANNED_RESPONSE_EXEMPTIONS["api/views/media.py"],
        )

        self.assertEqual(problems, ["api/views/media.py:2 builds a 401 response"])


class ThrottledAuthViewsTest(SimpleTestCase):
    def test_each_credential_endpoint_has_a_throttle(self):
        unthrottled = [
            qualname(view)
            for view in THROTTLED_AUTH_VIEWS
            if not view.throttle_classes
            and not any(
                "get_throttles" in vars(klass) and _project_class(klass)
                for klass in view.__mro__
            )
        ]
        self.assertEqual(unthrottled, [])

    def test_each_one_is_routed(self):
        routed = set(drf_views(api_routes()))
        self.assertEqual(
            [qualname(view) for view in THROTTLED_AUTH_VIEWS if view not in routed],
            [],
        )


class AccessByRoleTest(TestCase):
    """Every route refuses the roles its permission classes leave out.

    Calls each view function directly, the way the resolver would, so the
    permission check answers before any handler runs.
    """

    def call(
        self, route: ApiRoute, method: str, user: object | None = None
    ) -> HttpResponseBase:
        request = APIRequestFactory().generic(method.upper(), f"/{route.route}")
        if user is not None:
            force_authenticate(request, user=user)
        assert route.callback is not None
        response = route.callback(request, **{name: "0" for name in route.kwargs})
        assert isinstance(response, HttpResponseBase)
        return response

    def test_anonymous_callers_get_401_outside_the_open_views(self):
        for view, route in drf_views(api_routes()).items():
            if qualname(view) in ANONYMOUS_VIEWS:
                continue
            for method in sorted(route.methods):
                with self.subTest(f"{method.upper()} {route.route}"):
                    self.assertEqual(self.call(route, method).status_code, 401)

    def test_the_open_views_are_still_routed(self):
        routed = {qualname(view) for view in drf_views(api_routes())}
        self.assertEqual(set(ANONYMOUS_VIEWS) - routed - DEBUG_ONLY_VIEWS, set())

    def test_staff_only_views_refuse_a_signed_in_user(self):
        user = create_test_user()
        for view, route in drf_views(api_routes()).items():
            if qualname(view) not in STAFF_ONLY_VIEWS:
                continue
            for method in sorted(route.methods):
                with self.subTest(f"{method.upper()} {route.route}"):
                    self.assertEqual(self.call(route, method, user).status_code, 403)

    def test_superuser_only_views_refuse_staff(self):
        staff = create_test_user()
        staff.is_staff = True
        staff.save()
        superuser_only = [
            (view, route)
            for view, route in drf_views(api_routes()).items()
            if IsSuperUser in static_permissions(view)
        ]
        self.assertEqual(
            [qualname(view) for view, _ in superuser_only],
            ["api.views.user.DeleteUserViewSet"],
        )
        for _view, route in superuser_only:
            for method in sorted(route.methods):
                with self.subTest(f"{method.upper()} {route.route}"):
                    self.assertEqual(self.call(route, method, staff).status_code, 403)
