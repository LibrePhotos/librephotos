"""Deleting the files a deleted row leaves behind: face crops and thumbnails.

Moved out of the ``Face`` and ``Thumbnail`` models so the models do no I/O
(#2336). Both receivers defer the delete to ``on_commit``: a rolled-back
delete keeps the files its restored row points at.
"""

from __future__ import annotations

import logging
import os
from functools import partial
from typing import Any

from django.db import models, transaction
from django.db.models.signals import post_delete

from api.models.face import Face
from api.models.photo import Photo
from api.models.thumbnail import Thumbnail, thumbnail_file_paths
from api.sharing.copies import delete_copies

logger = logging.getLogger(__name__)


def delete_thumbnail_files(photo_hash: str) -> None:
    """Remove every thumbnail file named after ``photo_hash``, and the copies
    without metadata made for library shares (#2731)."""
    delete_copies(photo_hash)
    for path in thumbnail_file_paths(photo_hash):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                logger.error("could not remove thumbnail %s", path)


def _remove_face_crop(face_id: int, path: str) -> None:
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        # The face row is gone either way; a crop left behind is only disk.
        logger.warning("Could not remove the crop of deleted face %s", face_id)


def delete_face_crop_file(
    sender: type[Face], instance: Face, using: str, **kwargs: Any
) -> None:
    """Remove a deleted face's crop file once the delete commits.

    Deferred to on_commit, as the thumbnail files are, so a rolled-back delete
    keeps the crop its restored row points at.
    """
    if instance.image:
        transaction.on_commit(
            partial(_remove_face_crop, instance.pk, instance.image.path), using=using
        )


def _delete_orphaned_thumbnail_files(file_names: list[str]) -> None:
    """Delete the thumbnail files of a deleted Thumbnail nothing else uses.

    Thumbnail files are named by ``image_hash`` and are not owned by a single
    row: a removed Photo keeps its image_hash, and a re-added file with the
    same hash reuses the existing files instead of regenerating them. A Photo
    whose Thumbnail row is not saved yet (mid-scan) picks them up too, so any
    remaining Photo with the hash keeps the files, as does any Thumbnail row
    still pointing at one of them.
    """
    if Thumbnail.objects.filter(
        models.Q(thumbnail_big__in=file_names)
        | models.Q(square_thumbnail__in=file_names)
        | models.Q(square_thumbnail_small__in=file_names)
    ).exists():
        return
    photo_hashes = {os.path.splitext(os.path.basename(n))[0] for n in file_names}
    for photo_hash in photo_hashes:
        if not Photo.objects.filter(image_hash=photo_hash).exists():
            # Swallows OSError per file, so an unremovable file never fails
            # the job that deleted the rows.
            delete_thumbnail_files(photo_hash)


def delete_orphaned_thumbnail_files(
    sender: type[Thumbnail], instance: Thumbnail, using: str, **kwargs: Any
) -> None:
    """Remove a deleted Thumbnail's files once nothing else references them.

    Deferred to on_commit so a rolled-back delete keeps its files, and so the
    "still referenced?" check sees the committed state of the whole delete.
    """
    file_names = [
        field_file.name
        for field_file in (
            instance.thumbnail_big,
            instance.square_thumbnail,
            instance.square_thumbnail_small,
        )
        if field_file and field_file.name
    ]
    if file_names:
        transaction.on_commit(
            partial(_delete_orphaned_thumbnail_files, file_names), using=using
        )


def register() -> None:
    post_delete.connect(
        delete_face_crop_file,
        sender=Face,
        dispatch_uid="api.photos.file_cleanup.delete_face_crop_file",
    )
    post_delete.connect(
        delete_orphaned_thumbnail_files,
        sender=Thumbnail,
        dispatch_uid="api.photos.file_cleanup.delete_orphaned_thumbnail_files",
    )
