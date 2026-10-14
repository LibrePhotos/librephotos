"""Views that build their answer by hand answer what openapi.json declares.

The health, server, statistics, stack, duplicate, job queue, email, password
reset and SSO views return dicts, and their response serializers
(``@extend_schema(responses=...)``) only describe them. Each test here calls a view with data that fills every branch it can and validates the
body against the committed schema (``api/tests/openapi_responses.py``), so a
key the view adds, drops or retypes fails here and not in a client. Issue #485.
"""

import json
import os
import shutil
import tempfile
from typing import Any
from unittest.mock import patch

from allauth.socialaccount.models import SocialApp
from constance.test import override_config
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sites.models import Site
from django.db.utils import OperationalError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient, APIRequestFactory

from api.models import File, Person, Photo, User
from api.models.duplicate import Duplicate
from api.models.email_config import EmailConfig
from api.models.photo_stack import PhotoStack
from api.search.semantic import OPENCLIP
from api.tests.fixtures.api_util.photos import photos as geocoded_photos
from api.tests.openapi_responses import openapi_mismatches, to_json_schema
from api.tests.utils import (
    create_test_album_user,
    create_test_duplicate,
    create_test_face,
    create_test_file,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_user,
)
from api.views.server_info import ApiHelpView
from librephotos.logging_bootstrap import LOG_FILENAME


class DeclaredResponseTestCase(TestCase):
    def assert_declared(
        self,
        path: str,
        url: str,
        status: int = 200,
        method: str = "get",
        data: dict[str, Any] | None = None,
    ) -> Any:
        """Call ``url`` (a JSON ``data`` body if given) and check the answer
        against ``path``'s schema for ``method``; returns the body."""
        call = getattr(self.client, method)
        response = call(url) if data is None else call(url, data, format="json")
        self.assertEqual(status, response.status_code, response.content[:300])
        body = response.json()
        self.assertEqual([], openapi_mismatches(path, method, status, body))
        return body


class HealthResponsesTest(DeclaredResponseTestCase):
    def setUp(self) -> None:
        self.client = APIClient()

    def test_probes_that_answer(self) -> None:
        for path in (
            "/api/healthz/",
            "/api/healthz/postgresql/",
            "/api/healthz/queue/",
            "/api/healthz/ready/",
        ):
            with self.subTest(path=path):
                self.assert_declared(path, path)

    def test_probes_with_the_database_down(self) -> None:
        with patch("api.views.health.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError(
                "connection refused"
            )
            self.assert_declared(
                "/api/healthz/postgresql/", "/api/healthz/postgresql", 503
            )
            self.assert_declared("/api/healthz/ready/", "/api/healthz/ready", 503)

    def test_queue_probe_with_the_broker_down(self) -> None:
        with patch(
            "api.views.health.get_broker", side_effect=OperationalError("no broker")
        ):
            self.assert_declared("/api/healthz/queue/", "/api/healthz/queue", 503)


class ServerInfoResponsesTest(DeclaredResponseTestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def test_storage_stats(self) -> None:
        with override_settings(DATA_ROOT=tempfile.gettempdir()):
            self.assert_declared("/api/storagestats/", "/api/storagestats/")

    @override_settings(IMAGE_TAG="", GIT_HASH="abc1234")
    def test_image_tag(self) -> None:
        self.assert_declared("/api/imagetag/", "/api/imagetag/")

    def test_api_help_with_and_without_debug(self) -> None:
        # urls.py mounts the route only under DEBUG, which the test runner
        # turns off before it imports them: the view is called directly. It
        # adds the schema links when DEBUG is on at request time.
        view = ApiHelpView.as_view()
        for debug in (True, False):
            with self.subTest(debug=debug), override_settings(DEBUG=debug):
                response = view(APIRequestFactory().get("/api/help"))
                response.render()
                body = json.loads(response.content)
                self.assertEqual(debug, "swagger_ui" in body["useful_endpoints"])
                self.assertEqual([], openapi_mismatches("/api/help", "get", 200, body))


class ServerAdminResponsesTest(DeclaredResponseTestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    def test_server_stats_with_an_empty_and_a_filled_library(self) -> None:
        # An empty library gives null aggregates; the second user fills them.
        create_test_user()
        owner = create_test_user()
        photo = create_test_photo(owner=owner, video=True)
        album = create_test_album_user(owner=owner)
        album.photos.add(photo)
        create_test_face(photo=photo, person=create_test_person(cluster_owner=owner))
        # py-cpuinfo's real answer for this machine; nvidia-smi is never run.
        with patch("api.dataviz.stats.binaries.available", return_value=False):
            self.assert_declared("/api/serverstats/", "/api/serverstats/")

    def test_server_stats_with_a_gpu(self) -> None:
        with (
            patch("api.dataviz.stats._get_gpu_info", return_value=("GPU", 6144)),
            patch("cpuinfo.get_cpu_info", return_value=self._cpu_info()),
        ):
            self.assert_declared("/api/serverstats/", "/api/serverstats/")

    @staticmethod
    def _cpu_info() -> dict[str, object]:
        return {
            "python_version": "3.12.3.final.0 (64 bit)",
            "cpuinfo_version": [9, 0, 0],
            "cpuinfo_version_string": "9.0.0",
            "arch": "ARM_8",
            "bits": 64,
            "count": 4,
            "arch_string_raw": "aarch64",
            "hardware_raw": "BCM2835",
            "l2_cache_size": "512 KiB",
        }

    def test_server_log_tail(self) -> None:
        logs_root = tempfile.mkdtemp(prefix="librephotos-serverlogs-")
        self.addCleanup(shutil.rmtree, logs_root, True)
        with open(os.path.join(logs_root, LOG_FILENAME), "w", encoding="utf-8") as f:
            f.write("first\nsecond\n")
        with override_settings(LOGS_ROOT=logs_root):
            self.assert_declared("/api/serverlogs/view/", "/api/serverlogs/view")


class StatsResponsesTest(DeclaredResponseTestCase):
    """The statistics views, over the geocoded sample library the stats tests use."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _fill_library(self) -> None:
        for photo in geocoded_photos:
            create_test_photo(owner=self.user, **photo)
        # Two people on one photo link them in the social graph; the faces
        # also feed the word cloud's people and the face cluster chart, the
        # tags its captions.
        photo = create_test_photo(
            owner=self.user, captions_json={OPENCLIP: {"tags": ["beach", "sea"]}}
        )
        for name in ("Alice", "Bob", "Carol"):
            person = create_test_person(name=name, cluster_owner=self.user)
            create_test_face(photo=photo, person=person)
        create_test_face(photo=photo)
        self.assertEqual(3, Person.objects.filter(cluster_owner=self.user).count())

    STATS_PATHS = (
        "/api/stats/",
        "/api/wordcloud/",
        "/api/photomonthcounts/",
        "/api/locationsunburst/",
        "/api/locationtimeline/",
        "/api/locclust/",
        "/api/socialgraph/",
        "/api/clusterfaces/",
    )

    def test_statistics_of_an_empty_library(self) -> None:
        for path in self.STATS_PATHS:
            with self.subTest(path=path):
                self.assert_declared(path, path)

    def test_statistics_of_a_filled_library(self) -> None:
        self._fill_library()
        for path in self.STATS_PATHS:
            with self.subTest(path=path):
                body = self.assert_declared(path, path)
                # Every list in the answer has rows, so the rows were checked too.
                lists = body.values() if isinstance(body, dict) else [body]
                for rows in lists:
                    if isinstance(rows, list):
                        self.assertTrue(rows)


def group_photos(owner: User) -> list[Photo]:
    """Three photos that fill both branches of every photo row field of a
    stack or duplicate group: metadata and thumbnails or none, a main file or
    none, file variants (a RAW, one without a path) or none."""
    full = create_test_photo(
        owner=owner,
        width=4000,
        height=3000,
        camera="EOS R5",
        exif_timestamp=timezone.now(),
        size=2048,
    )
    raw = create_test_file(None, owner, file_type=File.RAW_FILE)
    nameless = create_test_file(None, owner)
    File.objects.filter(pk=nameless.pk).update(path="")
    full.files.add(full.main_file, raw, nameless)
    bare = create_test_photo(owner=owner, square_thumbnail_small="", thumbnail_big="")
    orphan = create_test_photo(owner=owner)
    orphan.files.add(orphan.main_file)
    orphan.main_file = None
    orphan.save()
    return [full, bare, orphan]


class StackResponsesTest(DeclaredResponseTestCase):
    """The stack views (``api/views/stacks.py``)."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = group_photos(self.user)
        full, bare, orphan = self.photos
        # A burst with a cover photo, and a bracket without one.
        self.burst = create_test_stack(
            self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            sequence_start=timezone.now(),
            sequence_end=timezone.now(),
            primary_photo=full,
        )
        self.burst.photos.add(*self.photos)
        self.bracket = create_test_stack(
            self.user, stack_type=PhotoStack.StackType.EXPOSURE_BRACKET
        )
        self.bracket.photos.add(bare, orphan)
        create_test_stack(self.user, stack_type=PhotoStack.StackType.RAW_JPEG_PAIR)

    def hashes(self, *photos: Photo) -> dict[str, list[str]]:
        return {"photo_hashes": [photo.image_hash for photo in photos]}

    def test_list_detail_and_stats(self) -> None:
        body = self.assert_declared("/api/stacks/", "/api/stacks/")
        self.assertEqual(2, body["count"])
        for stack in (self.burst, self.bracket):
            with self.subTest(stack=stack.stack_type):
                self.assert_declared(
                    "/api/stacks/{stack_id}/", f"/api/stacks/{stack.id}/"
                )
        self.assert_declared("/api/stacks/stats/", "/api/stacks/stats/")

    def test_an_empty_list(self) -> None:
        self.client.force_authenticate(user=create_test_user())
        self.assert_declared("/api/stacks/", "/api/stacks/")
        self.assert_declared("/api/stacks/stats/", "/api/stacks/stats/")

    def test_set_primary_add_and_remove(self) -> None:
        full, bare, orphan = self.photos
        self.assert_declared(
            "/api/stacks/{stack_id}/primary/",
            f"/api/stacks/{self.bracket.id}/primary/",
            method="post",
            data={"photo_hash": bare.image_hash},
        )
        self.assert_declared(
            "/api/stacks/{stack_id}/add/",
            f"/api/stacks/{self.bracket.id}/add/",
            method="post",
            data=self.hashes(full),
        )
        remove = "/api/stacks/{stack_id}/remove/"
        updated = self.assert_declared(
            remove,
            f"/api/stacks/{self.burst.id}/remove/",
            method="post",
            data=self.hashes(orphan),
        )
        deleted = self.assert_declared(
            remove,
            f"/api/stacks/{self.burst.id}/remove/",
            method="post",
            data=self.hashes(bare),
        )
        self.assertEqual(["updated", "deleted"], [updated["status"], deleted["status"]])

    def test_create_and_merge_manual_stacks(self) -> None:
        full, bare, orphan = self.photos
        created = self.assert_declared(
            "/api/stacks/manual/",
            "/api/stacks/manual/",
            201,
            method="post",
            data=self.hashes(full, bare),
        )
        alone = self.assert_declared(
            "/api/stacks/merge/",
            "/api/stacks/merge/",
            method="post",
            data=self.hashes(full),
        )
        other = create_test_stack(self.user, stack_type=PhotoStack.StackType.MANUAL)
        other.photos.add(orphan, create_test_photo(owner=self.user))
        merged = self.assert_declared(
            "/api/stacks/merge/",
            "/api/stacks/merge/",
            method="post",
            data=self.hashes(full, orphan),
        )
        self.assertEqual("created", created["status"])
        self.assertEqual(
            ["no_merge_needed", "merged"], [alone["status"], merged["status"]]
        )

    def test_delete_on_both_routes(self) -> None:
        self.assert_declared(
            "/api/stacks/{stack_id}/", f"/api/stacks/{self.burst.id}/", method="delete"
        )
        self.assert_declared(
            "/api/stacks/{stack_id}/delete/",
            f"/api/stacks/{self.bracket.id}/delete/",
            method="delete",
        )

    def test_detect(self) -> None:
        self.assert_declared(
            "/api/stacks/detect/", "/api/stacks/detect/", 202, method="post", data={}
        )


class DuplicateResponsesTest(DeclaredResponseTestCase):
    """The duplicate views (``api/views/duplicates.py``)."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = group_photos(self.user)
        full, bare, orphan = self.photos
        # A pending group without a kept photo, and a resolved visual one with.
        self.exact = create_test_duplicate(
            self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            potential_savings=3 * 1024 * 1024 + 17,
        )
        self.exact.photos.add(*self.photos)
        self.visual = create_test_duplicate(
            self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            similarity_score=0.93,
            kept_photo=full,
        )
        self.visual.photos.add(full, bare)

    def test_list_detail_and_stats(self) -> None:
        body = self.assert_declared("/api/duplicates/", "/api/duplicates/")
        self.assertEqual(2, body["count"])
        for duplicate in (self.exact, self.visual):
            with self.subTest(duplicate=duplicate.duplicate_type):
                self.assert_declared(
                    "/api/duplicates/{duplicate_id}/",
                    f"/api/duplicates/{duplicate.id}/",
                )
        stats = self.assert_declared("/api/duplicates/stats/", "/api/duplicates/stats/")
        self.assertEqual(3.0, stats["potential_savings_mb"])

    def test_an_empty_list(self) -> None:
        self.client.force_authenticate(user=create_test_user())
        self.assert_declared("/api/duplicates/", "/api/duplicates/")
        stats = self.assert_declared("/api/duplicates/stats/", "/api/duplicates/stats/")
        self.assertEqual(0, stats["potential_savings_mb"])

    def test_resolve_revert_dismiss_and_delete(self) -> None:
        group = f"/api/duplicates/{self.exact.id}"
        self.assert_declared(
            "/api/duplicates/{duplicate_id}/resolve/",
            f"{group}/resolve/",
            method="post",
            data={"keep_photo_hash": self.photos[0].image_hash},
        )
        self.assert_declared(
            "/api/duplicates/{duplicate_id}/revert/", f"{group}/revert/", method="post"
        )
        self.assert_declared(
            "/api/duplicates/{duplicate_id}/dismiss/",
            f"{group}/dismiss/",
            method="post",
        )
        self.assert_declared(
            "/api/duplicates/{duplicate_id}/delete/",
            f"{group}/delete/",
            method="delete",
        )

    def test_detect(self) -> None:
        self.assert_declared(
            "/api/duplicates/detect/",
            "/api/duplicates/detect/",
            202,
            method="post",
            data={},
        )


class SettingsAndAuthResponsesTest(DeclaredResponseTestCase):
    """The job queue, time zone, email, password reset and SSO views."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user(is_admin=True, email="admin@example.com")
        self.client.force_authenticate(user=self.user)

    def test_queue_availability_idle_and_busy(self) -> None:
        idle = self.assert_declared("/api/rqavailable/", "/api/rqavailable/")
        create_test_job(self.user)
        busy = self.assert_declared("/api/rqavailable/", "/api/rqavailable/")
        self.assertEqual(
            (None, False), (idle["job_detail"], busy["queue_can_accept_job"])
        )
        self.assertIsNotNone(busy["job_detail"])

    def test_time_zones(self) -> None:
        body = self.assert_declared("/api/timezones/", "/api/timezones/")
        self.assertIn("Europe/Berlin", json.loads(body))

    def test_email_config_read_write_and_test(self) -> None:
        self.assert_declared("/api/email-config/", "/api/email-config/")
        config = self.assert_declared(
            "/api/email-config/",
            "/api/email-config/",
            method="post",
            data={
                "provider": "custom",
                "host": "smtp.example.com",
                "from_email": "photos@example.com",
                "secret": "s3cret",
            },
        )
        self.assertTrue(config["is_configured"] and config["has_secret"])
        self.assertTrue(EmailConfig.load().is_configured)
        with patch("api.views.email_config.send_mail"):
            self.assert_declared(
                "/api/email-config/test/",
                "/api/email-config/test/",
                method="post",
                data={},
            )

    @override_settings(FRONTEND_BASE_URL="https://photos.example.com")
    def test_password_reset_request_and_confirm(self) -> None:
        self.client.force_authenticate(user=None)
        with patch("api.views.password_reset.send_mail"):
            self.assert_declared(
                "/api/auth/password/reset/",
                "/api/auth/password/reset/",
                method="post",
                data={"email": "admin@example.com"},
            )
        self.assert_declared(
            "/api/auth/password/reset/confirm/",
            "/api/auth/password/reset/confirm/",
            method="post",
            data={
                "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
                "token": default_token_generator.make_token(self.user),
                "new_password": "Correct-Horse-Battery-9",
            },
        )

    def test_sso_config_off_and_on(self) -> None:
        path = "/api/auth/sso/config/"
        self.assertEqual([], self.assert_declared(path, path)["providers"])
        app = SocialApp.objects.create(
            provider="openid_connect",
            provider_id="keycloak",
            name="Keycloak",
            client_id="librephotos",
            secret="s3cret",
            settings={"server_url": "https://idp.example.com"},
        )
        app.sites.add(Site.objects.get_current())
        with override_config(OIDC_ENABLED=True):
            self.assertTrue(self.assert_declared(path, path)["enabled"])


class ToJsonSchemaTest(SimpleTestCase):
    def test_nullable_allows_null(self) -> None:
        self.assertEqual(
            {"anyOf": [{"type": "integer"}, {"type": "null"}]},
            to_json_schema({"type": "integer", "nullable": True}),
        )

    def test_an_object_with_properties_accepts_no_other_key(self) -> None:
        converted = to_json_schema(
            {
                "type": "object",
                "properties": {"a": {"type": "array", "items": {"properties": {}}}},
            }
        )
        self.assertFalse(converted["additionalProperties"])
        self.assertFalse(converted["properties"]["a"]["items"]["additionalProperties"])

    def test_a_free_form_object_stays_open(self) -> None:
        node = {"type": "object", "additionalProperties": {}}
        self.assertEqual(node, to_json_schema(node))

    def test_branches_are_converted(self) -> None:
        converted = to_json_schema({"oneOf": [{"type": "string", "nullable": True}]})
        self.assertEqual({"type": "null"}, converted["anyOf"][0]["anyOf"][1])

    def test_one_of_accepts_a_value_more_than_one_branch_matches(self) -> None:
        # ``datetime | str``: any string matches both branches.
        converted = to_json_schema(
            {"oneOf": [{"type": "string", "format": "date-time"}, {"type": "string"}]}
        )
        self.assertNotIn("oneOf", converted)
        self.assertEqual(2, len(converted["anyOf"]))
