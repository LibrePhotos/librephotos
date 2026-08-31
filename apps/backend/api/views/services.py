from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from api.services import (
    SERVICE_FEATURE_FLAGS,
    SERVICES,
    is_healthy,
    is_service_enabled,
    start_service,
    stop_service,
)


class ServiceViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser]

    def list(self, request):
        return Response({"services": SERVICES})

    def retrieve(self, request, pk=None):
        service_name = pk

        if service_name not in SERVICES:
            return Response(
                {"error": f"Service {service_name} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

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
    def start(self, request, pk=None):
        service_name = pk

        if service_name not in SERVICES:
            return Response(
                {"error": f"Service {service_name} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not is_service_enabled(service_name):
            flag = SERVICE_FEATURE_FLAGS[service_name]
            return Response(
                {
                    "error": f"Service {service_name} is not started: {flag} is disabled",
                    "feature_flag": flag,
                },
                status=status.HTTP_409_CONFLICT,
            )

        start_result = start_service(service_name)
        if start_result:
            return Response(
                {"message": f"Service {service_name} started successfully"},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": f"Failed to start service {service_name}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        service_name = pk

        if service_name not in SERVICES:
            return Response(
                {"error": f"Service {service_name} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        stop_result = stop_service(service_name)
        if stop_result:
            return Response(
                {"message": f"Service {service_name} stopped successfully"},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": f"Failed to stop service {service_name}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
