import os

import exiftool

from api.metadata.reader import get_sidecar_files_in_priority_order
from api.util import logger


def write_metadata(media_file, tags, use_sidecar=True):
    et = exiftool.ExifTool()
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True
    # To-Do: Replace with new File Structure
    if use_sidecar:
        file_path = get_sidecar_files_in_priority_order(media_file)[0]
    else:
        file_path = media_file

    try:
        logger.info(f"Writing {tags} to {file_path}")
        params = [os.fsencode(f"-{tag}={value}") for tag, value in tags.items()]
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)
    finally:
        if terminate_et:
            et.terminate()
