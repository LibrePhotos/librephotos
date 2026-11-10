"""Every tag of one file, grouped as ExifTool groups them (#2277).

The "All metadata" view asks for this on demand; nothing is stored. ExifTool
runs with print conversion on (no ``-n``), so values read as in its own output
(``1/250``, ``Horizontal (normal)``), and with ``-api StructFormat=JSONQ`` so
every value comes back as the text ExifTool prints (``0230``, ``0.160``)
instead of a JSON number that loses its leading or trailing zeros. ``-struct``
keeps XMP structures (a region list, a contact block) as objects, and
``-G0:1`` names each tag's family 0 group (``EXIF``, ``XMP``, ``MakerNotes``)
and family 1 group (``IFD0``, ``XMP-dc``, ``FujiFilm``). Binary payloads stay
ExifTool's ``(Binary data N bytes, ...)`` placeholder (no ``-b``).

The ``System`` group (file name, directory, permissions, dates of the file
system entry) and the ``ExifTool`` group (its version) describe the server's
disk and ExifTool, not the photo, and the file name and directory would show
server paths: both are dropped, as is ``SourceFile``.

No Flask or Django here: the route in ``service.exif.main`` calls it.
"""

from __future__ import annotations

import json
import os
from typing import TypedDict

from api.metadata.exiftool_client import ExifTool, decode_output, without_paths

ARGS = ("-G0:1", "-a", "-api", "StructFormat=JSONQ")
DROPPED_GROUPS = frozenset({"System", "ExifTool"})


class TagGroup(TypedDict):
    name: str
    family: str
    tags: dict[str, object]


class FileNotReadableError(Exception):
    """ExifTool answered nothing for the file: it is gone or not a file it reads.

    The message is ExifTool's reason from its stderr, the path replaced by
    "the file".
    """


def _split_key(key: str) -> tuple[str, str, str]:
    """``EXIF:IFD0:Make`` -> (EXIF, IFD0, Make); ``File:FileType`` -> (File, File, FileType).

    ExifTool writes the group once when both families have the same name.
    """
    parts = key.split(":")
    if len(parts) >= 3:
        return parts[0], parts[1], ":".join(parts[2:])
    if len(parts) == 2:
        return parts[0], parts[0], parts[1]
    return "", "", key


def group_tags(data: dict[str, object]) -> list[TagGroup]:
    """ExifTool's ``-j -G0:1`` answer for one file as groups.

    The groups come in ExifTool's order (File, EXIF, ..., Composite) and the
    tags of each by name, so a group of hundreds of maker notes can be
    scanned like an index, and the answer is the same whatever orders the
    JSON objects on the way.
    """
    groups: dict[str, TagGroup] = {}
    for key, value in data.items():
        if key == "SourceFile":
            continue
        family, name, tag = _split_key(key)
        if family in DROPPED_GROUPS or name in DROPPED_GROUPS:
            continue
        group = groups.setdefault(name, {"name": name, "family": family, "tags": {}})
        group["tags"][tag] = value
    for group in groups.values():
        group["tags"] = dict(
            sorted(group["tags"].items(), key=lambda item: item[0].lower())
        )
    return list(groups.values())


def _reason(stderr: str, path: str) -> str:
    """ExifTool's complaint about *path*, without the server path in it."""
    lines = [line for line in without_paths(stderr, [path]).splitlines() if line]
    return lines[0] if lines else "ExifTool could not read the file"


def read_all_tags(et: ExifTool, path: str) -> list[TagGroup]:
    """Every tag of *path*, grouped. *et* runs with ``-struct`` and without ``-n``.

    Raises FileNotReadableError when ExifTool answers nothing, with the reason
    it printed on stderr, and ValueError for an answer that is not one JSON
    object.
    """
    args = ["-j", *ARGS, path]
    answer = et.run(*(os.fsencode(arg) for arg in args))
    output = decode_output(answer.stdout).strip()
    if not output:
        raise FileNotReadableError(_reason(answer.stderr_text(), path))
    answers = json.loads(output)
    if not isinstance(answers, list) or len(answers) != 1:
        raise ValueError("ExifTool answered with an unexpected shape")
    answer = answers[0]
    if not isinstance(answer, dict):
        raise ValueError("ExifTool answered with an unexpected shape")
    return group_tags(answer)
