"""Photos named in a bulk request by ``image_hash`` or by ``Photo.id``.

The bulk edits take ``image_hashes``. Released clients that read a photo's
``id`` from its summary (UhuruPhotos, since photo ids became UUIDs in 1.0.0)
send that id there instead, and the request matched nothing while answering
success. A key is therefore read as either, and the answer reports each
photo under the key the client sent.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from django.db.models import Q


class PhotoKeys:
    """The keys of one request, in its order, without repeats."""

    def __init__(self, keys: Iterable[str]) -> None:
        self.keys: list[str] = list(dict.fromkeys(keys))
        self._hashes = set(self.keys)
        self._ids: dict[uuid.UUID, str] = {}
        for key in self.keys:
            photo_id = _as_uuid(key)
            if photo_id is not None:
                self._ids.setdefault(photo_id, key)

    def q(self) -> Q:
        """The photos the keys name."""
        return Q(image_hash__in=self._hashes) | Q(pk__in=list(self._ids))

    def key_of(self, photo_id: uuid.UUID | str, image_hash: str) -> str:
        """The key the request named a photo by: its hash when it was sent,
        else its id."""
        if image_hash in self._hashes:
            return image_hash
        parsed = _as_uuid(str(photo_id))
        if parsed is not None and parsed in self._ids:
            return self._ids[parsed]
        return image_hash

    def keys_of(self, rows: Iterable[tuple[uuid.UUID | str, str]]) -> set[str]:
        """The keys of ``(pk, image_hash)`` rows."""
        return {self.key_of(pk, image_hash) for pk, image_hash in rows}


def _as_uuid(key: str) -> uuid.UUID | None:
    """``key`` as a photo id, or None for a hash. A hash is an md5 digest
    followed by the user id, so it is never 32 hex digits alone and not
    mistaken for an id."""
    try:
        return uuid.UUID(key)
    except ValueError, AttributeError:
        return None
