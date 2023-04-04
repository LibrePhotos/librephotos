from django.db import models

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumUser(models.Model):
    title = models.CharField(max_length=512)
    created_on = models.DateTimeField(auto_now=True, db_index=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    cover_photo = models.ForeignKey(
        Photo,
        related_name="album_user",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )

    shared_to = models.ManyToManyField(User, related_name="album_user_shared_to")

    public = models.BooleanField(default=False, db_index=True)

    class Meta:
        unique_together = ("title", "owner")
