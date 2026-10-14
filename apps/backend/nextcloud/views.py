import logging

import owncloud as nextcloud
import requests
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.accounts.permissions import IsNextcloudEnabled
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.jobs.start import start_job
from api.models import LongRunningJob
from api.serializers.folders import DirTreeSerializer
from api.serializers.job import JobStartedResponseSerializer
from nextcloud.directory_watcher import scan_photos
from nextcloud.serializers import ListDirQuery
from nextcloud.server_address import (
    CABundleError,
    UnsafeServerAddress,
    certificate_check,
    connect,
    validate_server_address,
)

logger = logging.getLogger(__name__)


class ListDir(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    @extend_schema(
        parameters=[ListDirQuery],
        responses=DirTreeSerializer(many=True),
        description="The folders in fpath on the user's Nextcloud, without "
        "their children; [] without a path or a Nextcloud server.",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        path = parse_query(request, ListDirQuery)["fpath"]
        if not path:
            return Response([])

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
        except (UnsafeServerAddress, CABundleError) as e:
            raise ValidationError(str(e)) from e
        except nextcloud.ResponseError as e:
            logger.warning("Nextcloud responded with an error: %s", e)
            raise ValidationError(str(e)) from e
        except requests.exceptions.RequestException as e:
            logger.warning("Could not reach the nextcloud server: %s", e)
            raise ValidationError(
                "Could not reach the nextcloud server. Check the server address."
            ) from e


class ScanPhotosView(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        try:
            validate_server_address(user.nextcloud_server_address)
            certificate_check()
        except (UnsafeServerAddress, CABundleError) as e:
            raise ValidationError(str(e)) from e
        return start_job(
            user,
            LongRunningJob.JOB_SCAN_PHOTOS,
            scan_photos,
            user,
            description="the Nextcloud scan",
        )
