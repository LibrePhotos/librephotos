"""An incremental scan does not read a photo again for LibrePhotos' own write (#2296).

The scan records the modification times of each media file it reads and of
its sidecars (``api.photos.indexed_mtimes``); a write-back that landed updates
the record. Written with real ExifTool, in both write modes, and decided by
the scan's own group selection (``_select_groups_to_process`` with
``_known_paths``).
"""

import datetime
import os
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.utils import timezone

from api.directory_watcher.file_handlers import handle_file_group, handle_new_image
from api.directory_watcher.scan_jobs import (
    _known_paths,
    _partition_scan_paths,
    _select_groups_to_process,
)
from api.metadata.jobs import write_photo_ratings
from api.metadata.photo_writer import rotate_photo
from api.metadata.reader import existing_sidecars
from api.metadata.tags import Tags
from api.metadata.writer import MetadataWriteError
from api.models import File, Photo
from api.models.user import User
from api.photos import indexed_mtimes
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE
MODES = (SIDECAR, MEDIA_FILE)
HANDLERS = "api.directory_watcher.file_handlers"

# Turns the photo a quarter clockwise (``rotate_photo``'s convention).
CLOCKWISE = -90


def _read(photo, *_args):
    """Stand-in for ``_process_photo``: what makes the photo known to the scan."""
    Photo.objects.filter(pk=photo.pk).update(metadata_read_at=timezone.now())


class OwnWriteScanTest(RealExifToolTestCase):
    def setUp(self):
        super().setUp()
        for patcher in (
            patch(f"{HANDLERS}._process_photo", side_effect=_read),
            patch(f"{HANDLERS}.has_embedded_motion_video", return_value=False),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def indexed_photo(self, mode, name="photo", thumbnails=False):
        """A photo the last scan read, and that scan as the baseline.

        The baseline started before the read, as a real scan does, so the old
        check (modified after the baseline started) calls any later write a
        change.
        """
        user = create_test_user(save_metadata_to_disk=mode)
        path = self.make_image(".jpg", f"{name}-{mode}")
        photo = self.photo_for(path, user, thumbnails=thumbnails, rating=4)
        self.baseline = SimpleNamespace(started_at=timezone.now())
        handle_file_group(user, [path], str(uuid.uuid4()))
        return Photo.objects.get(pk=photo.pk)

    def selected(self, path, *others):
        """The paths of ``path``'s group the next incremental scan reads."""
        walked = sorted(
            {p for f in (path, *others) for p in (f, *existing_sidecars(f))}
        )
        groups, _ = _partition_scan_paths(walked)
        chosen = _select_groups_to_process(
            list(groups.items()), _known_paths, False, self.baseline
        )
        return sorted(p for _, paths in chosen for p in paths)

    def record_of(self, path):
        row = File.objects.get(path=path)
        return indexed_mtimes.recorded(row.indexed_mtime_ns, row.indexed_sidecar_mtimes)

    def target(self, path, mode):
        return self.sidecar_of(path) if mode == SIDECAR else path

    # ---- the scan records what it read --------------------------------------

    def test_the_scan_records_what_it_read(self):
        photo = self.indexed_photo(SIDECAR)
        path = photo.main_file.path

        self.assertEqual(indexed_mtimes.observe(path), self.record_of(path))
        self.assertEqual([], self.selected(path))

    def test_a_read_that_failed_records_nothing(self):
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        path = self.make_image(".jpg", "unreadable")
        self.photo_for(path, user)

        with patch(f"{HANDLERS}._process_photo", side_effect=OSError("gone")):
            handle_file_group(user, [path], str(uuid.uuid4()))

        self.assertIsNone(self.record_of(path))

    def test_an_upload_records_what_it_read(self):
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        path = self.make_image(".jpg", "uploaded")
        photo = self.photo_for(path, user)

        handle_new_image(user, path, str(uuid.uuid4()), photo)

        self.assertEqual(indexed_mtimes.observe(path), self.record_of(path))

    # ---- LibrePhotos' own writes ---------------------------------------------

    def test_a_rating_write_is_not_a_change(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self.indexed_photo(mode)
                path = photo.main_file.path
                before = os.stat(path).st_mtime_ns

                write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)

                self.assertWritesLanded()
                # A media-file write moves the original's modification time,
                # so a backup tool sees the change (no -P); only the scan
                # knows it was LibrePhotos'.
                self.assertEqual(
                    mode == MEDIA_FILE, before != os.stat(path).st_mtime_ns
                )
                self.assertEqual([], self.selected(path))
                self.assertEqual(indexed_mtimes.observe(path), self.record_of(path))

    def test_the_file_keeps_the_hash_of_the_photo(self):
        # Re-keying the File in the writer would leave Photo.image_hash on the
        # old hash, after which a real replacement goes unnoticed (#2051).
        # The File keeps the hash it was read under until a scan reads the
        # file again, as Photo.image_hash does.
        photo = self.indexed_photo(MEDIA_FILE)
        path = photo.main_file.path
        file_hash = photo.main_file.hash

        write_photo_ratings([photo.id], use_sidecar=False)

        self.assertEqual(file_hash, File.objects.get(path=path).hash)

    def test_a_rotation_is_not_a_change(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self.indexed_photo(mode, "rotated", thumbnails=True)
                path = photo.main_file.path

                self.assertIsNone(rotate_photo(photo, CLOCKWISE))

                self.assertWritesLanded()
                self.assertEqual([], self.selected(path))

    def test_an_edit_by_another_app_after_the_write_is_a_change(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self.indexed_photo(mode, "edited-after")
                path = photo.main_file.path
                write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)

                self.tag(self.target(path, mode), "-XMP-dc:Title=Elsewhere")

                self.assertIn(path, self.selected(path))

    def test_an_edit_by_another_app_before_the_write_is_still_a_change(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self.indexed_photo(mode, "edited-before")
                path = photo.main_file.path
                self.tag(self.target(path, mode), "-XMP-dc:Title=Elsewhere")

                write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)

                self.assertIn(path, self.selected(path))

    def test_a_sidecar_shared_by_two_files_of_the_photo_is_not_a_change(self):
        # IMG.xmp, the name LibrePhotos wrote up to 1.3.0, describes IMG.jpg
        # and IMG.png alike, so the write changes what both of them recorded.
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        jpeg = self.make_image(".jpg", "pair")
        png = self.make_image(".png", "pair")
        shared = os.path.splitext(jpeg)[0] + ".xmp"
        self.tag(shared, "-XMP-dc:Title=Old")
        photo = self.photo_for(jpeg, user, rating=4)
        self.baseline = SimpleNamespace(started_at=timezone.now())
        handle_file_group(user, [jpeg, png, shared], str(uuid.uuid4()))

        write_photo_ratings([photo.id], use_sidecar=True)

        self.assertEqual(shared, self.exiftool.writes[-1].target)
        self.assertEqual([], self.selected(jpeg, png))

    def test_a_sidecar_another_app_adds_is_a_change(self):
        photo = self.indexed_photo(MEDIA_FILE, "new-sidecar")
        path = photo.main_file.path

        self.tag(path + ".xmp", "-XMP-dc:Title=Elsewhere")

        self.assertEqual([path, path + ".xmp"], self.selected(path))

    def test_a_failed_write_records_nothing(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self.indexed_photo(mode, "failed")
                path = photo.main_file.path
                record = self.record_of(path)
                target = self.target(path, mode)

                def half_written(media_file, tags, use_sidecar=True, options=()):
                    # ExifTool changed the file, then reported an error.
                    with open(target, "ab") as handle:
                        handle.write(b"\0")
                    raise MetadataWriteError(target, "Error: half written")

                with patch(
                    "api.metadata.photo_writer.write_metadata",
                    side_effect=half_written,
                ):
                    self.assertEqual(
                        1, write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)
                    )

                self.assertEqual(record, self.record_of(path))
                self.assertIn(path, self.selected(path))

    # ---- libraries indexed before the record existed -------------------------

    def forget_record(self, path):
        File.objects.filter(path=path).update(
            indexed_mtime_ns=None, indexed_sidecar_mtimes=None
        )

    def test_without_a_record_a_write_is_a_change_as_before(self):
        photo = self.indexed_photo(SIDECAR, "unrecorded")
        path = photo.main_file.path
        self.forget_record(path)

        write_photo_ratings([photo.id], use_sidecar=True)

        self.assertIsNone(self.record_of(path))
        self.assertEqual([path, self.sidecar_of(path)], self.selected(path))

    def test_an_unchanged_file_gets_its_record_on_the_next_scan(self):
        photo = self.indexed_photo(SIDECAR, "backfilled")
        path = photo.main_file.path
        self.forget_record(path)
        hour_ago = (timezone.now() - datetime.timedelta(hours=1)).timestamp()
        os.utime(path, (hour_ago, hour_ago))

        self.assertEqual([], self.selected(path))
        self.assertEqual(indexed_mtimes.observe(path), self.record_of(path))

        write_photo_ratings([photo.id], use_sidecar=True)

        self.assertEqual([], self.selected(path))

    def test_a_file_changed_after_the_baseline_gets_no_record(self):
        photo = self.indexed_photo(SIDECAR, "changed-unrecorded")
        path = photo.main_file.path
        self.forget_record(path)
        self.tag(path, f"-{Tags.RATING}=2")

        self.assertEqual([path], self.selected(path))
        self.assertIsNone(self.record_of(path))
