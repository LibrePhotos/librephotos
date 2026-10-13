from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotFound
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.exceptions import Conflict
from api.runtime.supervisor import (
    SERVICE_FEATURE_FLAGS,
    SERVICES,
    disabled_reason,
    is_healthy,
    is_service_enabled,
    port_conflict,
    start_error,
    start_service,
    stop_service,
)

# The router names the lookup "id"; it is a service's name (a key of SERVICES).
SERVICE_NAME = OpenApiParameter(
    "id",
    OpenApiTypes.STR,
    OpenApiParameter.PATH,
    description="The service's name, a key of the list's services",
)


class ServiceViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser]

    # A ViewSet without a serializer gives list and retrieve the same
    # operationId; spelled out so the schema does not number them.
    @extend_schema(operation_id="api_services_list")
    def list(self, request: Request) -> Response:
        return Response({"services": SERVICES})

    @extend_schema(parameters=[SERVICE_NAME])
    def retrieve(self, request: Request, pk: str | None = None) -> Response:
        service_name = pk

        if service_name not in SERVICES:
            raise NotFound(f"Service {service_name} not found")

        enabled = is_service_enabled(service_name)
        # A switched-off service is not probed, for the same reason the watchdog
        # does not probe it: nothing is listening, and every probe costs a
        # connection refusal and a stack trace in the log.
        healthy = is_healthy(service_name) if enabled else False
        # Why an enabled sidecar is down, when another program holds its port
        # (#2324); asked now rather than remembered from the last start, which
        # ran in another process (the job cluster's watchdog) anyway.
        conflict = port_conflict(service_name) if enabled and not healthy else None
        return Response(
            {
                "service_name": service_name,
                "healthy": healthy,
                "enabled": enabled,
                "feature_flag": SERVICE_FEATURE_FLAGS.get(service_name),
                "port_conflict": conflict,
            }
        )

    @extend_schema(parameters=[SERVICE_NAME])
    @action(detail=True, methods=["post"])
    def start(self, request: Request, pk: str | None = None) -> Response:
        service_name = pk

        if service_name not in SERVICES:
            raise NotFound(f"Service {service_name} not found")

        if not is_service_enabled(service_name):
            # The message names the switch to change: the environment flag
            # when the server configuration locked the feature off, else the
            # site setting. The retrieve endpoint carries the flag as
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
            reason = start_error(service_name)
            detail = f": {reason}" if reason else ""
            raise APIException(f"Failed to start service {service_name}{detail}")

    @extend_schema(parameters=[SERVICE_NAME])
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
