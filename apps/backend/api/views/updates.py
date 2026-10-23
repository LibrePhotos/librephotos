"""Whether a newer release is out, for admins (#2311): ``api.updates.check``.

Admins only: the version a server runs tells anyone scanning for unpatched
instances what to try, and only an admin can update. The answer is the stored
result of the daily check; nothing here asks GitHub.
"""

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.serializers.updates import SkipReleaseRequest, UpdateStatusSerializer
from api.updates.check import skip_release, snooze_notice, update_status


def _status_response() -> Response:
    return Response(UpdateStatusSerializer(update_status()).data)


class UpdateStatusView(APIView):
    """The newest release the last check found, and what to do about it."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=UpdateStatusSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return _status_response()


class SkipReleaseView(APIView):
    """**Skip this release**: no card, dot or tray notification for it; an
    empty version undoes it."""

    permission_classes = (IsAdminUser,)

    @extend_schema(request=SkipReleaseRequest, responses=UpdateStatusSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        skip_release(parse_body(request, SkipReleaseRequest)["version"])
        return _status_response()


class SnoozeUpdateNoticeView(APIView):
    """Closing the Update available card: it comes back in a week."""

    permission_classes = (IsAdminUser,)

    @extend_schema(request=None, responses=UpdateStatusSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        snooze_notice()
        return _status_response()
