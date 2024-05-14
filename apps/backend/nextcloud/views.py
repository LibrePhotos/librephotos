import uuid
from urllib.parse import urlparse

import owncloud as nextcloud
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.util import logger
from nextcloud.directory_watcher import scan_photos


class ListDir(APIView):
    def get(self, request, format=None):
        if not request.query_params.get("fpath"):
            return Response([])
        path = request.query_params["fpath"]

        if request.user.nextcloud_server_address is None or not valid_url(
            request.user.nextcloud_server_address
        ):
            return Response([])

        nc = nextcloud.Client(request.user.nextcloud_server_address)
        nc.login(request.user.nextcloud_username, request.user.nextcloud_app_password)
        try:
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
        except nextcloud.HTTPResponseError:
            return Response(status=400)


def valid_url(url):
    try:
        urlparse(url)
        return True
    except BaseException:
        return False


class ScanPhotosView(APIView):
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
            job_id = uuid.uuid4()
            AsyncTask(scan_photos, request.user, job_id).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})
