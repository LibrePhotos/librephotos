from django.db import models
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumThing(models.Model):
    title = models.CharField(max_length=512, db_index=True)
    photos = models.ManyToManyField(Photo)
    thing_type = models.CharField(max_length=512, db_index=True, null=True)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="album_thing_shared_to")
    cover_photos = models.ManyToManyField(
        Photo, related_name="album_thing_cover_photos"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["title", "thing_type", "owner"], name="unique AlbumThing"
            )
        ]

    def _set_default_cover_photo(self):
        if self.cover_photos.count() < 4:
            self.cover_photos.add(*self.photos.all()[:4])

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


@receiver(m2m_changed, sender=AlbumThing.photos.through)
def update_default_cover_photo(sender, instance, action, **kwargs):
    if action == "post_add":
        instance._set_default_cover_photo()
        instance.save()


def get_album_thing(title, owner, thing_type=None):
    return AlbumThing.objects.get_or_create(
        title=title, owner=owner, thing_type=thing_type
    )[0]
