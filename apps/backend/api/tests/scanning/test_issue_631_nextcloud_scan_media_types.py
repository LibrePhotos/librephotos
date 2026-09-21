"""Regression test for https://github.com/LibrePhotos/librephotos/issues/631

"Sub folders are not indexed in Nextcloud watch folder".

The reporter has a Nextcloud watch folder with several sub folders
(``/nextcloud/photoset1``, ``/nextcloud/photoset2``, ``/nextcloud/photoset3``)
and after a "Scan photos (Nextcloud)" run only *some* of the sub folders show
up: "it is only importing the photos in photoset 1 and 3".

The obvious suspect - a missing recursion - is *not* the problem:
``nextcloud.directory_watcher.collect_photos`` does walk sub directories
(``test_recursion_into_sub_folders_is_not_the_problem`` below passes).

The actual defect is the gate that decides which remote files are media,
``nextcloud.directory_watcher.isValidNCMedia``.  It matches the WebDAV
``{DAV:}getcontenttype`` against a hard coded whitelist::

    "jpeg" in filetype or "png" in filetype or "bmp" in filetype
    or "gif" in filetype or "heic" in filetype or "heif" in filetype

Everything else is silently dropped - no log line, no error, no entry in the
LongRunningJob.  So a sub folder that happens to hold videos (``video/mp4``,
``video/quicktime``), TIFFs, WebP or camera RAW files is skipped *in its
entirety* and the user sees exactly the reported symptom: some folders import,
others simply never appear.

Those file types are not exotic to LibrePhotos - the local directory watcher
indexes them (``api.models.file.is_video`` / ``is_raw`` accept them, and
``File`` even has dedicated ``VIDEO`` / ``RAW_FILE`` types), so a photo that is
indexed when it sits on a local disk is dropped when the very same photo sits
in a Nextcloud sub folder.

Expected behaviour: ``collect_photos`` collects every media file LibrePhotos
can index, in every sub folder of the watch directory.
"""

from django.test import SimpleTestCase
from owncloud import FileInfo

from api.models.file import is_raw
from nextcloud.directory_watcher import collect_photos, isValidNCMedia


def make_dir(path):
    """A WebDAV collection as owncloud's client hands it to us."""
    if not path.endswith("/"):
        path += "/"
    return FileInfo(path, "dir", {"{DAV:}getcontenttype": "httpd/unix-directory"})


def make_file(path, content_type):
    return FileInfo(
        path,
        "file",
        {
            "{DAV:}getcontenttype": content_type,
            "{DAV:}getcontentlength": "1024",
        },
    )


class FakeNextcloudClient:
    """Minimal stand-in for ``owncloud.Client`` backed by an in-memory tree.

    Mirrors the real client: ``list()`` returns the *children* of a collection
    (the collection itself is stripped by owncloud), directory entries have a
    trailing slash in ``path`` and ``is_dir()`` is True for them.
    """

    def __init__(self, tree):
        self.tree = {
            (p if p.endswith("/") else p + "/"): entries for p, entries in tree.items()
        }
        self.listed = []

    def list(self, path, depth=1, properties=None):
        if not path.endswith("/"):
            path += "/"
        self.listed.append(path)
        return list(self.tree[path])


class Issue631NextcloudSubFolderScanTest(SimpleTestCase):
    def test_recursion_into_sub_folders_is_not_the_problem(self):
        """Sanity check: collect_photos really does descend into sub folders."""
        nc = FakeNextcloudClient(
            {
                "/nextcloud/": [
                    make_dir("/nextcloud/photoset1/"),
                    make_dir("/nextcloud/photoset2/"),
                ],
                "/nextcloud/photoset1/": [
                    make_file("/nextcloud/photoset1/a.jpg", "image/jpeg"),
                    make_dir("/nextcloud/photoset1/nested/"),
                ],
                "/nextcloud/photoset1/nested/": [
                    make_file("/nextcloud/photoset1/nested/b.png", "image/png"),
                ],
                "/nextcloud/photoset2/": [
                    make_file("/nextcloud/photoset2/c.jpg", "image/jpeg"),
                ],
            }
        )

        photos = []
        collect_photos(nc, "/nextcloud/", photos)

        self.assertEqual(
            sorted(photos),
            [
                "/nextcloud/photoset1/a.jpg",
                "/nextcloud/photoset1/nested/b.png",
                "/nextcloud/photoset2/c.jpg",
            ],
        )

    def test_sub_folder_of_videos_and_tiffs_is_not_skipped(self):
        """The reported symptom: photoset1 + photoset3 import, photoset2 does not.

        photoset2 holds media LibrePhotos indexes happily from a local folder
        (a video, a TIFF, a WebP) but that ``isValidNCMedia`` refuses.
        """
        nc = FakeNextcloudClient(
            {
                "/nextcloud/": [
                    make_dir("/nextcloud/photoset1/"),
                    make_dir("/nextcloud/photoset2/"),
                    make_dir("/nextcloud/photoset3/"),
                ],
                "/nextcloud/photoset1/": [
                    make_file("/nextcloud/photoset1/holiday.jpg", "image/jpeg"),
                ],
                "/nextcloud/photoset2/": [
                    make_file("/nextcloud/photoset2/clip.mp4", "video/mp4"),
                    make_file("/nextcloud/photoset2/pano.tif", "image/tiff"),
                    make_file("/nextcloud/photoset2/shot.webp", "image/webp"),
                ],
                "/nextcloud/photoset3/": [
                    make_file("/nextcloud/photoset3/party.png", "image/png"),
                ],
            }
        )

        photos = []
        collect_photos(nc, "/nextcloud/", photos)

        collected_folders = sorted({p.rsplit("/", 1)[0] for p in photos})
        self.assertEqual(
            collected_folders,
            [
                "/nextcloud/photoset1",
                "/nextcloud/photoset2",
                "/nextcloud/photoset3",
            ],
            "a whole Nextcloud sub folder was silently dropped by the scan; "
            f"collected files were {sorted(photos)}",
        )

    def test_raw_files_in_a_sub_folder_are_collected(self):
        """LibrePhotos indexes RAW locally, so it must index RAW from Nextcloud."""
        raw_path = "/nextcloud/photoset2/DSC_0001.NEF"
        self.assertTrue(
            is_raw(raw_path),
            "precondition: LibrePhotos' own file model recognises this as RAW",
        )

        nc = FakeNextcloudClient(
            {
                "/nextcloud/": [make_dir("/nextcloud/photoset2/")],
                "/nextcloud/photoset2/": [
                    make_file(raw_path, "image/x-nikon-nef"),
                ],
            }
        )

        photos = []
        collect_photos(nc, "/nextcloud/", photos)

        self.assertEqual(
            photos,
            [raw_path],
            "RAW files stored in a Nextcloud sub folder are never indexed",
        )

    def test_isvalidncmedia_accepts_the_media_types_librephotos_indexes(self):
        """Pin the root cause down to the content-type whitelist itself."""
        rejected = [
            content_type
            for content_type in (
                "video/mp4",
                "video/quicktime",
                "image/tiff",
                "image/webp",
                "image/x-nikon-nef",
                "image/x-canon-cr2",
            )
            if not isValidNCMedia(make_file("/nextcloud/x", content_type))
        ]

        self.assertEqual(
            rejected,
            [],
            "nextcloud.directory_watcher.isValidNCMedia drops media types that "
            "the local directory watcher indexes",
        )
