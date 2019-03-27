from django.shortcuts import render
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny

from api.models import *
import owncloud as nextcloud
from api.api_util import get_current_job
from nextcloud.directory_watcher import scan_photos
from api.util import logger

import datetime

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


# long running jobs

class ScanPhotosView(APIView):
    def get(self, request, format=None):
        try:
            res = scan_photos.delay(request.user)
            logger.info('queued job {}'.format(res.id))
            if not LongRunningJob.objects.filter(job_id=res.id).exists():
                lrj = LongRunningJob.objects.create(
                    started_by=request.user,
                    job_id=res.id,
                    queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
                    job_type=LongRunningJob.JOB_SCAN_PHOTOS)
                lrj.save()
            return Response({'status': True, 'job_id': res.id})
        except BaseException as e:
            logger.error(str(e))
            return Response({'status': False})

