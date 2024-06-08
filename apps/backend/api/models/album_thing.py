from django.db import models
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


def update_default_cover_photo(instance):
    if instance.cover_photos.count() < 4:
        photos_to_add = instance.photos.filter(hidden=False)[
            : 4 - instance.cover_photos.count()
        ]
        instance.cover_photos.add(*photos_to_add)


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
    photo_count = models.IntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["title", "thing_type", "owner"], name="unique AlbumThing"
            )
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)

    def update_default_cover_photo(self):
        update_default_cover_photo(self)

    def __str__(self):
        return "%d: %s" % (self.id or 0, self.title)


@receiver(m2m_changed, sender=AlbumThing.photos.through)
def update_photo_count(sender, instance, action, reverse, model, pk_set, **kwargs):
    if action == "post_add" or (action == "post_remove" and not reverse):
        count = instance.photos.filter(hidden=False).count()
        instance.photo_count = count
        instance.save(update_fields=["photo_count"])
        instance.update_default_cover_photo()


def get_album_thing(title, owner, thing_type=None):
    return AlbumThing.objects.get_or_create(
        title=title, owner=owner, thing_type=thing_type
    )[0]
