"""What deleting a user does before the ``deleted`` account takes over.

Every owner FK is SET(get_deleted_user), so a deleted user's photos, albums
and tags go to the disabled ``deleted`` account, which nobody can sign in as.
A ``pre_delete`` receiver gets them ready for that, so it happens however the
user is deleted: the Admin Area, the Django admin (one user or "delete
selected") or ``user.delete()`` in a shell. It runs in the delete's own
transaction, so a delete that fails leaves everything as it was.

Registered from :meth:`api.apps.ApiConfig.ready`.
"""

from typing import Any, TypeAlias

from django.db.models.signals import pre_delete
from django.utils import timezone

from api.jobs.upload_import import seal_upload_imports
from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    AlbumUserShare,
    LongRunningJob,
    Photo,
    PhotoShare,
    Tag,
    User,
)
from api.models.user import get_deleted_user

# The models of GENERATED_ALBUMS plus the two that are handed over with them.
OwnedRowModel: TypeAlias = (
    type[AlbumAuto]
    | type[AlbumDate]
    | type[AlbumPlace]
    | type[AlbumThing]
    | type[AlbumUser]
    | type[Tag]
)

# Unique per owner: the second user deleted with, say, an album for a day the
# first one also had collided with the row ``deleted`` already held, and the
# whole delete failed.
GENERATED_ALBUMS = (
    (AlbumAuto, ("timestamp",)),
    (AlbumDate, ("date",)),
    (AlbumPlace, ("title",)),
    (AlbumThing, ("title", "thing_type")),
)
# Photos are linked in batches, as in TagViewSet: one statement for all of a
# large tag's photos can pass the bind-parameter limit.
MERGE_BATCH_SIZE = 2000


def _colliding(
    model: OwnedRowModel,
    fields: tuple[str, ...],
    user: User,
    deleted_user: User,
) -> list[tuple[Any, Any]]:
    """``(pk, held_pk)`` for each of ``user``'s rows whose key ``deleted_user`` holds.

    A key with a null part never collides, as in the database.
    """
    held = {
        row[:-1]: row[-1]
        for row in model.objects.filter(owner=deleted_user).values_list(*fields, "pk")
    }
    return [
        (row[-1], held[row[:-1]])
        for row in model.objects.filter(owner=user).values_list(*fields, "pk")
        if None not in row[:-1] and row[:-1] in held
    ]


def _free_album_title(title: str, user: User, deleted_user: User) -> str:
    """``title`` with the owner's name added, free for both accounts."""
    max_length = AlbumUser._meta.get_field("title").max_length
    # AlbumUser.title is declared with a max_length, so the field always has one.
    assert max_length is not None
    n = 1
    while True:
        suffix = f" ({user.username})" if n == 1 else f" ({user.username} {n})"
        candidate = title[: max_length - len(suffix)] + suffix
        if not AlbumUser.objects.filter(
            owner__in=(user, deleted_user), title=candidate
        ).exists():
            return candidate
        n += 1


def _hand_over_unique_rows(user: User, deleted_user: User) -> None:
    """Give ``deleted_user`` the rows of ``user`` that are unique per owner.

    Merging two albums would show either user's photos to whoever the other
    album is shared with, or through its public link. So where
    ``deleted_user`` already holds the same key, a generated album is dropped
    (its photos stay in the library) and a user album is kept apart under a
    title naming its owner. Tags are not shared and the same name is the same
    keyword, so a tag is merged into the one already there.

    The rows move here rather than in the delete's own update: users deleted
    together ("delete selected") would collide with each other there.
    """
    for model, fields in GENERATED_ALBUMS:
        pks = [pk for pk, _ in _colliding(model, fields, user, deleted_user)]
        model.objects.filter(pk__in=pks).delete()
    for pk, _ in _colliding(AlbumUser, ("title",), user, deleted_user):
        album = AlbumUser.objects.get(pk=pk)
        album.title = _free_album_title(album.title, user, deleted_user)
        # last_modified too: people it is shared with sync the new title.
        album.save(update_fields=["title", "last_modified"])
    for pk, held_pk in _colliding(Tag, ("name",), user, deleted_user):
        source = Tag.objects.get(pk=pk)
        target = Tag.objects.get(pk=held_pk)
        # Whole rows, reduced to the id: add() takes the photo instances.
        photos = list(source.photos.only("id"))
        for start in range(0, len(photos), MERGE_BATCH_SIZE):
            target.photos.add(*photos[start : start + MERGE_BATCH_SIZE])
        source.delete()
    for owned_model in (*(model for model, _ in GENERATED_ALBUMS), AlbumUser, Tag):
        owned_model.objects.filter(owner=user).update(owner=deleted_user)


def _turn_off_public_links(user: User) -> None:
    """Turn off all of ``user``'s photos and albums that open without an account.

    Nobody can sign in as ``deleted``, so a link left on could never be turned
    off again. Slugs are dropped as on a revoke (issue #76). Shares with other
    users of the instance are kept. The account's own flags
    (``public_sharing``) go with its row.
    """
    photos = Photo.objects.owned_by(user)
    AlbumUserShare.objects.filter(album__owner=user).update(enabled=False, slug=None)
    PhotoShare.objects.filter(photo__in=photos).update(enabled=False, slug=None)
    # last_modified: synced clients show whether a photo is public.
    photos.filter(public=True).update(public=False, last_modified=timezone.now())


def _drop_others_photos_from_albums(user: User) -> None:
    """Take the photos ``user`` does not own out of ``user``'s albums.

    An album only vouches for its owner's photos (GHSA-phvg-g65q-rhq3,
    ``_vouching_albums`` in api/views/media.py). Once the photo's owner is
    deleted too, before or after, ``deleted`` owns both and the album would
    vouch for it: the people it is shared with would see a photo that was
    never shared with them. They could not open it through the album before,
    so nobody loses anything.
    """
    memberships = AlbumUser.photos.through.objects.filter(
        albumuser__owner=user
    ).exclude(photo__owner=user)
    album_pks = set(memberships.values_list("albumuser_id", flat=True))
    memberships.delete()
    # last_modified: a through-table delete fires no m2m_changed, and synced
    # clients should drop the photos and the cover too.
    now = timezone.now()
    albums = AlbumUser.objects.filter(owner=user)
    albums.exclude(cover_photo=None).exclude(cover_photo__owner=user).update(
        cover_photo=None, last_modified=now
    )
    albums.filter(pk__in=album_pks).update(last_modified=now)


def _seal_upload_imports(user: User) -> None:
    """Close ``user``'s open upload import job before ``deleted`` takes it.

    One open import job per user (``lrj_one_open_upload_import``): a second
    deleted user's open job would collide with the first one's.
    """
    seal_upload_imports(LongRunningJob.objects.owned_by(user))


def prepare_user_deletion(sender: type[User], instance: User, **kwargs: Any) -> None:
    # Not the placeholder itself: its rows would be handed to itself.
    if instance.username == "deleted":
        return
    _seal_upload_imports(instance)
    _turn_off_public_links(instance)
    _drop_others_photos_from_albums(instance)
    _hand_over_unique_rows(instance, get_deleted_user())


def register() -> None:
    pre_delete.connect(
        prepare_user_deletion,
        sender=User,
        dispatch_uid="api.accounts.deletion.prepare_user_deletion",
    )
