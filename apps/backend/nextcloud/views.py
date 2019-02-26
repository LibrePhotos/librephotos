from django.shortcuts import render
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny

from api.models import *
import owncloud as nextcloud
from api.api_util import get_current_job
from nextcloud.directory_watcher import scan_photos
from api.util import logger


# Create your views here.
class ListDir(APIView):
    def get(self, request, format=None):
        path = request.query_params['path']

        if request.user.nextcloud_server_address is None:
          return Response(status=400)

        nc = nextcloud.Client(request.user.nextcloud_server_address)
        nc.login(request.user.nextcloud_username,
                 request.user.nextcloud_app_password)
        try:
            return Response([{
                'absolute_path': p.path,
                'title': p.path.split('/')[-2],
                'children': []
            } for p in nc.list(path) if p.is_dir()])
        except nextcloud.HTTPResponseError:
            return Response(status=400)


class ScanPhotosView(APIView):
    def get(self, requests, format=None):
        if get_current_job() is None:
            # The user who triggers the photoscan event owns imported photos
            logger.info(requests.user.username)
            res = scan_photos.delay(requests.user)
            return Response({'status': True, 'job_id': res.id})
        else:
            return Response({
                'status':
                False,
                'message':
                'there are jobs being run',
                'running_jobs':
                [job for job in django_rq.get_queue().get_job_ids()]
            })
