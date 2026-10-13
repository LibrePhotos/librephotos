"""Views that build their answer by hand answer what openapi.json declares.

The health, server and statistics views return dicts, and their response
serializers (``@extend_schema(responses=...)``) only describe them. Each test
here calls a view with data that fills every branch it can and validates the
body against the committed schema (``api/tests/openapi_responses.py``), so a
key the view adds, drops or retypes fails here and not in a client. Issue #485.
"""

import json
import os
import shutil
import tempfile
from typing import Any
from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory

from api.models import Person
from api.search.semantic import OPENCLIP
from api.tests.fixtures.api_util.photos import photos as geocoded_photos
from api.tests.openapi_responses import openapi_mismatches, to_json_schema
from api.tests.utils import (
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)
from api.views.server_info import ApiHelpView
from librephotos.logging_bootstrap import LOG_FILENAME


class DeclaredResponseTestCase(TestCase):
    def assert_declared(self, path: str, url: str, status: int = 200) -> Any:
        """GET ``url`` and check its body against ``path``'s schema; returns the body."""
        response = self.client.get(url)
        self.assertEqual(status, response.status_code, response.content[:300])
        body = response.json()
        self.assertEqual([], openapi_mismatches(path, "get", status, body))
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
        self.assertEqual({"type": "null"}, converted["oneOf"][0]["anyOf"][1])
