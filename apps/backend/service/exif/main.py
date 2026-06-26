import exiftool
import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

# PyExifTool 0.5.x replaced the ExifTool.start()/get_tag() API used here with
# ExifToolHelper.get_tags(). ExifToolHelper's default common_args (-G -n) match
# the group-qualified, numeric output the rest of the backend already expects.
static_et = exiftool.ExifToolHelper()
static_struct_et = exiftool.ExifToolHelper(common_args=["-struct"])

app = Flask(__name__)


def log(message):
    print(f"exif: {message}")


def _value_for_tag(tag, tags_by_key):
    """Pick *tag*'s value out of a single file's get_tags() result.

    exiftool returns keys either group-qualified (e.g. ``EXIF:DateTimeOriginal``
    with the default ``-G``) or bare (``DateTimeOriginal`` for the ``-struct``
    instance, which drops ``-G``), so fall back from an exact match to the bare
    tag name. Returns ``None`` when the tag is absent.
    """
    if tag in tags_by_key:
        return tags_by_key[tag]
    bare = tag.rsplit(":", 1)[-1]
    if bare in tags_by_key:
        return tags_by_key[bare]
    for key, value in tags_by_key.items():
        if key != "SourceFile" and key.rsplit(":", 1)[-1] == bare:
            return value
    return None


@app.route("/get-tags", methods=["POST"])
def get_tags():
    try:
        data = request.get_json()
        files_by_reverse_priority = data["files_by_reverse_priority"]
        tags = data["tags"]
        struct = data["struct"]
    except Exception:
        return "", 400

    et = static_struct_et if struct else static_et
    if not et.running:
        et.run()

    values = []
    try:
        # Read every requested tag from each file once. Files are ordered by
        # reverse priority, so the last file that yields a value for a tag wins
        # - preserving the previous get_tag()-per-file behaviour.
        results_by_file = {}
        for file in files_by_reverse_priority:
            try:
                result = et.get_tags([file], tags)
                results_by_file[file] = result[0] if result else {}
            except Exception:
                log(f"An error occurred reading tags from {file}")
                results_by_file[file] = {}

        for tag in tags:
            value = None
            for file in files_by_reverse_priority:
                retrieved_value = _value_for_tag(tag, results_by_file.get(file, {}))
                if retrieved_value is not None:
                    value = retrieved_value
            values.append(value)
    except Exception:
        log("An error occurred")

    return {"values": values}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8010), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
