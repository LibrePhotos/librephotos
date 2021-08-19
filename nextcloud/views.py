import datetime
import uuid

import owncloud as nextcloud
from django.shortcuts import render
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import get_current_job
from api.models import *
from api.util import logger
from nextcloud.directory_watcher import scan_photos


class ListDir(APIView):
    def get(self, request, format=None):
        path = request.query_params["path"]

        if request.user.nextcloud_server_address is None:
            return Response(status=400)

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


# long running jobs


class ScanPhotosView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_photos(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.exception("An Error occured")
            return Response({"status": False})
