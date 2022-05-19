import uuid

import owncloud as nextcloud
from rest_framework.response import Response
from rest_framework.views import APIView

from api.util import logger
from nextcloud.directory_watcher import scan_photos


class ListDir(APIView):
    def get(self, request, format=None):
        if not request.query_params.get("fpath"):
            return Response(status=400)
        path = request.query_params["fpath"]

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
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})
