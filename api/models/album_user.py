from api.models.photo import Photo
from api.models.user import User, get_deleted_user
from django.core.cache import cache
from django.db import models
from django.db.models.signals import post_delete, post_save


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
