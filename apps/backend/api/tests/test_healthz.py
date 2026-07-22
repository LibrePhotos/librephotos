from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import TestCase
from rest_framework.test import APIClient


class HealthzTest(TestCase):
    """Every probe has to answer without credentials - that is the whole point,
    so no call in here is authenticated."""

    def setUp(self):
        self.client = APIClient()

    def test_liveness_should_be_reachable_unauthenticated(self):
        response = self.client.get("/api/healthz")
        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", response.json()["status"])

    def test_liveness_should_accept_a_trailing_slash(self):
        response = self.client.get("/api/healthz/")
        self.assertEqual(200, response.status_code)

    def test_liveness_should_not_query_the_database(self):
        with self.assertNumQueries(0):
            response = self.client.get("/api/healthz")
        self.assertEqual(200, response.status_code)

    def test_liveness_should_stay_up_when_the_database_is_down(self):
        with patch("api.views.health.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError(
                "connection refused"
            )
            response = self.client.get("/api/healthz")
        self.assertEqual(200, response.status_code)

    def test_postgresql_should_be_reachable_unauthenticated(self):
        response = self.client.get("/api/healthz/postgresql")
        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", response.json()["status"])

    def test_postgresql_should_fail_when_the_database_is_down(self):
        with patch("api.views.health.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError(
                "connection refused"
            )
            response = self.client.get("/api/healthz/postgresql")
        self.assertEqual(503, response.status_code)
        self.assertEqual("error", response.json()["status"])

    def test_postgresql_should_not_leak_the_underlying_error(self):
        with patch("api.views.health.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError(
                'connection to server at "db", user "docker" failed'
            )
            response = self.client.get("/api/healthz/postgresql")
        self.assertNotIn("docker", response.json()["error"])

    def test_queue_should_be_reachable_unauthenticated(self):
        response = self.client.get("/api/healthz/queue")
        data = response.json()
        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", data["status"])
        self.assertEqual(0, data["queued"])

    def test_queue_should_fail_when_the_broker_is_unreachable(self):
        with patch(
            "api.views.health.get_broker",
            side_effect=OperationalError("no such table: django_q_ormq"),
        ):
            response = self.client.get("/api/healthz/queue")
        self.assertEqual(503, response.status_code)
        self.assertEqual("error", response.json()["status"])

    def test_ready_should_be_reachable_unauthenticated(self):
        response = self.client.get("/api/healthz/ready")
        data = response.json()
        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", data["status"])
        self.assertEqual("ok", data["checks"]["postgresql"]["status"])
        self.assertEqual("ok", data["checks"]["queue"]["status"])

    def test_ready_should_fail_when_the_database_is_down(self):
        with patch("api.views.health.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError(
                "connection refused"
            )
            response = self.client.get("/api/healthz/ready")
        data = response.json()
        self.assertEqual(503, response.status_code)
        self.assertEqual("error", data["status"])
        self.assertEqual("error", data["checks"]["postgresql"]["status"])

    def test_ready_should_fail_when_the_broker_is_unreachable(self):
        with patch(
            "api.views.health.get_broker",
            side_effect=OperationalError("no such table: django_q_ormq"),
        ):
            response = self.client.get("/api/healthz/ready")
        data = response.json()
        self.assertEqual(503, response.status_code)
        self.assertEqual("error", data["status"])
        self.assertEqual("ok", data["checks"]["postgresql"]["status"])
        self.assertEqual("error", data["checks"]["queue"]["status"])
