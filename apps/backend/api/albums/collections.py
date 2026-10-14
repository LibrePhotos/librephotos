"""Album collections (#1009, #871): which of a user's collections hold an album."""

from collections.abc import Iterable

from django.db import transaction
from django.utils import timezone

from api.models import AlbumCollection, AlbumUser


@transaction.atomic
def set_album_collections(
    album: AlbumUser, collections: Iterable[AlbumCollection]
) -> list[int]:
    """Put ``album`` in exactly ``collections``; answer their ids in order.

    The caller resolves both against the requester (owned album, owned
    collections), so an album never lands in someone else's collection. Each
    collection that gained or lost the album gets a new ``last_modified``.
    """
    wanted = {collection.pk for collection in collections}
    current = set(album.collections.values_list("pk", flat=True))
    album.collections.set(wanted)
    changed = wanted ^ current
    if changed:
        AlbumCollection.objects.filter(pk__in=changed).update(
            last_modified=timezone.now()
        )
    return sorted(wanted)
