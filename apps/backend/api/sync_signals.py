"""Delta-sync bookkeeping signals (mobile v2, doc 04).

Two jobs:

1. **Bump ``last_modified`` on the parent row** when an M2M relation changes.
   Django's M2M writes never touch the parent's ``last_modified``, so album
   membership and sharing edits would otherwise be invisible to the delta feed.

2. **Write tombstones** (:class:`~api.models.deletion_log.DeletionLog`) for
   events that leave no ``last_modified`` trace a client can follow:
   hard deletes (``post_delete``) and visibility losses (un-sharing).

Registered from :meth:`api.apps.ApiConfig.ready` so every model is loaded first.

Note: ``SetPhotosShared`` manipulates the ``Photo.shared_to`` through table
directly (``bulk_create``/queryset ``delete``), which fires **no** m2m_changed
signal, so that endpoint writes its own tombstones/bumps explicitly. The
``Photo.shared_to`` receiver here still covers any code path that goes through
the related manager (``photo.shared_to.add(...)``).
"""

import uuid
from collections.abc import Callable, Collection, Iterable
from typing import Any

from django.db import models
from django.db.models.signals import m2m_changed, post_delete, pre_delete
from django.utils import timezone

from api.models.album_auto import AlbumAuto
from api.models.album_place import AlbumPlace
from api.models.album_thing import AlbumThing
from api.models.album_user import AlbumUser
from api.models.deletion_log import DeletionLog
from api.models.person import Person
from api.models.photo import Photo
from api.models.tag import Tag

# The albums and the tag whose membership and sharing the delta feed follows.
SyncedParent = (
    type[AlbumUser] | type[AlbumAuto] | type[AlbumThing] | type[AlbumPlace] | type[Tag]
)
# The pk set Django hands to an m2m_changed receiver. Which model it holds
# depends on the direction of the change: user ids for a share, album ids for
# the reverse, photo uuids for Photo.shared_to in reverse.
PkSet = Collection[Any] | None


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _bump(instance: models.Model) -> None:
    """Touch ``last_modified`` on a saved instance without side effects."""
    if instance.pk is None:
        return
    instance.save(update_fields=["last_modified"])


def _viewer_ids(instance: models.Model) -> list[object]:
    """The ids of the users an album or photo is shared with right now.

    Raises AttributeError for a model without ``shared_to``; _capture_viewers
    depends on that to skip the models that are not shared.
    """
    return list(getattr(instance, "shared_to").values_list("id", flat=True))


def _bump_photo_ids(photo_ids: Iterable[uuid.UUID | None]) -> None:
    """Bump photos via a queryset update.

    ``Photo.save`` runs metadata-diff/write side effects, so a plain
    ``.update()`` (which bypasses ``auto_now``) with an explicit timestamp is
    both cheaper and safer for a bare ordering bump.
    """
    ids = [pk for pk in photo_ids if pk is not None]
    if ids:
        Photo.objects.filter(pk__in=ids).update(last_modified=timezone.now())


def _bump_parents(
    parent_model: SyncedParent,
    instance: models.Model,
    related_model: type[models.Model],
    pk_set: PkSet,
    reverse: bool,
) -> None:
    """Bump the *parent* (synced) side of an M2M change, in either direction."""
    if not reverse:
        _bump(instance)
    else:
        for obj in parent_model.objects.filter(pk__in=list(pk_set or [])):
            _bump(obj)


def _write_tombstones(entity: str, entity_id: object, owner_ids: Iterable[int]) -> None:
    """Create one tombstone per viewer, skipping users that no longer exist."""
    from api.models.user import User

    existing = set(
        User.objects.filter(id__in=list(owner_ids)).values_list("id", flat=True)
    )
    for owner_id in existing:
        DeletionLog.objects.create(
            entity=entity, entity_id=str(entity_id), owner_id=owner_id
        )


def clear_tombstones(
    entity: str, entity_ids: Iterable[object], owner_ids: Iterable[int]
) -> None:
    """Cancel tombstones for rows that just became visible again.

    A row can be resurrected in a viewer's mirror (re-sharing a previously
    un-shared photo/album). Without cancelling the earlier tombstone, a pull
    whose cursor predates the un-share would re-deliver the stale tombstone and
    shadow the fresh row. Deleting the tombstone on (re-)share keeps the
    item-vs-tombstone resolution unambiguous regardless of client apply order.
    """
    ids = [str(i) for i in entity_ids]
    owners = list(owner_ids)
    if ids and owners:
        DeletionLog.objects.filter(
            entity=entity, entity_id__in=ids, owner_id__in=owners
        ).delete()


# --------------------------------------------------------------------------- #
# M2M: photos membership -> bump parent
# --------------------------------------------------------------------------- #
_PHOTO_MEMBERSHIP_PARENTS: dict[SyncedParent, type[models.Model]] = {
    AlbumUser: AlbumUser.photos.through,
    AlbumAuto: AlbumAuto.photos.through,
    AlbumThing: AlbumThing.photos.through,
    AlbumPlace: AlbumPlace.photos.through,
    Tag: Tag.photos.through,
}


def _make_photos_bump(parent_model: SyncedParent) -> Callable[..., None]:
    def handler(
        sender: type[models.Model],
        instance: models.Model,
        action: str,
        reverse: bool,
        model: type[models.Model],
        pk_set: PkSet,
        **kwargs: Any,
    ) -> None:
        if action in ("post_add", "post_remove", "post_clear"):
            _bump_parents(parent_model, instance, model, pk_set, reverse)

    return handler


# AlbumThing cover_photos edits should also bump (cover_hash changes on client).
def _album_thing_cover_bump(
    sender: type[models.Model],
    instance: models.Model,
    action: str,
    reverse: bool,
    model: type[models.Model],
    pk_set: PkSet,
    **kwargs: Any,
) -> None:
    if action in ("post_add", "post_remove", "post_clear"):
        _bump_parents(AlbumThing, instance, model, pk_set, reverse)


# --------------------------------------------------------------------------- #
# M2M: shared_to -> bump parent (share) + tombstone (un-share)
# --------------------------------------------------------------------------- #
_SHARE_PARENTS: dict[str, tuple[SyncedParent, type[models.Model]]] = {
    DeletionLog.ENTITY_ALBUM_USER: (AlbumUser, AlbumUser.shared_to.through),
    DeletionLog.ENTITY_ALBUM_AUTO: (AlbumAuto, AlbumAuto.shared_to.through),
    DeletionLog.ENTITY_ALBUM_THING: (AlbumThing, AlbumThing.shared_to.through),
    DeletionLog.ENTITY_ALBUM_PLACE: (AlbumPlace, AlbumPlace.shared_to.through),
}


def _share_lost_owner_ids(
    instance: models.Model,
    model: type[models.Model],
    pk_set: PkSet,
    reverse: bool,
) -> list[tuple[object, list[int]]]:
    """(album_pk, [user_id, ...]) pairs that just lost visibility."""
    if not reverse:
        # instance is the album; pk_set are the user ids removed
        return [(instance.pk, list(pk_set or []))]
    # instance is the user removed; pk_set are album ids
    return [(album_pk, [instance.pk]) for album_pk in list(pk_set or [])]


def _make_share_handler(entity: str, parent_model: SyncedParent) -> Callable[..., None]:
    def handler(
        sender: type[models.Model],
        instance: models.Model,
        action: str,
        reverse: bool,
        model: type[models.Model],
        pk_set: PkSet,
        **kwargs: Any,
    ) -> None:
        if action == "post_add":
            # Newly shared: bump so the row crosses the shared user's cursor,
            # and cancel any stale tombstone from a previous un-share.
            _bump_parents(parent_model, instance, model, pk_set, reverse)
            for album_pk, user_ids in _share_lost_owner_ids(
                instance, model, pk_set, reverse
            ):
                clear_tombstones(entity, [album_pk], user_ids)
        elif action == "pre_clear" and not reverse:
            # Capture who is about to lose access before the rows vanish.
            setattr(instance, "_sync_cleared_share_ids", _viewer_ids(instance))
        elif action == "post_clear":
            _bump_parents(parent_model, instance, model, pk_set, reverse)
            if not reverse:
                for uid in getattr(instance, "_sync_cleared_share_ids", []):
                    _write_tombstones(entity, instance.pk, [uid])
            # reverse post_clear (user.album_*_shared_to.clear()) is not used
            # by any production path, so no capture is wired for it.
        elif action == "post_remove":
            _bump_parents(parent_model, instance, model, pk_set, reverse)
            for album_pk, user_ids in _share_lost_owner_ids(
                instance, model, pk_set, reverse
            ):
                _write_tombstones(entity, album_pk, user_ids)

    return handler


# --------------------------------------------------------------------------- #
# M2M: Photo.shared_to -> bump (share) + tombstone (un-share)
# --------------------------------------------------------------------------- #
def _photo_share_handler(
    sender: type[models.Model],
    instance: models.Model,
    action: str,
    reverse: bool,
    model: type[models.Model],
    pk_set: PkSet,
    **kwargs: Any,
) -> None:
    if action == "post_add":
        if not reverse:
            _bump_photo_ids([instance.pk])
            clear_tombstones(
                DeletionLog.ENTITY_PHOTO, [instance.pk], list(pk_set or [])
            )
        else:
            _bump_photo_ids(list(pk_set or []))
            for photo_pk in list(pk_set or []):
                clear_tombstones(DeletionLog.ENTITY_PHOTO, [photo_pk], [instance.pk])
    elif action == "pre_clear" and not reverse:
        setattr(instance, "_sync_cleared_share_ids", _viewer_ids(instance))
    elif action == "post_clear":
        if not reverse:
            _bump_photo_ids([instance.pk])
            for uid in getattr(instance, "_sync_cleared_share_ids", []):
                _write_tombstones(DeletionLog.ENTITY_PHOTO, instance.pk, [uid])
    elif action == "post_remove":
        if not reverse:
            _bump_photo_ids([instance.pk])
            _write_tombstones(DeletionLog.ENTITY_PHOTO, instance.pk, list(pk_set or []))
        else:
            _bump_photo_ids(list(pk_set or []))
            for photo_pk in list(pk_set or []):
                _write_tombstones(DeletionLog.ENTITY_PHOTO, photo_pk, [instance.pk])


# --------------------------------------------------------------------------- #
# Hard-delete tombstones
# --------------------------------------------------------------------------- #
def _capture_viewers(
    sender: type[models.Model], instance: models.Model, **kwargs: Any
) -> None:
    """Snapshot shared_to before a delete cascades the through rows away."""
    try:
        setattr(instance, "_sync_viewer_ids", set(_viewer_ids(instance)))
    except Exception:
        setattr(instance, "_sync_viewer_ids", set())


def _make_owned_tombstone(
    entity: str, owner_attr: str = "owner_id", shared: bool = False
) -> Callable[..., None]:
    def handler(
        sender: type[models.Model], instance: models.Model, **kwargs: Any
    ) -> None:
        owner_ids: set[int] = set()
        owner_id = getattr(instance, owner_attr, None)
        if owner_id:
            owner_ids.add(owner_id)
        if shared:
            owner_ids |= getattr(instance, "_sync_viewer_ids", set())
        if owner_ids:
            _write_tombstones(entity, instance.pk, owner_ids)

    return handler


def _person_tombstone(sender: type[Person], instance: Person, **kwargs: Any) -> None:
    # Only USER-kind persons are mirrored (People album grid), so only they
    # need tombstones; cluster/unknown persons churn on every clustering run.
    # Runs on pre_delete: the people list deletes an instance loaded with
    # .only(), and reading the deferred kind after the row is gone raised
    # DoesNotExist. Same transaction as the delete, so a rollback drops it.
    if instance.kind == Person.KIND_USER and instance.cluster_owner_id:
        _write_tombstones(
            DeletionLog.ENTITY_PERSON, instance.pk, [instance.cluster_owner_id]
        )


# --------------------------------------------------------------------------- #
# registration
# --------------------------------------------------------------------------- #
def register() -> None:
    # weak=False for the handlers the factories build: nothing else references
    # those closures, and a weakly held one is collected as soon as connect()
    # returns. Only DEBUG's lru-cached signature check kept them alive, so
    # they worked in the test suite and nowhere else.
    # photos membership bumps
    for parent_model, through in _PHOTO_MEMBERSHIP_PARENTS.items():
        m2m_changed.connect(
            _make_photos_bump(parent_model),
            sender=through,
            weak=False,
            dispatch_uid=f"sync_photos_bump_{parent_model.__name__}",
        )
    m2m_changed.connect(
        _album_thing_cover_bump,
        sender=AlbumThing.cover_photos.through,
        dispatch_uid="sync_album_thing_cover_bump",
    )

    # shared_to bumps + tombstones
    for entity, (parent_model, through) in _SHARE_PARENTS.items():
        m2m_changed.connect(
            _make_share_handler(entity, parent_model),
            sender=through,
            weak=False,
            dispatch_uid=f"sync_share_{entity}",
        )

    # Photo.shared_to
    m2m_changed.connect(
        _photo_share_handler,
        sender=Photo.shared_to.through,
        dispatch_uid="sync_photo_share",
    )

    # hard-delete tombstones
    pre_delete.connect(
        _capture_viewers, sender=Photo, dispatch_uid="sync_capture_photo_viewers"
    )
    post_delete.connect(
        _make_owned_tombstone(DeletionLog.ENTITY_PHOTO, shared=True),
        sender=Photo,
        weak=False,
        dispatch_uid="sync_tombstone_photo",
    )

    for entity, (parent_model, _through) in _SHARE_PARENTS.items():
        pre_delete.connect(
            _capture_viewers,
            sender=parent_model,
            dispatch_uid=f"sync_capture_viewers_{entity}",
        )
        post_delete.connect(
            _make_owned_tombstone(entity, shared=True),
            sender=parent_model,
            weak=False,
            dispatch_uid=f"sync_tombstone_{entity}",
        )

    pre_delete.connect(
        _person_tombstone, sender=Person, dispatch_uid="sync_tombstone_person"
    )
    post_delete.connect(
        _make_owned_tombstone(DeletionLog.ENTITY_TAG),
        sender=Tag,
        weak=False,
        dispatch_uid="sync_tombstone_tag",
    )
