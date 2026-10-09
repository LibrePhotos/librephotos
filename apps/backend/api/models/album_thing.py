from django.db import models
from django.db.models import Count
from django.db.models.signals import m2m_changed
from django.dispatch import receiver
from django.utils import timezone

from api.models.photo import Photo
from api.models.user import User, get_deleted_user

# The photos photo_count counts. Not Photo.visible: tags can land before the
# thumbnail, and nothing recounts the album once the thumbnail is there.
COUNTED_PHOTO_FILTER = {"hidden": False, "in_trashcan": False, "removed": False}


def update_default_cover_photo(instance):
    current = instance.cover_photos.count()
    if current < 4:
        listed = instance.photos.filter(**COUNTED_PHOTO_FILTER)
        photos_to_add = listed.exclude(
            pk__in=instance.cover_photos.values_list("pk", flat=True)
        )[: 4 - current]
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
    # Delta-sync ordering key (mobile v2, doc 04).
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

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
        count = instance.photos.filter(**COUNTED_PHOTO_FILTER).count()
        instance.photo_count = count
        instance.save(update_fields=["photo_count"])
        instance.update_default_cover_photo()


def album_thing_ids_for_photos(photos):
    """The ids of every thing album holding one of ``photos``.

    Taken before the photos change, like ``tag_ids_for_photos``.
    """
    return list(
        AlbumThing.objects.filter(photos__in=photos)
        .values_list("pk", flat=True)
        .distinct()
    )


def refresh_album_thing_photo_counts(album_ids):
    """Recompute ``photo_count`` for ``album_ids``.

    The receiver above runs only when photos join or leave the album, not when
    one is hidden, trashed or restored by a queryset UPDATE. The counts come
    from one grouped query: a correlated count per album, as tags use, took
    about 0.3 s per album on a 250k-photo library.
    """
    if not album_ids:
        return 0

    counts = dict(
        AlbumThing.photos.through.objects.filter(
            albumthing_id__in=album_ids,
            **{
                f"photo__{field}": value
                for field, value in COUNTED_PHOTO_FILTER.items()
            },
        )
        .values("albumthing_id")
        .annotate(total=Count("pk"))
        .values_list("albumthing_id", "total")
    )
    albums = list(AlbumThing.objects.filter(pk__in=album_ids).only("pk"))
    # bulk_update skips auto_now; the mobile sync mirrors photo_count by
    # last_modified, so it is bumped by hand.
    now = timezone.now()
    for album in albums:
        album.photo_count = counts.get(album.pk, 0)
        album.last_modified = now
    AlbumThing.objects.bulk_update(albums, ["photo_count", "last_modified"])
    return len(albums)


def get_album_thing(title, owner, thing_type=None):
    return AlbumThing.objects.get_or_create(
        title=title, owner=owner, thing_type=thing_type
    )[0]
