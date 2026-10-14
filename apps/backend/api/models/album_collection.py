from django.db import models
from django.db.models.functions import Lower

from api.models.album_user import AlbumUser
from api.models.scopes import OwnedQuerySet
from api.models.user import User

NAME_MAX_LENGTH = 128


class AlbumCollectionQuerySet(OwnedQuerySet["AlbumCollection"]):
    """Scoped to its owner through ``owner``."""


class AlbumCollection(models.Model):
    """A user's own grouping of their albums (#1009, #871): "Travel", "Family".

    Many-to-many: an album can be in several collections and stays an album
    of its own; deleting a collection keeps its albums. Only the owner's
    albums go in, and nobody else sees a collection, also not the people an
    album in it is shared with. Not a ``Tag``: that word is the user's photo
    label (``apps/docs/docs/development/glossary.md``).
    """

    name = models.CharField(max_length=NAME_MAX_LENGTH)
    # Private organisation: it goes with its owner rather than to ``deleted``.
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    albums = models.ManyToManyField(AlbumUser, related_name="collections", blank=True)
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = AlbumCollectionQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "owner", name="unique_album_collection_name"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id or 0}: {self.name}"
