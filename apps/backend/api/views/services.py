from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotFound
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.exceptions import Conflict
from api.services import (
    SERVICE_FEATURE_FLAGS,
    SERVICES,
    disabled_reason,
    is_healthy,
    is_service_enabled,
    start_service,
    stop_service,
)


class ServiceViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser]

    def list(self, request: Request) -> Response:
        return Response({"services": SERVICES})

    def retrieve(self, request: Request, pk: str | None = None) -> Response:
        service_name = pk

        if service_name not in SERVICES:
            raise NotFound(f"Service {service_name} not found")

        enabled = is_service_enabled(service_name)
        # A switched-off service is not probed, for the same reason the watchdog
        # does not probe it: nothing is listening, and every probe costs a
        # connection refusal and a stack trace in the log.
        return Response(
            {
                "service_name": service_name,
                "healthy": is_healthy(service_name) if enabled else False,
                "enabled": enabled,
                "feature_flag": SERVICE_FEATURE_FLAGS.get(service_name),
            }
        )

    @action(detail=True, methods=["post"])
    def start(self, request: Request, pk: str | None = None) -> Response:
        service_name = pk

        if service_name not in SERVICES:
            raise NotFound(f"Service {service_name} not found")

        if not is_service_enabled(service_name):
            # The message names the flag; the list endpoint carries it as
            # feature_flag for the settings page.
            raise Conflict(
                f"Service {service_name} is not started: "
                f"{disabled_reason(service_name)}",
                code="service_disabled",
            )

        start_result = start_service(service_name)
        if start_result:
            return Response(
                {"message": f"Service {service_name} started successfully"},
                status=status.HTTP_200_OK,
            )
        else:
            raise APIException(f"Failed to start service {service_name}")

    @action(detail=True, methods=["post"])
    def stop(self, request: Request, pk: str | None = None) -> Response:
        service_name = pk

        if service_name not in SERVICES:
            raise NotFound(f"Service {service_name} not found")

        stop_result = stop_service(service_name)
        if stop_result:
            return Response(
                {"message": f"Service {service_name} stopped successfully"},
                status=status.HTTP_200_OK,
            )
        else:
            raise APIException(f"Failed to stop service {service_name}")
