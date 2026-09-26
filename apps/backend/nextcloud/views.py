import owncloud as nextcloud
import requests
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsNextcloudEnabled
from api.util import logger
from api.views.scan_triggers import start_job
from nextcloud.directory_watcher import scan_photos
from nextcloud.server_address import (
    UnsafeServerAddress,
    connect,
    validate_server_address,
)


def _rejected_address(error):
    return Response({"status": False, "message": str(error)}, status=400)


class ListDir(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    def get(self, request, format=None):
        if not request.query_params.get("fpath"):
            return Response([])
        path = request.query_params["fpath"]

        if not request.user.nextcloud_server_address:
            return Response([])

        # Logging in has to happen inside the try as well: it is the call
        # nextcloud answers with an HTTP error when the app password is wrong,
        # and it is the first one to fail when the server is unreachable.
        try:
            nc = connect(request.user)
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
            return _rejected_address(e)
        except nextcloud.ResponseError as e:
            logger.warning(f"Nextcloud responded with an error: {e}")
            return Response({"status": False, "message": str(e)}, status=400)
        except requests.exceptions.RequestException as e:
            logger.warning(f"Could not reach the nextcloud server: {e}")
            return Response(
                {
                    "status": False,
                    "message": "Could not reach the nextcloud server. Check the "
                    "server address.",
                },
                status=400,
            )


class ScanPhotosView(APIView):
    permission_classes = (IsAuthenticated, IsNextcloudEnabled)

    def post(self, request, format=None):
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._scan_photos(request)

    def _scan_photos(self, request):
        try:
            validate_server_address(request.user.nextcloud_server_address)
        except UnsafeServerAddress as e:
            return _rejected_address(e)
        return start_job(
            lambda job_id: AsyncTask(scan_photos, request.user, job_id).run(),
            "the Nextcloud scan",
        )
