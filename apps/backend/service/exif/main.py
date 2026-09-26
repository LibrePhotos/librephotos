import os
import shutil

import exiftool
import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

# Absolute path: the exiftool-bin wheel is on PATH, but Windows searches System32 first.
EXIFTOOL = shutil.which("exiftool") or "exiftool"
static_et = exiftool.ExifTool(EXIFTOOL)
static_struct_et = exiftool.ExifTool(EXIFTOOL, common_args=["-struct"])

app = Flask(__name__)


def log(message):
    print(f"exif: {message}")


def parse_get_tags_request():
    try:
        data = request.get_json()
        return (
            data["files_by_reverse_priority"],
            data["tags"],
            data["struct"],
        )
    except Exception:
        return None


def running_exiftool(struct):
    et = static_struct_et if struct else static_et
    if not et.running:
        et.start()
    return et


def highest_priority_value(et, tag, files_by_reverse_priority):
    value = None
    for file in files_by_reverse_priority:
        retrieved_value = et.get_tag(tag, file)
        if retrieved_value is not None:
            value = retrieved_value
    return value


def _split_tag(tag):
    group, _, name = tag.rpartition(":")
    return group.lower(), name.lower()


def _group_matches(requested, returned):
    # ExifTool reports the family 0 group ("XMP") even when a family 1 group
    # ("XMP-dc") was asked for; an ungrouped key (no -G) cannot be checked.
    return (
        not requested
        or not returned
        or requested == returned
        or requested.startswith(returned + "-")
    )


def _name_matches(requested, returned):
    # "Description-*" asks for every language entry of a lang-alt tag
    # (Description-de, Description-fr, ...); ExifTool answers with those keys.
    if requested.endswith("-*"):
        return returned.startswith(requested[:-1])
    return requested == returned


def _attribute(data, tags):
    """Map one file's batched output back to the requested tags.

    Returns the values in tag order, with None for an unresolved tag, and
    whether every returned key was claimed. A single-tag command answers with
    whatever key ExifTool files the tag under, which is not always the name it
    was asked by; an unclaimed key means some request came back renamed, and
    only a command of its own can say which.
    """
    keys = [key for key in data if key != "SourceFile"]
    claimed = set()
    values = []
    for tag in tags:
        group, name = _split_tag(tag)
        value = None
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


def _file_values(et, tags, file, data):
    values, complete = _attribute(data, tags)
    if complete:
        return values
    return [
        et.get_tag(tag, file) if value is None else value
        for tag, value in zip(tags, values)
    ]


def highest_priority_values(et, tags, files_by_reverse_priority):
    """Every requested tag from every file in one ExifTool command.

    A command costs ExifTool ~15 ms whether it reads one tag or thirty, so
    asking per tag and per file made metadata the slowest part of a scan.
    A later file overrides an earlier one, as with ``highest_priority_value``.
    """
    per_file = et.get_tags_batch(tags, files_by_reverse_priority)
    if len(per_file) != len(files_by_reverse_priority):
        # ExifTool leaves out a file it cannot read, so the answers no longer
        # line up with the files; ask per tag and per file as before.
        return [
            highest_priority_value(et, tag, files_by_reverse_priority) for tag in tags
        ]
    values = [None] * len(tags)
    for file, data in zip(files_by_reverse_priority, per_file):
        for index, value in enumerate(_file_values(et, tags, file, data)):
            if value is not None:
                values[index] = value
    return values


@app.route("/get-tags", methods=["POST"])
def get_tags():
    payload = parse_get_tags_request()
    if payload is None:
        return "", 400
    files_by_reverse_priority, tags, struct = payload

    et = running_exiftool(struct)

    if not tags or not files_by_reverse_priority:
        return {"values": [None] * len(tags)}, 201

    try:
        values = highest_priority_values(et, tags, files_by_reverse_priority)
    except Exception:
        log("An error occurred")
        # Callers unpack one value per tag; the reader pads a short list.
        values = []

    return {"values": values}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


def serve():
    log("service starting")
    # 0.0.0.0 inside the containers, as always; the standalone build sets
    # SERVICE_HOST to loopback (librephotos.standalone.prepare_environment).
    server = WSGIServer((os.environ.get("SERVICE_HOST", "0.0.0.0"), 8010), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])


if __name__ == "__main__":
    serve()
