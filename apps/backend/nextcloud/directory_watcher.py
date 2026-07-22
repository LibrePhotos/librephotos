import os
import pathlib

import owncloud as nextcloud
from django.conf import settings

from api import util
from api.directory_watcher import handle_new_image
from api.image_similarity import build_image_similarity_index
from api.models import LongRunningJob
from api.models.file import is_metadata, is_raw


def isValidNCMedia(file_obj):
    """Tell whether a remote file is something librephotos can index.

    A remote file is only known by its WebDAV metadata, so the decision is made
    on the ``{DAV:}getcontenttype`` and - for the formats nextcloud has no mime
    type for, most notably camera raw - on the file name. What is accepted here
    mirrors what the local directory watcher indexes
    (``api.models.file.is_valid_media``): images, videos, raw files and xmp
    sidecars. Anything narrower silently drops whole nextcloud folders.
    """
    try:
        file_attr = file_obj.attributes
        filetype = file_attr.get("{DAV:}getcontenttype") or ""
        if filetype.startswith("image/") or filetype.startswith("video/"):
            return True
        if is_raw(file_obj.path) or is_metadata(file_obj.path):
            return True
        util.logger.info(
            f"Skipping {file_obj.path}, because '{filetype}' is not a media type"
        )
        return False
    except Exception:
        util.logger.exception("An image thrown an exception")
        return False


def collect_photos(nc, path, photos):
    for x in nc.list(path):
        if not x.is_dir() and isValidNCMedia(x):
            photos.append(x.path)
        elif x.is_dir():
            collect_photos(nc, x.path, photos)


def scan_photos(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        job_id=job_id,
    )

    added_photo_count = 0

    # Everything the scan does - logging in, listing the remote directory and
    # downloading the photos included - has to happen inside the try, otherwise
    # a failure (rejected app password, unreachable server, missing scan
    # directory) leaves the job at finished=False forever and blocks the queue
    # for every other job.
    try:
        nc = nextcloud.Client(user.nextcloud_server_address)
        nc.login(user.nextcloud_username, user.nextcloud_app_password)

        photos = []

        paths = []

        collect_photos(nc, user.nextcloud_scan_directory, photos)

        for photo in photos:
            local_dir = os.path.join(
                settings.DATA_ROOT,
                "nextcloud_media",
                user.username,
                os.path.dirname(photo)[1:],
            )
            local_path = os.path.join(
                settings.DATA_ROOT, "nextcloud_media", user.username, photo[1:]
            )
            paths.append(local_path)

            if not os.path.exists(local_dir):
                pathlib.Path(local_dir).mkdir(parents=True, exist_ok=True)

            if not os.path.exists(local_path):
                nc.get_file(photo, local_path)
            util.logger.info("Downloaded photo from nextcloud to " + local_path)

        paths.sort()

        to_add_count = len(paths)
        for idx, image_path in enumerate(paths):
            util.logger.info("begin handling of photo %d/%d" % (idx + 1, to_add_count))
            handle_new_image(user, image_path, job_id)
            lrj.update_progress(current=idx + 1, target=to_add_count)

        util.logger.info(f"Added {len(paths)} photos")
        build_image_similarity_index(user)

        lrj.complete()
    except Exception as e:
        util.logger.exception(str(e))
        lrj.fail(error=e)
        return {"new_photo_count": added_photo_count, "status": False}
    return {"new_photo_count": added_photo_count, "status": True}
