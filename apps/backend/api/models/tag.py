from django.db import models
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class Tag(models.Model):
    """A user-defined label attached to photos.

    ``PhotoMetadata.keywords`` stays the source of truth for what a file's
    EXIF/IPTC/XMP says. A Tag is the queryable counterpart: it can be listed,
    renamed, merged and counted without scanning every metadata blob.
    """

    name = models.CharField(max_length=512, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    photos = models.ManyToManyField(Photo, related_name="tags")
    photo_count = models.IntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["name", "owner"], name="unique Tag")
        ]

    def __str__(self):
        return "%d: %s" % (self.id or 0, self.name)


@receiver(m2m_changed, sender=Tag.photos.through)
def update_photo_count(sender, instance, action, reverse, model, pk_set, **kwargs):
    if action not in ("post_add", "post_remove"):
        return
    tags = Tag.objects.filter(pk__in=pk_set or []) if reverse else [instance]
    for tag in tags:
        tag.photo_count = tag.photos.filter(hidden=False).count()
        tag.save(update_fields=["photo_count"])


def get_tag(name, owner):
    return Tag.objects.get_or_create(name=name, owner=owner)[0]


def link_tags_from_keywords(photo, keywords):
    """Create and link a Tag for every keyword found on ``photo``.

    Additive on purpose: a re-scan must not silently drop tags the user added
    by hand, so keywords that disappeared from the file are left alone.
    """
    if photo.owner_id is None:
        return []

    names = {
        keyword.strip()
        for keyword in keywords or []
        if isinstance(keyword, str) and keyword.strip()
    }
    tags = []
    for name in sorted(names):
        tag = get_tag(name, photo.owner)
        tag.photos.add(photo)
        tags.append(tag)
    return tags
