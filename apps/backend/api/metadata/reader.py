import os
import os.path
import time

import requests

from api import util

EXIF_SERVICE_URL = "http://localhost:8010/get-tags"
# The exif sidecar can transiently fail while a scan saturates the box —
# returning an empty body (so ``.json()`` raises ``JSONDecodeError``), a non-2xx
# status, or dropping the connection. Retry a few times with a short backoff
# before giving up, so a single blip does not become a per-photo error that
# accumulates past the failure threshold and marks a whole job "failed".
EXIF_MAX_ATTEMPTS = 3
EXIF_RETRY_BACKOFF = 0.5


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
    tag was not found. If the exif service cannot be reached or returns an
    unusable response after retries, returns a list of `None` (one per tag)
    rather than raising, so a transient service hiccup does not abort the
    caller's whole photo-processing pipeline.

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

    values = None
    last_error = None
    for attempt in range(EXIF_MAX_ATTEMPTS):
        try:
            response = requests.post(EXIF_SERVICE_URL, json=payload, timeout=EXIF)
            response.raise_for_status()
            values = response.json()["values"]
            break
        except (requests.RequestException, ValueError, KeyError) as error:
            # ValueError covers JSONDecodeError (empty/non-JSON body); KeyError a
            # response missing "values"; RequestException covers timeouts,
            # dropped connections and non-2xx statuses.
            last_error = error
            if attempt + 1 < EXIF_MAX_ATTEMPTS:
                time.sleep(EXIF_RETRY_BACKOFF * (attempt + 1))

    if values is None:
        util.logger.warning(
            f"exif service returned no usable metadata for {media_file} after "
            f"{EXIF_MAX_ATTEMPTS} attempt(s): {last_error}. "
            f"Falling back to empty metadata."
        )
        return [None] * len(tags)

    # The exif service can return fewer values than requested if exiftool
    # errors mid-loop. Callers unpack the result positionally, so pad with
    # None to honor the documented one-value-per-tag contract.
    if len(values) < len(tags):
        values = list(values) + [None] * (len(tags) - len(values))
    return values
