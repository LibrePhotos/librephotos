from datetime import datetime
from django.db import models
from django.db.models import Prefetch
import api.util as util
from api.models.photo import Photo
from api.models.user import User, get_deleted_user
from collections import Counter
from django.db.models.signals import post_save, post_delete
from django.core.cache import cache

class AlbumUser(models.Model):
    title = models.CharField(max_length=512)
    created_on = models.DateTimeField(auto_now=True, db_index=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_user_shared_to')

    public = models.BooleanField(default=False, db_index=True)

    class Meta:
        unique_together = ('title', 'owner')

    @property
    def cover_photos(self):
        return self.photos.filter(hidden=False)[:4]