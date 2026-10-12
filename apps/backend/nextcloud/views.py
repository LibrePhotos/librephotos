import logging

import owncloud as nextcloud
import requests
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsNextcloudEnabled
from api.request_user import request_user
from api.views.scan_triggers import start_job
from nextcloud.directory_watcher import scan_photos
from nextcloud.server_address import (
    UnsafeServerAddress,
    connect,
    validate_server_address,
)

logger = logging.getLogger(__name__)


class ListDir(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    def get(self, request: Request, format: str | None = None) -> Response:
        if not request.query_params.get("fpath"):
            return Response([])
        path = request.query_params["fpath"]

        user = request_user(request)
        if not user.nextcloud_server_address:
            return Response([])

        # Logging in has to happen inside the try as well: it is the call
        # nextcloud answers with an HTTP error when the app password is wrong,
        # and it is the first one to fail when the server is unreachable.
        try:
            nc = connect(user)
            return Response(
                [
                    {
                        "absolute_path": p.path,
                        "title": p.path.split("/")[-2],
                        "children": [],
                    }
                    for p in nc.list(path)
                    if p.is_dir()
                ]
            )
        except UnsafeServerAddress as e:
            raise ValidationError(str(e)) from e
        except nextcloud.ResponseError as e:
            logger.warning(f"Nextcloud responded with an error: {e}")
            raise ValidationError(str(e)) from e
        except requests.exceptions.RequestException as e:
            logger.warning(f"Could not reach the nextcloud server: {e}")
            raise ValidationError(
                "Could not reach the nextcloud server. Check the server address."
            ) from e


class ScanPhotosView(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        try:
            validate_server_address(user.nextcloud_server_address)
        except UnsafeServerAddress as e:
            raise ValidationError(str(e)) from e
        return start_job(
            lambda job_id: AsyncTask(scan_photos, user, job_id).run(),
            "the Nextcloud scan",
        )
