from datetime import datetime

from api.models.user import User, get_deleted_user
from django.contrib.postgres.fields import JSONField
from django.db import models


def get_default_longrunningjob_result():
    return {'progress': {'target': 0, 'current': 0}}

class LongRunningJob(models.Model):
    JOB_SCAN_PHOTOS = 1
    JOB_GENERATE_AUTO_ALBUMS = 2
    JOB_GENERATE_AUTO_ALBUM_TITLES = 3
    JOB_TRAIN_FACES = 4
    JOB_TYPES = (
        (JOB_SCAN_PHOTOS, "Scan Photos"),
        (JOB_GENERATE_AUTO_ALBUMS, "Generate Event Albums"),
        (JOB_GENERATE_AUTO_ALBUM_TITLES, "Regenerate Event Titles"),
        (JOB_TRAIN_FACES, "Train Faces"),
    )

    job_type = models.PositiveIntegerField(choices=JOB_TYPES, )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
    job_id = models.CharField(max_length=36, unique=True, db_index=True)
    queued_at = models.DateTimeField(default=datetime.now, null=False)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    result = JSONField(
        default=get_default_longrunningjob_result, blank=False, null=False)
    started_by = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)


