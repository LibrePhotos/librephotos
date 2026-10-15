"""What the scan saw of a media file when it last read it (#2296).

An incremental scan reads a known file again only when it changed since it
was read. The scan records the modification time (``st_mtime_ns``) of each
media file it reads and of each of its XMP sidecars on the file's ``File``
row, and the next scan compares what it sees with that record: a file whose
times match is left alone, with no clock or time zone involved (#2193).

LibrePhotos' own write-back (``api.metadata.photo_writer``) changes the
modification time of the sidecar or the media file it writes. After a write
that landed it records the new times (``record_own_write``), so the next scan
does not read the photo again for a change LibrePhotos made itself. It does so
only for the files that were still as the scan last saw them before the
write (``as_indexed``): an edit another app made in between is still picked up.

A row without a record (indexed before #2296) makes the scan compare with the
start of the last scan instead, as it did before.
"""

from __future__ import annotations

import os
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field

from api.metadata.reader import existing_sidecars
from api.models.file import File


@dataclass(frozen=True)
class Observed:
    """A media file's modification time and those of its existing sidecars.

    ``mtime_ns`` is None when the file cannot be read (gone). ``sidecars``
    maps each sidecar's ``sidecar_key`` to its ``st_mtime_ns``.
    """

    mtime_ns: int | None
    sidecars: Mapping[str, int] = field(default_factory=dict)


def sidecar_key(path: str) -> str:
    """How a sidecar is named in a record: its file name, case-folded where the
    file system ignores case (``existing_sidecars`` may spell it either way)."""
    return os.path.normcase(os.path.basename(path))


def _mtime_ns(path: str) -> int | None:
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def observe(path: str) -> Observed:
    """What is on disk now for the media file ``path``."""
    sidecars: dict[str, int] = {}
    for sidecar in existing_sidecars(path):
        mtime = _mtime_ns(sidecar)
        if mtime is not None:
            sidecars[sidecar_key(sidecar)] = mtime
    return Observed(_mtime_ns(path), sidecars)


def recorded(mtime_ns: int | None, sidecars: object) -> Observed | None:
    """The record a ``File`` row's two fields hold, or None when it has none."""
    if mtime_ns is None or not isinstance(sidecars, dict):
        return None
    return Observed(
        mtime_ns,
        {
            str(name): mtime
            for name, mtime in sidecars.items()
            if isinstance(mtime, int)
        },
    )


def as_fields(seen: Observed) -> dict[str, object]:
    """``seen`` as the values of the ``File`` fields that hold it."""
    return {
        "indexed_mtime_ns": seen.mtime_ns,
        "indexed_sidecar_mtimes": dict(seen.sidecars),
    }


def record(path: str, seen: Observed) -> None:
    """Store ``seen`` as what the scan last read of the media file ``path``.

    Nothing for a file that could not be read, or for a path without a row
    of its own (an exact copy shares the row of the file it copies).
    """
    if seen.mtime_ns is None:
        return
    File.objects.filter(path=path).update(**as_fields(seen))


def as_indexed(paths: Collection[str]) -> list[str]:
    """The media files among ``paths`` that, with their sidecars, are as the scan last read them.

    A file without a record yet is not, so a write to it is not recorded and
    the next scan reads it again, as before #2296.
    """
    rows = File.objects.filter(path__in=paths).values_list(
        "path", "indexed_mtime_ns", "indexed_sidecar_mtimes"
    )
    found = []
    for path, mtime_ns, sidecars in rows:
        stored = recorded(mtime_ns, sidecars)
        if stored is not None and observe(path) == stored:
            found.append(path)
    return sorted(found)


def record_own_write(paths: Collection[str]) -> None:
    """Record a write LibrePhotos made, which landed, for the media files ``paths``.

    ``paths`` is what ``as_indexed`` answered right before the write: for
    those the record still says that the scan has read everything else on
    disk, and the write is the one change since.
    """
    for path in paths:
        record(path, observe(path))
