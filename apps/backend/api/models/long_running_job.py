from datetime import datetime

from django.db import models

from api.models.user import User, get_deleted_user


class LongRunningJob(models.Model):
    JOB_SCAN_PHOTOS = 1
    JOB_GENERATE_AUTO_ALBUMS = 2
    JOB_GENERATE_AUTO_ALBUM_TITLES = 3
    JOB_TRAIN_FACES = 4
    JOB_DELETE_MISSING_PHOTOS = 5
    JOB_CALCULATE_CLIP_EMBEDDINGS = 6
    JOB_SCAN_FACES = 7
    JOB_CLUSTER_ALL_FACES = 8
    JOB_DOWNLOAD_PHOTOS = 9
    JOB_DOWNLOAD_MODELS = 10
    JOB_ADD_GEOLOCATION = 11
    JOB_GENERATE_TAGS = 12
    JOB_GENERATE_FACE_EMBEDDINGS = 13
    JOB_SCAN_MISSING_PHOTOS = 14

    JOB_TYPES = (
        (JOB_SCAN_PHOTOS, "Scan Photos"),
        (JOB_GENERATE_AUTO_ALBUMS, "Generate Event Albums"),
        (JOB_GENERATE_AUTO_ALBUM_TITLES, "Regenerate Event Titles"),
        (JOB_TRAIN_FACES, "Train Faces"),
        (JOB_DELETE_MISSING_PHOTOS, "Delete Missing Photos"),
        (JOB_SCAN_FACES, "Scan Faces"),
        (JOB_CALCULATE_CLIP_EMBEDDINGS, "Calculate Clip Embeddings"),
        (JOB_CLUSTER_ALL_FACES, "Find Similar Faces"),
        (JOB_DOWNLOAD_PHOTOS, "Download Selected Photos"),
        (JOB_DOWNLOAD_MODELS, "Download Models"),
        (JOB_ADD_GEOLOCATION, "Add Geolocation"),
        (JOB_GENERATE_TAGS, "Generate Tags"),
        (JOB_GENERATE_FACE_EMBEDDINGS, "Generate Face Embeddings"),
        (JOB_SCAN_MISSING_PHOTOS, "Scan Missing Photos"),
    )

    job_type = models.PositiveIntegerField(
        choices=JOB_TYPES,
    )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
    job_id = models.CharField(max_length=36, unique=True, db_index=True)
    queued_at = models.DateTimeField(default=datetime.now, null=False)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    started_by = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    progress_current = models.PositiveIntegerField(default=0)
    progress_target = models.PositiveIntegerField(default=0)
