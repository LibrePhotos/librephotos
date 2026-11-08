"""The Error reports page (#2938) and the web app's error forwarder.

Every route but the forwarder is for admins: the list is the whole
instance's. Send once, Send all, Download and Delete work whatever the
``ERROR_REPORTING`` site setting says; that setting only decides whether new
reports are sent by themselves.
"""

import json

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.accounts.throttling import BrowserErrorReportRateThrottle
from api.drf.exceptions import ServiceUnavailable, UpstreamError
from api.drf.params import parse_body
from api.error_reports.capture import InvalidEnvelopeError, ingest_browser_envelope
from api.error_reports.send import (
    SendError,
    manual_dsn,
    send_report,
    send_saved_reports,
)
from api.models import ErrorReport
from api.serializers.error_reports import (
    BrowserErrorReportRequest,
    BrowserErrorReportSerializer,
    ErrorReportSendAllSerializer,
    ErrorReportSerializer,
)


def _report(report_id: int) -> ErrorReport:
    report = ErrorReport.objects.filter(id=report_id).first()
    if report is None:
        raise NotFound("There is no such error report.")
    return report


def _destination() -> str:
    dsn = manual_dsn()
    if dsn is None:
        raise ServiceUnavailable(
            "No error reporting server is set up: set SENTRY_DSN or"
            " ERROR_REPORTING_MAINTAINERS_DSN.",
            code="no_error_reporting_server",
        )
    return dsn


class ErrorReportListView(APIView):
    """The saved reports, newest first (at most 30), and Delete all."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=ErrorReportSerializer(many=True))
    def get(self, request: Request, format: str | None = None) -> Response:
        reports = ErrorReport.objects.order_by("-last_seen", "-id")
        return Response(ErrorReportSerializer(reports, many=True).data)

    @extend_schema(operation_id="api_error_reports_destroy_all", responses={204: None})
    def delete(self, request: Request, format: str | None = None) -> Response:
        ErrorReport.objects.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ErrorReportDetailView(APIView):
    """Delete one saved report."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses={204: None})
    def delete(
        self, request: Request, report_id: int, format: str | None = None
    ) -> Response:
        _report(report_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ErrorReportSendView(APIView):
    """Send once: one report to the chosen server, else the maintainers.

    502 ``upstream_error`` when that server refuses it or cannot be reached;
    503 ``no_error_reporting_server`` when there is nowhere to send to.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(request=None, responses=ErrorReportSerializer)
    def post(
        self, request: Request, report_id: int, format: str | None = None
    ) -> Response:
        report = _report(report_id)
        try:
            send_report(report, _destination())
        except SendError as error:
            raise UpstreamError(str(error)) from error
        return Response(ErrorReportSerializer(report).data)


class ErrorReportSendAllView(APIView):
    """Send all: every report not sent yet, to the same place as Send once."""

    permission_classes = (IsAdminUser,)

    @extend_schema(
        operation_id="api_error_reports_send_all",
        request=None,
        responses=ErrorReportSendAllSerializer,
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        sent, failed = send_saved_reports(_destination())
        return Response({"sent": sent, "failed": failed})


class ErrorReportDownloadView(APIView):
    """The report's event exactly as it would be sent, as a JSON file."""

    permission_classes = (IsAdminUser,)

    @extend_schema(
        responses={
            (200, "application/json"): OpenApiResponse(
                OpenApiTypes.OBJECT, description="The scrubbed event, as an attachment"
            )
        }
    )
    def get(
        self, request: Request, report_id: int, format: str | None = None
    ) -> HttpResponse:
        report = _report(report_id)
        response = HttpResponse(
            json.dumps(report.event, indent=2, sort_keys=True),
            content_type="application/json",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="librephotos-error-report-{report.id}.json"'
        )
        return response


class BrowserErrorReportView(APIView):
    """The web app's errors, scrubbed and saved like the server's own.

    Any signed-in user's browser forwards here, so the admins also see the
    errors other users run into. Rate limited per user, and an envelope over
    200,000 characters is a 400.
    """

    permission_classes = (IsAuthenticated,)
    throttle_classes = (BrowserErrorReportRateThrottle,)

    @extend_schema(
        request=BrowserErrorReportRequest, responses=BrowserErrorReportSerializer
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        envelope = parse_body(request, BrowserErrorReportRequest)["envelope"]
        try:
            reports = ingest_browser_envelope(envelope.encode())
        except InvalidEnvelopeError as error:
            raise ValidationError(
                {"envelope": [str(error)]}, code="invalid_envelope"
            ) from error
        return Response({"saved": len(reports)})
