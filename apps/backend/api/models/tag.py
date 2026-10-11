from collections.abc import Collection, Iterable
from typing import Any

from django.db import models
from django.db.models import Count, IntegerField, OuterRef, QuerySet, Subquery
from django.db.models.functions import Coalesce
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from api.models.photo import Photo
from api.models.user import User, get_deleted_user

NAME_MAX_LENGTH = 512

# The photos a tag counts: the same ones its album shows, so the tile's count
# and the gallery behind it cannot disagree. Kept in one place because two
# separate code paths compute the count and a drift between them would be
# invisible until a user noticed the numbers were wrong.
VISIBLE_PHOTO_FILTER = {"hidden": False, "in_trashcan": False, "removed": False}


class Tag(models.Model):
    """A user-defined label attached to photos.

    ``PhotoMetadata.keywords`` stays the source of truth for what a file's
    EXIF/IPTC/XMP says. A Tag is the queryable counterpart: it can be listed,
    renamed, merged and counted without scanning every metadata blob.
    """

    name = models.CharField(max_length=NAME_MAX_LENGTH, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    photos = models.ManyToManyField(Photo, related_name="tags")
    photo_count = models.IntegerField(default=0)
    # Delta-sync ordering key (mobile v2, doc 04).
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["name", "owner"], name="unique Tag")
        ]

    def __str__(self) -> str:
        return "%d: %s" % (self.id or 0, self.name)


@receiver(m2m_changed, sender=Tag.photos.through)
def update_photo_count(
    sender: type[models.Model],
    instance: Tag,
    action: str,
    reverse: bool,
    model: type[models.Model],
    pk_set: set[int] | None,
    **kwargs: Any,
) -> None:
    if action not in ("post_add", "post_remove"):
        return
    tags = Tag.objects.filter(pk__in=pk_set or []) if reverse else [instance]
    for tag in tags:
        tag.photo_count = tag.photos.filter(**VISIBLE_PHOTO_FILTER).count()
        tag.save(update_fields=["photo_count"])


def tag_ids_for_photos(photos: QuerySet[Photo]) -> list[int]:
    """The ids of every tag holding one of ``photos``.

    Snapshot these *before* deleting the photos: the through-rows go with them,
    and afterwards there is nothing left to say which tags were affected.
    """
    return list(
        Tag.objects.filter(photos__in=photos).values_list("pk", flat=True).distinct()
    )


def refresh_tag_photo_counts(tag_ids: Collection[int]) -> int:
    """Recompute ``photo_count`` for ``tag_ids``, in one statement.

    The ``m2m_changed`` receiver above only fires when a photo is attached to
    or detached from a tag. A photo that stops counting some other way --
    trashed, hidden, or deleted outright, where the cascade drops the
    through-row without sending the signal -- used to leave the stored count
    behind, so an emptied tag showed "1 photo" over a placeholder tile.

    Written as a set-based UPDATE rather than a ``save()`` per tag because
    trashing a large selection can touch every tag in the library; this is the
    same reasoning as the batched AlbumThing refresh in ``delete_missing_photos``
    (#1848), which predates this model.
    """
    if not tag_ids:
        return 0

    # Counted from the photo side: the same join and filters as the through
    # table, which the type checker cannot follow through an annotate().
    visible_count = (
        Photo.objects.filter(tags=OuterRef("pk"), **VISIBLE_PHOTO_FILTER)
        .order_by()
        .values("tags")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Tag.objects.filter(pk__in=tag_ids).update(
        photo_count=Coalesce(Subquery(visible_count, output_field=IntegerField()), 0)
    )


def get_tag(name: str, owner: User) -> Tag:
    return Tag.objects.get_or_create(name=name, owner=owner)[0]


def tag_names(keywords: Iterable[object] | None) -> set[str]:
    """The tag names a keyword list stands for: trimmed, deduped and clipped.

    ``PhotoMetadata.keywords`` is an unbounded JSON blob while a tag name is a
    ``varchar(512)``, so an over-long keyword has to be cut down instead of
    taking the whole import down with a DataError.
    """
    return {
        keyword.strip()[:NAME_MAX_LENGTH]
        for keyword in keywords or []
        if isinstance(keyword, str) and keyword.strip()
    }


def link_tags_from_keywords(
    photo: Photo, keywords: Iterable[object] | None
) -> list[Tag]:
    """Create and link a Tag for every keyword found on ``photo``.

    Additive on purpose: a re-scan must not silently drop tags the user added
    by hand, so keywords that disappeared from the file are left alone. A
    deliberate edit goes through ``sync_tags_from_keywords`` instead.
    """
    if photo.owner_id is None:
        return []

    tags: list[Tag] = []
    for name in sorted(tag_names(keywords)):
        tag = get_tag(name, photo.owner)
        tag.photos.add(photo)
        tags.append(tag)
    return tags


def sync_tags_from_keywords(
    photo: Photo,
    keywords: Iterable[object] | None,
    previous_keywords: Iterable[object] | None,
) -> list[Tag]:
    """Project a deliberate keyword edit onto ``photo``'s tags in both directions.

    A keyword the user just deleted takes the tag it stood for with it,
    otherwise the keyword list and the tag list of the same photo diverge with
    no way to reconcile them from either side. Tags that never came from a
    keyword are left alone, and so is every other photo carrying the tag.
    """
    if photo.owner_id is None:
        return []

    dropped = tag_names(previous_keywords) - tag_names(keywords)
    if dropped:
        for tag in Tag.objects.filter(
            owner_id=photo.owner_id, name__in=dropped, photos=photo
        ):
            tag.photos.remove(photo)
    return link_tags_from_keywords(photo, keywords)
