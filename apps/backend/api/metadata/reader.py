import os
import os.path

import requests


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
    tag was not found.

    """
    files_by_reverse_priority = _get_existing_metadata_files_reversed(
        media_file, try_sidecar
    )

    json = {
        "tags": tags,
        "files_by_reverse_priority": files_by_reverse_priority,
        "struct": struct,
    }
    response = requests.post("http://localhost:8010/get-tags", json=json).json()
    return response["values"]
