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
``api.accounts.permissions.IsSuperUser``), never an ``is_staff`` check in the body that
builds its own 401 or 403. The endpoints that take credentials without a
session are throttled (``api/accounts/throttling.py``), and so are failed
Basic credentials on every view (``ThrottledBasicAuthentication``).

Every list pages one way (#2327): ``api.drf.pagination.DefaultPagination`` or a
preset of it, through ``paginate_queryset()``, or ``pagination_class = None``
with the view and the reason in ``UNPAGINATED_LIST_VIEWS``. No view module
imports Django's ``Paginator``.
"""

import ast
import datetime
import inspect
import textwrap
import types
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path

from django.conf import settings
from django.http import HttpResponseBase
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import re_path
from django.utils import timezone
from rest_framework import mixins, routers, viewsets
from rest_framework.authentication import BasicAuthentication
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission, IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from api.accounts.permissions import IsSuperUser
from api.drf.pagination import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    DayAlbumPagination,
    DefaultPagination,
)
from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser, Tag
from api.models.long_running_job import LongRunningJob
from api.serializers.job import LongRunningJobSerializer
from api.serializers.tag import TagSerializer
from api.tests.infra.routes import ApiRoute, api_routes, router_verbs
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_date,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)
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
    # PATCH sets the cover (#429).
    "api/albums/auto": {
        "GET retrieve",
        "PATCH partial_update",
        "DELETE destroy",
        "POST delete_all",
    },
    "api/folders": {"GET subfolders"},
    "api/albums/date": {"GET retrieve"},
    "api/albums/thing": {"GET retrieve"},
    "api/albums/place": {"GET retrieve"},
    # PUT collections sets which of the owner's collections hold it (#1009).
    "api/albums/user": {
        "GET retrieve",
        "PATCH partial_update",
        "DELETE destroy",
        "PUT collections",
    },
    "api/albums/collections": {
        "GET list",
        "POST create",
        "PATCH partial_update",
        "DELETE destroy",
    },
    # Retrieve loads the person page (#2207); merge joins two people (#2206).
    "api/persons": {
        "GET list",
        "GET retrieve",
        "PATCH partial_update",
        "DELETE destroy",
        "POST remove_photos",
        "POST merge",
        # PUT groups sets which of the owner's groups the person is in (#1126).
        "PUT groups",
    },
    "api/person-groups": {
        "GET list",
        "POST create",
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
    "api/photos/nolocation": {"GET list"},
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
        auto = create_test_album_auto(
            title="Event", owner=admin, timestamp=now, created_on=now
        )
        auto.photos.add(create_test_photo(owner=admin))
        self.ids = {
            "auto": auto.pk,
            "thing": create_test_album_thing(
                title="cat", thing_type="hashtag_attribute", owner=admin
            ).pk,
            "place": create_test_album_place(
                title="Berlin", geolocation_level=1, owner=admin
            ).pk,
            "date": create_test_album_date(
                date=datetime.date(2021, 3, 4), owner=admin
            ).pk,
            "user_album": create_test_album_user(title="Trip", owner=admin).pk,
            "person": create_test_person(name="Ana", cluster_owner=admin).pk,
            "tag": create_test_tag(name="beach", owner=admin).pk,
            "job": create_test_job(
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
    "api.views.scan_triggers.LookUpPlacesView",
    "api.views.scan_triggers.StripThumbnailMetadataView",
    "api.views.services.ServiceViewSet",
    "api.views.site_settings.TrashRetentionPreviewView",
    "api.views.upgrade_tasks.UpgradeTaskDismissView",
    "api.views.upgrade_tasks.UpgradeTaskListView",
    "api.views.upgrade_tasks.UpgradeTaskStartView",
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


# --- One error shape (#2325) ---------------------------------------------------

# Calls that build a response a view hands back as is.
RESPONSE_CALLS = frozenset({"Response", "JsonResponse"})
# Django's error responses: a DRF view raises the matching exception instead.
DJANGO_ERROR_RESPONSES = frozenset(
    {"HttpResponseBadRequest", "HttpResponseNotFound", "HttpResponseForbidden"}
)


def _called_name(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _status_code(value: ast.expr) -> int | None:
    """The HTTP status ``value`` spells: a literal or ``status.HTTP_<code>_*``."""
    if isinstance(value, ast.Constant) and isinstance(value.value, int):
        return value.value
    if isinstance(value, ast.Attribute) and value.attr.startswith("HTTP_"):
        code = value.attr.split("_")[1]
        return int(code) if code.isdigit() else None
    return None


def _body_problems(body: ast.expr | None) -> list[str]:
    if not isinstance(body, ast.Dict):
        return []
    problems = []
    for key, value in zip(body.keys, body.values, strict=True):
        if not isinstance(key, ast.Constant):
            continue
        if key.value == "error":
            problems.append('an "error" key')
        if (
            key.value == "status"
            and isinstance(value, ast.Constant)
            and value.value is False
        ):
            problems.append('"status": False')
    return problems


def hand_built_error_bodies(
    source: str, filename: str, allowed: frozenset[str] = frozenset()
) -> list[str]:
    """Places in ``source`` that answer an error themselves instead of raising."""
    problems = []
    for node in ast.walk(ast.parse(source, filename)):
        if isinstance(node, ast.keyword) and node.arg == "status":
            if isinstance(node.value, ast.Constant):
                problems.append(
                    f"{filename}:{node.value.lineno} passes status={node.value.value!r} "
                    "(use a status.HTTP_* constant)"
                )
            continue
        if not isinstance(node, ast.Call):
            continue
        name = _called_name(node)
        if name in DJANGO_ERROR_RESPONSES and name not in allowed:
            problems.append(f"{filename}:{node.lineno} builds {name}")
        if name not in RESPONSE_CALLS:
            continue
        body = node.args[0] if node.args else None
        for keyword in node.keywords:
            if keyword.arg == "data":
                body = keyword.value
            if keyword.arg == "status":
                code = _status_code(keyword.value)
                if code is not None and code >= 400:
                    problems.append(
                        f"{filename}:{node.lineno} {name} with status {code}"
                    )
        for problem in _body_problems(body):
            problems.append(f"{filename}:{node.lineno} {name} body has {problem}")
    return sorted(problems, key=lambda p: (int(p.split(":")[1].split()[0]), p))


class ErrorEnvelopeTest(SimpleTestCase):
    """Views raise DRF exceptions; only the exception handler writes an error body.

    Media file responses (``HttpResponse(status=404)`` for an ``<img>``) are not
    API bodies and are not checked; the media views' bodiless 403 is exempt
    through ``BANNED_RESPONSE_EXEMPTIONS``. Every view module is at zero, so
    there is no baseline: a new hand-built error fails at once.
    """

    def test_no_view_builds_an_error_body(self):
        problems = []
        for relative, source_path in view_source_files():
            problems += hand_built_error_bodies(
                source_path.read_text(encoding="utf-8"),
                relative,
                BANNED_RESPONSE_EXEMPTIONS.get(relative, frozenset()),
            )
        self.assertEqual(
            problems,
            [],
            "Raise a DRF exception (ValidationError, NotFound, PermissionDenied, "
            "or one from api/drf/exceptions.py) instead, with code= where a client "
            "branches on it:\n  " + "\n  ".join(problems),
        )

    def test_the_source_check_catches_each_form(self):
        source = (
            "from django.http import HttpResponseBadRequest, JsonResponse\n"
            "def a(request):\n"
            '    return Response({"error": "x"}, status=400)\n'
            "def b(request):\n"
            "    return Response(status=404)\n"
            "def c(request):\n"
            '    return Response({"status": False, "message": "no"})\n'
            "def d(request):\n"
            "    return JsonResponse({}, status=status.HTTP_409_CONFLICT)\n"
            "def e(request):\n"
            "    return HttpResponseBadRequest()\n"
            "def f(request):\n"
            '    return Response(data={"error": "x"}, status=status.HTTP_200_OK)\n'
        )

        problems = hand_built_error_bodies(source, "planted.py")

        self.assertEqual(
            problems,
            [
                'planted.py:3 Response body has an "error" key',
                "planted.py:3 Response with status 400",
                "planted.py:3 passes status=400 (use a status.HTTP_* constant)",
                "planted.py:5 Response with status 404",
                "planted.py:5 passes status=404 (use a status.HTTP_* constant)",
                'planted.py:7 Response body has "status": False',
                "planted.py:9 JsonResponse with status 409",
                "planted.py:11 builds HttpResponseBadRequest",
                'planted.py:13 Response body has an "error" key',
            ],
        )

    def test_successes_and_media_responses_pass(self):
        source = (
            "def a(request):\n"
            '    return Response({"status": True}, status=status.HTTP_201_CREATED)\n'
            "def b(request):\n"
            "    return HttpResponse(status=status.HTTP_404_NOT_FOUND)\n"
            "def c(request):\n"
            "    return HttpResponseForbidden()\n"
        )

        self.assertEqual(
            hand_built_error_bodies(
                source, "api/views/media.py", frozenset({"HttpResponseForbidden"})
            ),
            [],
        )


# What a view may not read by hand: it passes them as ``data=`` to a serializer,
# or reads them through ``parse_query``/``parse_body`` (api/drf/params.py).
REQUEST_INPUTS = frozenset({"data", "query_params", "GET", "POST"})
# The chunked upload views extend django-chunked-upload's ChunkedUploadView,
# whose protocol is multipart form fields read from request.POST.
REQUEST_PARSING_EXEMPTIONS: dict[str, frozenset[str]] = {
    "api/views/upload.py": frozenset({"POST"}),
}


def _is_request(node: ast.expr) -> bool:
    """``request`` or ``<anything>.request``."""
    if isinstance(node, ast.Name):
        return node.id == "request"
    return isinstance(node, ast.Attribute) and node.attr == "request"


def hand_parsed_request_inputs(
    source: str, filename: str, exempt: frozenset[str] = frozenset()
) -> list[str]:
    """Places in ``source`` that read the request's input without a serializer."""
    tree = ast.parse(source, filename)
    handed_over = {
        id(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.keyword) and node.arg == "data"
    }
    problems = []
    for node in ast.walk(tree):
        if id(node) in handed_over:
            continue
        if (
            isinstance(node, ast.Attribute)
            and node.attr in REQUEST_INPUTS
            and node.attr not in exempt
            and _is_request(node.value)
        ):
            problems.append(f"{filename}:{node.lineno} reads request.{node.attr}")
        elif isinstance(node, ast.Call) and _called_name(node) == "request_dict":
            problems.append(f"{filename}:{node.lineno} calls request_dict")
    return sorted(problems, key=lambda p: (int(p.split(":")[1].split()[0]), p))


def request_parsing_problems() -> dict[str, list[str]]:
    """The hand reads of each view module that still has any."""
    found = {}
    for relative, source_path in view_source_files():
        problems = hand_parsed_request_inputs(
            source_path.read_text(encoding="utf-8"),
            relative,
            REQUEST_PARSING_EXEMPTIONS.get(relative, frozenset()),
        )
        if problems:
            found[relative] = problems
    return found


class RequestParsingGuardTest(SimpleTestCase):
    """Views read their input through a serializer, not field by field (#2326).

    A hand read (``request.data.get``, ``int(request.query_params.get(...))``,
    ``request_dict(request)["key"]``) answers a missing or malformed field with
    a 500 and drifts from the OpenAPI schema. Read the input with
    ``parse_query(request, XQuery)`` or ``parse_body(request, XRequest)`` from
    ``api/drf/params.py``, or pass it as ``data=`` to a serializer.
    """

    def test_no_view_module_reads_input_by_hand(self):
        found = [
            problem
            for problems in request_parsing_problems().values()
            for problem in problems
        ]
        self.assertEqual(
            found,
            [],
            "Read the request through a serializer (parse_query/parse_body in "
            "api/drf/params.py) instead:\n  " + "\n  ".join(found),
        )

    def test_the_source_check_catches_each_form(self):
        source = (
            "def a(request):\n"
            '    return int(request.query_params.get("x"))\n'
            "def b(self):\n"
            '    return self.request.data["y"]\n'
            "def c(request):\n"
            '    return request_dict(request).get("z")\n'
            "def d(request):\n"
            '    return request.GET.get("a"), request.POST.get("b")\n'
            "def e(request):\n"
            '    return "path" in request.query_params\n'
        )

        self.assertEqual(
            hand_parsed_request_inputs(source, "planted.py"),
            [
                "planted.py:2 reads request.query_params",
                "planted.py:4 reads request.data",
                "planted.py:6 calls request_dict",
                "planted.py:8 reads request.GET",
                "planted.py:8 reads request.POST",
                "planted.py:10 reads request.query_params",
            ],
        )

    def test_a_planted_query_read_in_a_view_module_fails_the_guard(self):
        relative, source_path = next(
            (relative, path)
            for relative, path in view_source_files()
            if relative == "api/views/geocode.py"
        )
        source = source_path.read_text(encoding="utf-8") + (
            '\n\ndef planted(request):\n    return int(request.query_params.get("x"))\n'
        )

        found = hand_parsed_request_inputs(source, relative)

        planted_line = len(source.splitlines())
        self.assertEqual(
            found, [f"{relative}:{planted_line} reads request.query_params"]
        )

    def test_handing_the_input_to_a_serializer_passes(self):
        source = (
            "def a(request):\n"
            "    serializer = XRequest(data=request.data)\n"
            "    return parse_query(request, XQuery)\n"
            "def b(self, request):\n"
            "    serializer = self.get_serializer(data=request_dict(request))\n"
            "    return parse_body(request, XRequest)\n"
            "def c(request, data):\n"
            '    return data.get("not_the_request")\n'
        )

        self.assertEqual(hand_parsed_request_inputs(source, "planted.py"), [])

    def test_the_upload_exemption_covers_only_form_fields(self):
        source = (
            "def a(request):\n"
            '    return request.POST.get("upload_id"), request.data.get("x")\n'
        )

        self.assertEqual(
            hand_parsed_request_inputs(
                source,
                "api/views/upload.py",
                REQUEST_PARSING_EXEMPTIONS["api/views/upload.py"],
            ),
            ["api/views/upload.py:2 reads request.data"],
        )


class ThrottledAuthViewsTest(SimpleTestCase):
    def test_no_view_takes_basic_credentials_unthrottled(self):
        # Every Basic request is a password check; ThrottledBasicAuthentication
        # rate limits the failed ones, DRF's own class does not.
        unthrottled = sorted(
            qualname(view)
            for view in drf_views(api_routes())
            if BasicAuthentication in view.authentication_classes
        )
        self.assertEqual(unthrottled, [])

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


# --- One pagination style (#2327) ---------------------------------------------

# List routes that answer every row at once, and why. Every other list pages
# with api.drf.pagination.DefaultPagination or one of its presets.
UNPAGINATED_LIST_VIEWS: dict[str, str] = {
    "api.views.albums.AlbumDateListViewSet": (
        "the timeline's index, one row per day without its photos; the "
        "clients lay the whole timeline out from it"
    ),
    "api.views.faces.FaceIncompleteListViewSet": (
        "one row per person with a face count, plus the unknown-faces row the "
        "view appends"
    ),
    "api.views.photos.RecentlyAddedPhotoListViewSet": (
        "the photos of the latest upload day, with that day, in one answer"
    ),
    "api.views.search.SearchListViewSet": (
        "search results grouped by date (or the semantic top k), in one answer"
    ),
    "api.views.services.ServiceViewSet": "the fixed list of sidecar services",
}


def list_routes(routes: Iterable[ApiRoute]) -> dict[type, ApiRoute]:
    """Each view class that serves a ``list`` action, with its first route."""
    views: dict[type, ApiRoute] = {}
    for route in routes:
        actions = getattr(route.callback, "actions", None) or {}
        if "list" in actions.values():
            views.setdefault(route.view, route)
    return views


def _calls(function: Callable[..., object], name: str) -> bool:
    """Whether ``function``'s source calls a method called ``name``."""
    source = textwrap.dedent(inspect.getsource(function))
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == name
        for node in ast.walk(ast.parse(source))
    )


def list_pages(view: type) -> bool:
    """Whether the ``list`` a view runs reaches ``paginate_queryset``.

    Follows ``super().list(...)`` down the MRO to ``ListModelMixin.list``; a
    ``list`` that does neither builds its own answer.
    """
    for klass in view.__mro__:
        implementation = vars(klass).get("list")
        if implementation is None:
            continue
        if klass is mixins.ListModelMixin or _calls(
            implementation, "paginate_queryset"
        ):
            return True
        if not _calls(implementation, "list"):
            return False
    return False


def pagination_problems(
    routes: Iterable[ApiRoute],
    unpaginated: dict[str, str] = UNPAGINATED_LIST_VIEWS,
) -> list[str]:
    """List views that do not page the one project way, one line each."""
    problems = []
    for view, route in list_routes(routes).items():
        name = qualname(view)
        pagination = getattr(view, "pagination_class", None)
        if name in unpaginated:
            if pagination is not None:
                problems.append(
                    f"{route.route} {name}: in UNPAGINATED_LIST_VIEWS but "
                    f"pages with {pagination.__name__}"
                )
            continue
        if not (
            isinstance(pagination, type) and issubclass(pagination, DefaultPagination)
        ):
            label = getattr(pagination, "__name__", repr(pagination))
            problems.append(
                f"{route.route} {name}: pagination_class is {label}, not "
                "DefaultPagination or a preset of it"
            )
        elif not list_pages(view):
            problems.append(
                f"{route.route} {name}: overrides list() without "
                "paginate_queryset(), so its pagination_class does nothing"
            )
    return problems


def django_paginator_uses(source: str, filename: str) -> list[str]:
    """Imports of ``django.core.paginator`` in ``source``."""
    problems = []
    for node in ast.walk(ast.parse(source, filename)):
        modules: list[str] = []
        if isinstance(node, ast.ImportFrom) and node.module:
            modules = [node.module]
        elif isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        if any(module.startswith("django.core.paginator") for module in modules):
            problems.append(
                f"{filename}:{node.lineno} imports django.core.paginator (page "
                "with self.paginate_queryset(), see api/drf/pagination.py)"
            )
    return problems


def pagination_subclasses() -> list[type[DefaultPagination]]:
    """Every subclass of DefaultPagination outside the tests, at any depth.

    The tests' planted classes stay in ``__subclasses__()`` until they are
    garbage collected, so they are left out by module.
    """
    found: list[type[DefaultPagination]] = []
    pending: list[type[DefaultPagination]] = [DefaultPagination]
    while pending:
        for subclass in pending.pop().__subclasses__():
            pending.append(subclass)
            if ".tests." not in f"{subclass.__module__}.":
                found.append(subclass)
    return found


def preset_problems(classes: Iterable[type]) -> list[str]:
    """Presets outside api/drf/pagination.py or with another envelope."""
    problems = [
        f"{qualname(klass)} is not in api/drf/pagination.py"
        for klass in classes
        if klass.__module__ != "api.drf.pagination"
    ]
    problems += [
        f"{qualname(klass)} overrides {method}"
        for klass in classes
        for method in ("get_paginated_response", "get_paginated_response_schema")
        if method in vars(klass)
    ]
    return problems


def _planted_list_urlconf(viewset: type[viewsets.GenericViewSet]) -> types.ModuleType:
    """The project URLconf with ``viewset``'s list routed at api/planted/."""
    planted = types.ModuleType("planted_urls")
    planted.__dict__["urlpatterns"] = [
        re_path(r"^api/planted/$", viewset.as_view({"get": "list"})),
        *project_urls.urlpatterns,
    ]
    return planted


class PaginationConventionTest(SimpleTestCase):
    def test_every_list_view_pages_with_the_default_pagination(self):
        problems = pagination_problems(api_routes())
        self.assertEqual(
            problems,
            [],
            "Page lists with api.drf.pagination.DefaultPagination (or a preset of "
            "it) through paginate_queryset(), or set pagination_class = None "
            "and list the view with the reason in UNPAGINATED_LIST_VIEWS:\n  "
            + "\n  ".join(problems),
        )

    def test_the_walk_reaches_paginated_and_unpaginated_lists(self):
        routed = {qualname(view) for view in list_routes(api_routes())}
        self.assertIn("api.views.albums.PersonViewSet", routed)
        self.assertIn("api.views.user.UserViewSet", routed)
        self.assertEqual(set(UNPAGINATED_LIST_VIEWS) - routed, set())

    def test_the_default_is_the_project_pagination(self):
        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_PAGINATION_CLASS"],
            "api.drf.pagination.DefaultPagination",
        )
        self.assertEqual(settings.REST_FRAMEWORK["PAGE_SIZE"], DEFAULT_PAGE_SIZE)
        self.assertEqual(DefaultPagination.max_page_size, MAX_PAGE_SIZE)

    def test_a_planted_hand_made_pagination_class_is_caught(self):
        class HandMadePagination(PageNumberPagination):
            page_size = 50

        class PlantedViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
            permission_classes = (IsAuthenticated,)
            queryset = Tag.objects.none()
            serializer_class = TagSerializer
            pagination_class = HandMadePagination

        with override_settings(ROOT_URLCONF=_planted_list_urlconf(PlantedViewSet)):
            problems = pagination_problems(api_routes())

        self.assertEqual(len(problems), 1, problems)
        self.assertIn("api/planted/", problems[0])
        self.assertIn("pagination_class is HandMadePagination", problems[0])

    def test_a_planted_list_override_that_never_pages_is_caught(self):
        class PlantedViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
            permission_classes = (IsAuthenticated,)
            queryset = Tag.objects.none()
            serializer_class = TagSerializer
            pagination_class = DefaultPagination

            def list(self, request: Request) -> Response:
                serializer = self.get_serializer(self.get_queryset(), many=True)
                return Response({"results": serializer.data})

        with override_settings(ROOT_URLCONF=_planted_list_urlconf(PlantedViewSet)):
            problems = pagination_problems(api_routes())

        self.assertEqual(len(problems), 1, problems)
        self.assertIn("overrides list() without paginate_queryset()", problems[0])

    def test_a_list_override_that_calls_super_still_pages(self):
        class PlantedViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
            def list(self, request: Request) -> Response:
                return super().list(request)

        self.assertTrue(list_pages(PlantedViewSet))

    def test_a_stale_unpaginated_entry_is_caught(self):
        unpaginated = {
            **UNPAGINATED_LIST_VIEWS,
            "api.views.albums.PersonViewSet": "planted",
        }
        problems = pagination_problems(api_routes(), unpaginated)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("in UNPAGINATED_LIST_VIEWS but pages", problems[0])

    def test_no_view_module_uses_djangos_paginator(self):
        problems = []
        for relative, path in view_source_files():
            source = path.read_text(encoding="utf-8")
            problems += django_paginator_uses(source, relative)
        self.assertEqual(problems, [], "\n".join(problems))

    def test_a_planted_paginator_import_is_caught(self):
        source = (
            "from django.core.paginator import Paginator\n"
            "import django.core.paginator\n"
            "def page(rows):\n"
            "    return Paginator(rows, 20).page(1)\n"
        )

        problems = django_paginator_uses(source, "api/views/planted.py")

        self.assertEqual(len(problems), 2, problems)
        self.assertIn(
            "api/views/planted.py:1 imports django.core.paginator", problems[0]
        )
        self.assertIn("api/views/planted.py:2", problems[1])

    def test_presets_live_in_one_module_and_keep_the_one_envelope(self):
        presets = pagination_subclasses()
        self.assertIn(DayAlbumPagination, presets)
        self.assertEqual(preset_problems(presets), [])

    def test_a_preset_with_its_own_envelope_is_caught(self):
        class PlantedPagination(DefaultPagination):
            def get_paginated_response(self, data: object) -> Response:
                return Response({"rows": data})

        self.assertEqual(
            preset_problems([PlantedPagination]),
            [
                f"{qualname(PlantedPagination)} is not in api/drf/pagination.py",
                f"{qualname(PlantedPagination)} overrides get_paginated_response",
            ],
        )
