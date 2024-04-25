from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from api.services import SERVICES, is_healthy, start_service, stop_service


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

        healthy = is_healthy(service_name)
        return Response({"service_name": service_name, "healthy": healthy})

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        service_name = pk

        if service_name not in SERVICES:
            return Response(
                {"error": f"Service {service_name} not found"},
                status=status.HTTP_404_NOT_FOUND,
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
