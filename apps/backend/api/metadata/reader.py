import os
import os.path

import requests

from api import sidecars


class MetadataReadError(RuntimeError):
    """The exif service could not read a file's metadata."""


def get_sidecar_files_in_priority_order(media_file):
    """Returns a list of possible XMP sidecar files for *media_file*, ordered
    by priority.

    """
    image_basename = os.path.splitext(media_file)[0]
    return [
        image_basename + ".xmp",
        image_basename + ".XMP",
        media_file + ".xmp",
        media_file + ".XMP",
    ]


def _get_existing_metadata_files_reversed(media_file, include_sidecar_files):
    if include_sidecar_files:
        files = [
            file
            for file in get_sidecar_files_in_priority_order(media_file)
            if os.path.exists(file)
        ]
        files.append(media_file)
        return list(reversed(files))
    return [media_file]


def get_metadata(media_file, tags, try_sidecar=True, struct=False):
    """Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*.
    If *struct* is `True`, use the exiftool instance which returns structured data

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found. Raises `MetadataReadError` if the exif service cannot
    be reached, fails to read the file, or returns an unusable response: a list of `None` would be stored as "this file has no metadata",
    and a rescan never reads the unchanged file again. The scan records the
    raise as a failure of that one file.

    """
    files_by_reverse_priority = _get_existing_metadata_files_reversed(
        media_file, try_sidecar
    )

    payload = {
        "tags": tags,
        "files_by_reverse_priority": files_by_reverse_priority,
        "struct": struct,
    }
    from api.http_timeouts import EXIF

    # A refused or dropped connection and a 503 are retried by the client
    # (api.sidecars); what still fails here would fail again.
    try:
        response = sidecars.post("exif", "/get-tags", json=payload, timeout=EXIF)
        values = response.json()["values"]
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        # ValueError covers JSONDecodeError (empty/non-JSON body); KeyError and
        # TypeError a body without a "values" list; RequestException timeouts,
        # dropped connections and error statuses.
        raise MetadataReadError(
            f"exif service could not read the metadata of {media_file}: "
            f"{sidecars.error_detail(error)}"
        ) from error
    if not isinstance(values, list):
        raise MetadataReadError(
            f"exif service answered for {media_file} without a list of values"
        )

    # Callers unpack the result positionally, so pad a short answer with None
    # to honor the documented one-value-per-tag contract.
    if len(values) < len(tags):
        values = list(values) + [None] * (len(tags) - len(values))
    return values
