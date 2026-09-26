import os
import uuid

from django.conf import settings

from api import util
from api.directory_watcher import handle_new_image
from api.image_similarity import build_image_similarity_index
from api.models import LongRunningJob
from api.models.file import is_metadata, is_raw
from nextcloud.server_address import connect


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


def user_media_root(user):
    """The directory a user's Nextcloud files are downloaded into."""
    base = os.path.join(settings.DATA_ROOT, "nextcloud_media")
    root = os.path.join(base, user.username)
    if os.path.dirname(os.path.normpath(root)) != os.path.normpath(base):
        raise ValueError(
            f"User name {user.username!r} does not make a directory of its own"
        )
    return root


def local_path_for(root, remote_path):
    """Map a remote path to its download location, or None if that leaves root.

    Remote paths come from the server's WebDAV listing, so a server that answers
    with ``..`` segments or an absolute path must not be able to write anywhere
    but below ``root``. Containment is checked on the resolved paths, so a
    symlink inside ``root`` cannot lead outside it either.
    """
    relative = remote_path.lstrip("/\\")
    if not relative:
        return None
    candidate = os.path.normpath(os.path.join(root, relative))
    try:
        real_root = os.path.realpath(root)
        real_candidate = os.path.realpath(candidate)
        inside = (
            os.path.commonpath([real_root, real_candidate]) == real_root
            and real_candidate != real_root
        )
    except (ValueError, OSError):
        return None
    return candidate if inside else None


def download(nc, remote_path, local_path):
    """Download to a temporary file next to ``local_path``, then move it there.

    ``local_path`` only ever appears complete, so an interrupted download is
    fetched again by the next scan instead of being kept as a truncated file.
    Returns whether the file was downloaded.
    """
    local_dir = os.path.dirname(local_path)
    os.makedirs(local_dir, exist_ok=True)
    temp_path = os.path.join(local_dir, f".nextcloud-{uuid.uuid4().hex}.part")
    try:
        if not nc.get_file(remote_path, temp_path) or not os.path.isfile(temp_path):
            return False
        os.replace(temp_path, local_path)
        return True
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def scan_photos(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        job_id=job_id,
    )

    # Everything the scan does - logging in, listing the remote directory and
    # downloading the photos included - has to happen inside the try, otherwise
    # a failure (rejected app password, unreachable server, missing scan
    # directory) leaves the job at finished=False forever and blocks the queue
    # for every other job.
    try:
        root = user_media_root(user)
        nc = connect(user)

        photos = []

        paths = []

        collect_photos(nc, user.nextcloud_scan_directory, photos)

        for photo in photos:
            local_path = local_path_for(root, photo)
            if local_path is None:
                util.logger.warning(
                    "Skipping Nextcloud file %r: it would be stored outside %s",
                    photo,
                    root,
                )
                continue

            if not os.path.exists(local_path):
                if not download(nc, photo, local_path):
                    util.logger.warning(
                        "Nextcloud did not return %r, skipping it", photo
                    )
                    continue
                util.logger.info("Downloaded photo from nextcloud to %s", local_path)
            paths.append(local_path)

        paths.sort()

        to_add_count = len(paths)
        for idx, image_path in enumerate(paths):
            util.logger.info("begin handling of photo %d/%d", idx + 1, to_add_count)
            handle_new_image(user, image_path, job_id)
            lrj.update_progress(current=idx + 1, target=to_add_count)

        util.logger.info(f"Added {len(paths)} photos")
        build_image_similarity_index(user)

        lrj.complete()
    except Exception as e:
        util.logger.exception(str(e))
        lrj.fail(error=e)
        return {"status": False}
    return {"status": True}
