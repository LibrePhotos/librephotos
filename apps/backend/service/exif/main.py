import os
import shutil
from collections import Counter
from typing import Any

import exiftool
from flask.typing import ResponseReturnValue

from api.metadata.tags import SIDECAR_EQUIVALENTS, describes_the_file
from api.mime import METADATA_EXTENSIONS, extension
from service._common import (
    MalformedRequest,
    create_app,
    json_fields,
    logger,
    serve_forever,
)
from service.exif.all_tags import FileNotReadableError, read_all_tags
from service.exif.geolocate import (
    InvalidPointsError,
    geolocate,
    parse_max_distance,
    parse_points,
)
from service.exif.tag_validation import is_safe_media_path, is_safe_tag_name

# Absolute path: the exiftool-bin wheel is on PATH, but Windows searches System32 first.
EXIFTOOL = shutil.which("exiftool") or "exiftool"
static_et = exiftool.ExifTool(EXIFTOOL)
static_struct_et = exiftool.ExifTool(EXIFTOOL, common_args=["-struct"])


def stop_exiftools() -> None:
    """Stop both ExifTool processes; the next request starts the one it needs.

    Each is a Perl interpreter of ~30-40 MB (plus a console host on Windows)
    that stayed up between scans. The watchdog (api.runtime.supervisor) calls this once
    the sidecar has been idle for a while, as it unloads the ML sidecars'
    models; a restart costs one Perl start-up (~0.3 s). The Rust experiment
    measured -57 % idle memory for its ExifTool pool this way.
    """
    for et in (static_et, static_struct_et):
        if et.running:
            et.terminate()


app = create_app(
    "exif",
    unload=stop_exiftools,
    is_loaded=lambda: static_et.running or static_struct_et.running,
)
log = logger("exif")


def parse_get_tags_request() -> tuple[Any, ...] | None:
    try:
        return json_fields("files_by_reverse_priority", "tags", "struct")
    except MalformedRequest:
        return None


def running_exiftool(struct: object) -> exiftool.ExifTool:
    et = static_struct_et if struct else static_et
    if not et.running:
        et.start()
    return et


def _names_in(file: str, tag: str) -> list[str]:
    """The names *tag* is read under in *file*, first found wins.

    A sidecar holds an EXIF property under its XMP name (``SIDECAR_EQUIVALENTS``);
    a media file is read by the requested name only. A sidecar is not asked
    for a tag that describes the file itself (``describes_the_file``): its
    file size is the sidecar's, not the photo's (#2670).
    """
    if extension(file) not in METADATA_EXTENSIONS:
        return [tag]
    if describes_the_file(tag):
        return []
    equivalent = SIDECAR_EQUIVALENTS.get(tag)
    if equivalent is not None:
        return [equivalent, tag]
    return [tag]


def _with_equivalents(tags: list[str]) -> list[str]:
    """*tags* plus the sidecar name of each, for one command over every file."""
    extra = [SIDECAR_EQUIVALENTS[tag] for tag in tags if tag in SIDECAR_EQUIVALENTS]
    return tags + [name for name in dict.fromkeys(extra) if name not in tags]


def highest_priority_value(
    et: exiftool.ExifTool, tag: str, files_by_reverse_priority: list[str]
) -> object:
    value: object = None
    for file in files_by_reverse_priority:
        for name in _names_in(file, tag):
            retrieved_value = et.get_tag(name, file)
            if retrieved_value is not None:
                value = retrieved_value
                break
    return value


def _split_tag(tag: str) -> tuple[str, str]:
    group, _, name = tag.rpartition(":")
    return group.lower(), name.lower()


def _group_matches(requested: str, returned: str) -> bool:
    # ExifTool reports the family 0 group ("XMP") even when a family 1 group
    # ("XMP-dc") was asked for; an ungrouped key (no -G) cannot be checked.
    return (
        not requested
        or not returned
        or requested == returned
        or requested.startswith(returned + "-")
    )


def _name_matches(requested: str, returned: str) -> bool:
    # "Description-*" asks for every language entry of a lang-alt tag
    # (Description-de, Description-fr, ...); ExifTool answers with those keys.
    if requested.endswith("-*"):
        return returned.startswith(requested[:-1])
    return requested == returned


def _attribute(data: dict[str, object], tags: list[str]) -> tuple[list[object], bool]:
    """Map one file's batched output back to the requested tags.

    Returns the values in tag order, with None for an unresolved tag, and
    whether every returned key was claimed. A single-tag command answers with
    whatever key ExifTool files the tag under, which is not always the name it
    was asked by; an unclaimed key means some request came back renamed, and
    only a command of its own can say which.
    """
    keys = [key for key in data if key != "SourceFile"]
    claimed: set[str] = set()
    values: list[object] = []
    for tag in tags:
        group, name = _split_tag(tag)
        value: object = None
        for key in keys:
            key_group, key_name = _split_tag(key)
            if _name_matches(name, key_name) and _group_matches(group, key_group):
                claimed.add(key)
                # Several groups can hold an ungrouped tag (File:ImageWidth,
                # EXIF:ImageWidth); ExifTool lists them in the same order a
                # single-tag command would, and that command took the first.
                if value is None:
                    value = data[key]
        values.append(value)
    return values, len(claimed) == len(keys)


def _shared_names(tags: list[str]) -> set[str]:
    """The tags of *tags* whose name another one has too (EXIF:Model, QuickTime:Model)."""
    names = Counter(_split_tag(tag)[1] for tag in tags)
    return {tag for tag in tags if names[_split_tag(tag)[1]] > 1}


def _ungrouped(data: dict[str, object]) -> bool:
    """Whether an answer came from the -struct instance, whose keys have no group."""
    return any(":" not in key for key in data if key != "SourceFile")


def _file_values(
    et: exiftool.ExifTool,
    tags: list[str],
    file: str,
    data: dict[str, object],
    requested: list[str],
) -> list[object]:
    """*file*'s value of each of *tags*, from its answer to the *requested* names."""
    found, complete = _attribute(data, requested)
    by_name = dict(zip(requested, found))
    # Without groups, tags of one name in different groups come back as one
    # key, which cannot say whose value it is: each gets a command of its own.
    ambiguous = _shared_names(requested) if _ungrouped(data) else set()
    values: list[object] = []
    for tag in tags:
        value: object = None
        for name in _names_in(file, tag):
            value = by_name[name]
            if name in ambiguous or (value is None and not complete):
                value = et.get_tag(name, file)
            if value is not None:
                break
        values.append(value)
    return values


def highest_priority_values(
    et: exiftool.ExifTool, tags: list[str], files_by_reverse_priority: list[str]
) -> list[object]:
    """Every requested tag from every file in one ExifTool command.

    A command costs ExifTool ~15 ms whether it reads one tag or thirty, so
    asking per tag and per file made metadata the slowest part of a scan.
    A later file overrides an earlier one, as with ``highest_priority_value``.
    The sidecar names of the tags ride along in the same command; only a
    sidecar's answer to them is used.
    """
    requested = _with_equivalents(tags)
    per_file = et.get_tags_batch(requested, files_by_reverse_priority)
    if len(per_file) != len(files_by_reverse_priority):
        # ExifTool leaves out a file it cannot read, so the answers no longer
        # line up with the files; ask per tag and per file as before.
        return [
            highest_priority_value(et, tag, files_by_reverse_priority) for tag in tags
        ]
    values: list[object] = [None] * len(tags)
    for file, data in zip(files_by_reverse_priority, per_file):
        for index, value in enumerate(_file_values(et, tags, file, data, requested)):
            if value is not None:
                values[index] = value
    return values


@app.route("/get-tags", methods=["POST"])
def get_tags() -> ResponseReturnValue:
    payload = parse_get_tags_request()
    if payload is None:
        return "", 400
    files_by_reverse_priority, tags, struct = payload

    # A line break in a path would inject ExifTool options into the argument
    # stream just as a bad tag would. Paths are not user-typed, so a line
    # break means something is wrong; refuse the whole request rather than
    # silently reading a different file.
    if any(not is_safe_media_path(file) for file in files_by_reverse_priority):
        log.warning(
            "refusing a request with a line break in a path: %s",
            files_by_reverse_priority,
        )
        return {"error": "media path contains a line break"}, 400

    et = running_exiftool(struct)

    # Defense in depth: the serializer already rejects unsafe tag names when a
    # rule is saved, but a tag that reaches ExifTool as "-<tag>" with an "="
    # (a write/rename) or a line break (option injection, e.g. -if <perl>)
    # would turn a metadata read into a write or arbitrary code. Drop unsafe
    # tags and answer None in their place, keeping the values aligned to the
    # requested tags positionally as callers unpack them.
    safe = [is_safe_tag_name(tag) for tag in tags]
    if not all(safe):
        dropped = [tag for tag, ok in zip(tags, safe) if not ok]
        log.warning("ignoring unsafe tag name(s): %s", dropped)
    safe_tags = [tag for tag, ok in zip(tags, safe) if ok]

    if not safe_tags or not files_by_reverse_priority:
        return {"values": [None] * len(tags)}, 200

    try:
        safe_values = highest_priority_values(et, safe_tags, files_by_reverse_priority)
    except Exception as exc:
        # Not an empty answer: that reads as "no tags", and the photo would be
        # stored without a date or location that a rescan never comes back for.
        log.error("error reading tags from %s: %s", files_by_reverse_priority, exc)
        return {"error": str(exc)}, 500

    # Splice the safe-tag values back into the full requested order.
    safe_value_iter = iter(safe_values)
    values = [next(safe_value_iter) if ok else None for ok in safe]
    return {"values": values}, 200


def _all_tags_path() -> str | None:
    """The one absolute path an /all-tags request names, or None if it is unusable.

    Absolute, so it cannot start with "-" and be read as an option; no line
    break, which would inject arguments (see tag_validation).
    """
    try:
        (path,) = json_fields("path")
    except MalformedRequest:
        return None
    if not is_safe_media_path(path) or not os.path.isabs(path):
        return None
    return str(path)


@app.route("/all-tags", methods=["POST"])
def all_tags() -> ResponseReturnValue:
    """Every tag of one file, grouped by ExifTool group (#2277); nothing is stored."""
    path = _all_tags_path()
    if path is None:
        return {"error": "the request needs one absolute path"}, 400
    if not os.path.isfile(path):
        return {"error": "file not found"}, 404
    try:
        groups = read_all_tags(running_exiftool(struct=True), path)
    except FileNotReadableError as exc:
        return {"error": str(exc)}, 404
    except Exception as exc:
        log.error("error reading all tags: %s", exc)
        log.debug("error reading all tags of %s", path)
        return {"error": str(exc)}, 500
    return {"groups": groups}, 200


@app.route("/geolocate", methods=["POST"])
def geolocate_points() -> ResponseReturnValue:
    """The nearest town to each point, from ExifTool's Geolocation database (#2302).

    Takes ``{"points": [{"lat": <number>, "lon": <number>}, ...]}`` and an
    optional ``max_distance_km``; answers ``{"places": [...]}`` with one object
    of Geolocation tags per point, in order, or null where no town is within
    the cap. Runs on the process ``/get-tags`` uses: the server handles one
    request at a time, and the lookup's options do not outlast its command.
    """
    points, max_distance = json_fields("points", max_distance_km=None)
    try:
        parsed = parse_points(points)
        cap = parse_max_distance(max_distance)
    except InvalidPointsError as exc:
        return {"error": str(exc)}, 400
    et = running_exiftool(struct=False)
    try:
        places = [geolocate(et, point, cap) for point in parsed]
    except Exception as exc:
        log.error("error looking up places: %s", exc)
        return {"error": str(exc)}, 500
    return {"places": places}, 200


def serve() -> None:
    serve_forever(app, "exif")


if __name__ == "__main__":
    serve()
