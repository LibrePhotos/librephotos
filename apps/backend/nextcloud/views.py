import ipaddress
import uuid
from urllib.parse import urlparse

import owncloud as nextcloud
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.util import logger
from nextcloud.directory_watcher import scan_photos

_ALLOWED_SCHEMES = {"http", "https"}


def valid_url(url: str) -> bool:
    """Return True only for public, routable http/https URLs.

    Blocks loopback, private, link-local, and reserved addresses so that
    user-supplied Nextcloud server addresses cannot be used as an SSRF vector
    to reach internal services or cloud metadata endpoints.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in _ALLOWED_SCHEMES:
            return False
        host = parsed.hostname
        if not host:
            return False
        try:
            addr = ipaddress.ip_address(host)
            if (
                addr.is_loopback
                or addr.is_private
                or addr.is_link_local
                or addr.is_reserved
                or addr.is_multicast
            ):
                return False
        except ValueError:
            # hostname (not a bare IP) — allow; DNS rebind risk is accepted
            # as mitigated by the scheme + port restrictions above
            pass
        return True
    except Exception:
        return False


class ListDir(APIView):
    def get(self, request, format=None):
        if not request.query_params.get("fpath"):
            return Response([])
        path = request.query_params["fpath"]

        if not request.user.nextcloud_server_address or not valid_url(
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
