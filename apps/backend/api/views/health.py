import logging

from django.db import connections
from django_q.brokers import get_broker
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.serializers.health import HealthCheckSerializer, HealthReadySerializer

logger = logging.getLogger(__name__)

# A probe answers the same shape with 200 or 503.
CHECK_RESPONSES = {200: HealthCheckSerializer, 503: HealthCheckSerializer}


def _check_postgresql() -> dict[str, str]:
    """Round-trip the cheapest possible statement to prove the database answers."""
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as e:
        logger.warning("Healthcheck: database unreachable: %s", e)
        return {"status": "error", "error": "database unreachable"}
    return {"status": "ok"}


def _check_queue() -> dict[str, str]:
    """Count the queued tasks. django-q2 keeps its queue in the database (ORM broker),
    so this covers both the broker configuration and the django_q tables. The count
    itself stays out of the response: these endpoints are unauthenticated, and a
    backlog rising and falling tells a bystander when a scan is running."""
    try:
        get_broker().queue_size()
    except Exception as e:
        logger.warning("Healthcheck: queue broker unreachable: %s", e)
        return {"status": "error", "error": "queue broker unreachable"}
    return {"status": "ok"}


def _http_status(*results: dict[str, str]) -> int:
    if all(result["status"] == "ok" for result in results):
        return status.HTTP_200_OK
    return status.HTTP_503_SERVICE_UNAVAILABLE


class HealthCheckView(APIView):
    """Probes are called by kubelet and by the container healthchecks, which never
    carry credentials - so authentication is switched off rather than merely
    optional, to keep a stray Authorization header from hitting the database."""

    authentication_classes = ()
    permission_classes = (AllowAny,)


class HealthzView(HealthCheckView):
    """Liveness. 200 as long as the process can serve a request. Deliberately does
    not touch the database: a database outage must not get the pod killed."""

    @extend_schema(responses=HealthCheckSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response({"status": "ok"})


class HealthzPostgresqlView(HealthCheckView):
    @extend_schema(responses=CHECK_RESPONSES)
    def get(self, request: Request, format: str | None = None) -> Response:
        result = _check_postgresql()
        return Response(result, status=_http_status(result))


class HealthzQueueView(HealthCheckView):
    @extend_schema(responses=CHECK_RESPONSES)
    def get(self, request: Request, format: str | None = None) -> Response:
        result = _check_queue()
        return Response(result, status=_http_status(result))


class HealthzReadyView(HealthCheckView):
    """Readiness. 200 only once every dependency answers."""

    @extend_schema(responses={200: HealthReadySerializer, 503: HealthReadySerializer})
    def get(self, request: Request, format: str | None = None) -> Response:
        checks = {
            "postgresql": _check_postgresql(),
            "queue": _check_queue(),
        }
        http_status = _http_status(*checks.values())
        return Response(
            {
                "status": "ok" if http_status == status.HTTP_200_OK else "error",
                "checks": checks,
            },
            status=http_status,
        )
