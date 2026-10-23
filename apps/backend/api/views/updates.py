"""Whether a newer release is out, for admins (#2311): ``api.updates.check``;
and the Windows app's built-in updater (#2788): ``api.updates.install``.

Admins only: the version a server runs tells anyone scanning for unpatched
instances what to try, and only an admin can update. The status is the stored
result of the daily check; nothing here asks GitHub. Installing downloads
the newest release from GitHub's release page of LibrePhotos/librephotos.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Conflict
from api.drf.params import parse_body
from api.serializers.updates import (
    InstallUpdateRequest,
    RestartToUpdateRequest,
    SkipReleaseRequest,
    UpdateStatusSerializer,
)
from api.updates.check import skip_release, snooze_notice, update_status
from api.updates.install import Installer, InstallError, installer, running_job

# What a refused install or restart says, by InstallError code.
INSTALL_ERRORS = {
    "update_in_progress": "Another release is being downloaded.",
    "update_not_ready": "The update has not been downloaded yet.",
    "restart_failed": "LibrePhotos could not start the new release.",
}


def _status_response(code: int = status.HTTP_200_OK) -> Response:
    return Response(UpdateStatusSerializer(update_status()).data, status=code)


def _updater() -> Installer:
    current = installer()
    if current is None:
        raise Conflict(
            "This LibrePhotos cannot update itself; follow the update steps in"
            " the documentation.",
            code="not_supported",
        )
    return current


def _refused(error: InstallError) -> Conflict:
    return Conflict(INSTALL_ERRORS.get(error.code, error.code), code=error.code)


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


class InstallUpdateView(APIView):
    """**Download update** in the Windows app: download the newest release in
    the background, check its SHA-256 against the release's SHA256SUMS and
    unpack it next to the program folder. ``install`` in the answer, and in
    ``GET /api/updates/``, follows it. 409 ``not_supported`` elsewhere."""

    permission_classes = (IsAdminUser,)

    @extend_schema(
        request=InstallUpdateRequest,
        responses={status.HTTP_202_ACCEPTED: UpdateStatusSerializer},
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        version = parse_body(request, InstallUpdateRequest)["version"]
        updater = _updater()
        current = update_status()
        if not current["update_available"] or current["latest"] != version:
            raise Conflict(
                "That release is not the newest one for this LibrePhotos.",
                code="not_the_newest_release",
            )
        try:
            updater.start(version)
        except InstallError as error:
            raise _refused(error) from error
        return _status_response(status.HTTP_202_ACCEPTED)


class RestartToUpdateView(APIView):
    """**Restart to update** in the Windows app, once the update is ready:
    LibrePhotos quits, and the new release replaces the program folder and
    starts (the old one stays as ``librephotos-old``). 409 ``job_running``
    while a job runs, unless ``force``."""

    permission_classes = (IsAdminUser,)

    @extend_schema(
        request=RestartToUpdateRequest,
        responses={status.HTTP_202_ACCEPTED: UpdateStatusSerializer},
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        force = parse_body(request, RestartToUpdateRequest)["force"]
        updater = _updater()
        job = None if force else running_job()
        if job is not None:
            raise Conflict(
                f"A job is running ({job}). Restarting stops it.", code="job_running"
            )
        try:
            updater.restart()
        except InstallError as error:
            raise _refused(error) from error
        return _status_response(status.HTTP_202_ACCEPTED)
