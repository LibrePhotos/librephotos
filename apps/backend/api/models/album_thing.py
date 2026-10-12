from __future__ import annotations

from collections.abc import Collection, Iterable
from typing import Any

from django.db import models
from django.db.models import Count, QuerySet
from django.db.models.signals import m2m_changed
from django.utils import timezone

from api.models.photo import Photo
from api.models.scopes import SharedOwnedQuerySet
from api.models.user import User, get_deleted_user

# The photos photo_count counts. Not Photo.visible: tags can land before the
# thumbnail, and nothing recounts the album once the thumbnail is there.
COUNTED_PHOTO_FILTER = {"hidden": False, "in_trashcan": False, "removed": False}


def update_default_cover_photo(instance: AlbumThing) -> None:
    current = instance.cover_photos.count()
    if current < 4:
        listed = instance.photos.filter(**COUNTED_PHOTO_FILTER)
        photos_to_add = listed.exclude(
            pk__in=instance.cover_photos.values_list("pk", flat=True)
        )[: 4 - current]
        instance.cover_photos.add(*photos_to_add)


class AlbumThingQuerySet(SharedOwnedQuerySet["AlbumThing"]):
    """Scoped to its owner through ``owner``."""


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

    objects = AlbumThingQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["title", "thing_type", "owner"], name="unique AlbumThing"
            )
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        super().save(*args, **kwargs)

    def update_default_cover_photo(self) -> None:
        update_default_cover_photo(self)

    def __str__(self) -> str:
        return f"{self.id or 0}: {self.title}"


def update_album_thing_photo_count(
    sender: type[models.Model],
    instance: AlbumThing | Photo,
    action: str,
    reverse: bool,
    model: type[models.Model],
    pk_set: set[int] | None,
    **kwargs: Any,
) -> None:
    if action not in ("post_add", "post_remove"):
        return
    # From photo.albumthing_set the instance is the Photo and pk_set holds the
    # albums.
    albums: Iterable[AlbumThing] = (
        [instance]
        if isinstance(instance, AlbumThing)
        else AlbumThing.objects.filter(pk__in=pk_set or [])
    )
    for album in albums:
        album.photo_count = album.photos.filter(**COUNTED_PHOTO_FILTER).count()
        album.save(update_fields=["photo_count"])
        album.update_default_cover_photo()


def register() -> None:
    m2m_changed.connect(
        update_album_thing_photo_count,
        sender=AlbumThing.photos.through,
        dispatch_uid="api.models.album_thing.update_album_thing_photo_count",
    )


def album_thing_ids_for_photos(photos: QuerySet[Photo]) -> list[int]:
    """The ids of every thing album holding one of ``photos``.

    Taken before the photos change, like ``tag_ids_for_photos``.
    """
    return list(
        AlbumThing.objects.filter(photos__in=photos)
        .values_list("pk", flat=True)
        .distinct()
    )


def refresh_album_thing_photo_counts(album_ids: Collection[int]) -> int:
    """Recompute ``photo_count`` for ``album_ids``.

    The receiver above runs only when photos join or leave the album, not when
    one is hidden, trashed or restored by a queryset UPDATE. The counts come
    from one grouped query: a correlated count per album, as tags use, took
    about 0.3 s per album on a 250k-photo library.
    """
    if not album_ids:
        return 0

    grouped = (
        AlbumThing.photos.through.objects.filter(
            albumthing_id__in=album_ids,
            **{
                f"photo__{field}": value
                for field, value in COUNTED_PHOTO_FILTER.items()
            },
        )
        .values("albumthing_id")
        .annotate(total=Count("pk"))
    )
    counts = {row["albumthing_id"]: row["total"] for row in grouped}
    albums = list(AlbumThing.objects.filter(pk__in=album_ids).only("pk"))
    # bulk_update skips auto_now; the mobile sync mirrors photo_count by
    # last_modified, so it is bumped by hand.
    now = timezone.now()
    for album in albums:
        album.photo_count = counts.get(album.pk, 0)
        album.last_modified = now
    AlbumThing.objects.bulk_update(albums, ["photo_count", "last_modified"])
    return len(albums)


def set_photo_album_things(
    photo: Photo, titles: Iterable[str], thing_type: str
) -> None:
    """File *photo* under exactly the thing albums *titles* of *thing_type*.

    The state removing it from each of its albums of that type and adding it to
    each title's album through the related managers left (the receivers above,
    the delta-sync bumps), in a fixed number of queries: memberships through
    the through table, one grouped recount, covers only where fewer than four.
    The manager path cost ~12 queries per tag, a COUNT over the whole album
    among them, ~0.6 s per photo on a 50k library (the Rust experiment batched
    the same writes).
    """
    through = AlbumThing.photos.through
    owner_id = photo.owner_id
    titles = list(dict.fromkeys(titles))
    current = set(
        through.objects.filter(
            photo_id=photo.pk,
            albumthing__owner_id=owner_id,
            albumthing__thing_type=thing_type,
        ).values_list("albumthing_id", flat=True)
    )
    album_ids = dict(
        AlbumThing.objects.filter(
            owner_id=owner_id, thing_type=thing_type, title__in=titles
        ).values_list("title", "pk")
    )
    missing = [title for title in titles if title not in album_ids]
    if missing:
        # ignore_conflicts: a concurrent tagging task may create the same one.
        AlbumThing.objects.bulk_create(
            [
                AlbumThing(title=title, owner_id=owner_id, thing_type=thing_type)
                for title in missing
            ],
            ignore_conflicts=True,
        )
        album_ids.update(
            AlbumThing.objects.filter(
                owner_id=owner_id, thing_type=thing_type, title__in=missing
            ).values_list("title", "pk")
        )
    wanted = {album_ids[title] for title in titles}

    gone = current - wanted
    if gone:
        through.objects.filter(photo_id=photo.pk, albumthing_id__in=gone).delete()
    added = wanted - current
    if added:
        through.objects.bulk_create(
            [through(albumthing_id=pk, photo_id=photo.pk) for pk in added],
            ignore_conflicts=True,
        )

    # Every album the photo was in or is now in, as the manager path saved
    # each of them: count, last_modified, and covers for those short of four.
    touched = current | wanted
    refresh_album_thing_photo_counts(list(touched))
    covers_grouped = (
        AlbumThing.cover_photos.through.objects.filter(albumthing_id__in=touched)
        .values("albumthing_id")
        .annotate(total=Count("pk"))
    )
    covers = {row["albumthing_id"]: row["total"] for row in covers_grouped}
    short = [pk for pk in touched if covers.get(pk, 0) < 4]
    for album in AlbumThing.objects.filter(pk__in=short):
        update_default_cover_photo(album)


def get_album_thing(
    title: str, owner: User, thing_type: str | None = None
) -> AlbumThing:
    return AlbumThing.objects.get_or_create(
        title=title, owner=owner, thing_type=thing_type
    )[0]
