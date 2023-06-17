from django.db import models

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumPlace(models.Model):
    title = models.CharField(max_length=512, db_index=True)
    photos = models.ManyToManyField(Photo)
    geolocation_level = models.IntegerField(db_index=True, null=True)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="album_place_shared_to")

    class Meta:
        unique_together = ("title", "owner")

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


def get_album_place(title, owner):
    return AlbumPlace.objects.get_or_create(title=title, owner=owner)[0]
