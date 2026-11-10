"""Rows the mobile delta feed mirrors (``api/views/sync.py``).

The feed sends a row again only when its ``last_modified`` moved past the
phone's cursor, and ``auto_now`` reaches the row only on a full save or a save
that names it: a queryset ``update()``, a ``bulk_update()`` or a
``save(update_fields=[...])`` without it left the phone with the old value for
good. A model the feed sends lists the columns it sends in ``SYNCED_FIELDS``;
any of those three writes that names one of them moves ``last_modified`` too
(``SyncedModel.save``, and ``OwnedQuerySet``, which every synced model's
manager is built from).
A write of other columns only (``ocr_failures``, ``faces_scanned_at``) leaves
it alone, so pipeline bookkeeping does not make every phone pull the row again.
``api/tests/infra/test_sync_feed_writes.py`` fails on a feed column missing
from its model's list.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterable
from typing import Any, ClassVar

from django.core.exceptions import FieldDoesNotExist
from django.db import models
from django.utils import timezone

LAST_MODIFIED = "last_modified"


def _synced_fields(model: type[models.Model]) -> frozenset[str]:
    return getattr(model, "SYNCED_FIELDS", frozenset())


def _names_synced(model: type[models.Model], names: Iterable[str]) -> bool:
    """Whether ``names`` (field names or attnames) include one the feed sends."""
    synced = _synced_fields(model)
    if not synced:
        return False
    for name in names:
        try:
            if model._meta.get_field(name).name in synced:
                return True
        except FieldDoesNotExist:
            continue
    return False


def needs_last_modified(model: type[models.Model], names: Iterable[str]) -> bool:
    """Whether a write of ``names`` to ``model`` has to move ``last_modified``."""
    names = list(names)
    return LAST_MODIFIED not in names and _names_synced(model, names)


def with_last_modified(
    model: type[models.Model], values: dict[str, Any]
) -> dict[str, Any]:
    """The keyword arguments of a queryset ``update()``, bumped if they need it."""
    if needs_last_modified(model, values):
        return {**values, LAST_MODIFIED: timezone.now()}
    return values


def bulk_fields_with_last_modified[M: models.Model](
    model: type[models.Model], objs: Iterable[M], fields: Iterable[str]
) -> tuple[list[M], list[str]]:
    """``bulk_update``'s rows and columns, with a fresh ``last_modified`` if needed."""
    rows, columns = list(objs), list(fields)
    if needs_last_modified(model, columns):
        now = timezone.now()
        for row in rows:
            setattr(row, LAST_MODIFIED, now)
        columns.append(LAST_MODIFIED)
    return rows, columns


class SyncedModel(models.Model):
    """A model the delta feed sends; ``SYNCED_FIELDS`` are the columns it sends."""

    SYNCED_FIELDS: ClassVar[frozenset[str]] = frozenset()

    # Declared by each model (``auto_now``): the feed's keyset column.
    last_modified: datetime.datetime

    class Meta:
        abstract = True

    def save(self, *args: Any, **kwargs: Any) -> None:
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and needs_last_modified(type(self), update_fields):
            kwargs["update_fields"] = [*update_fields, LAST_MODIFIED]
        super().save(*args, **kwargs)
