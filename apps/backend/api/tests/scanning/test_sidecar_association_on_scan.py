"""Sidecar (XMP) association during scanning.

Covers two layers of the same guarantee: that metadata sidecars end up linked to
the right Photo even when the filesystem hands files back in a shuffled order.

* ``XMPAssociationTest`` drives ``create_new_image`` directly, the path uploads
  and orphan sidecars (whose photo is not part of the scan) take.
* ``SidecarsSurviveSlowIngestTest`` runs ``scan_photos`` against a django-q
  double where the image groups finish last, pinning that a sidecar is never
  dropped because its photo was still being ingested.
"""

import os
import random
import struct
import tempfile
import uuid
import zlib
from collections import defaultdict, deque
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import create_new_image
from api.models import LongRunningJob, Photo
from api.tests.utils import create_test_user


def create_unique_png(seed=0):
    """Generate a minimal valid PNG whose bytes (and hash) vary with the seed."""

    def png_chunk(chunk_type, data):
        chunk_data = chunk_type + data
        crc = 0xFFFFFFFF
        for byte in chunk_data:
            crc ^= byte
            for _ in range(8):
                crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1
        crc ^= 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_data + struct.pack(">I", crc)

    png_sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat_compressed = zlib.compress(bytes([seed % 256]) + b"\x00\x00\x00\x00\x00")
    iend = b""

    return (
        png_sig
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat_compressed)
        + png_chunk(b"IEND", iend)
    )


class XMPAssociationTest(TestCase):
    """
    Test that metadata files (XMP sidecars) are correctly associated with photos.

    This test validates the core logic without async complexity by directly calling
    create_new_image for both images and metadata files.
    """

    def test_xmp_association_after_image_creation(self):
        """
        Test that XMP files are correctly associated when processed after their images.

        This test simulates sidecars reaching create_new_image after their images:
        - Files arrive in random mixed order from directory scanning
        - Images are processed first, then metadata

        We verify that even when files are discovered in random order (e.g., XMP before image),
        the separation and ordering logic ensures correct association.
        """
        user = create_test_user()

        with tempfile.TemporaryDirectory() as tmpdir:
            N = 4
            all_files = []  # Mixed list simulating random directory scan order

            # Create test files with unique images
            for i in range(N):
                base = f"img_{i}"
                img_path = os.path.join(tmpdir, f"{base}.jpg")
                xmp_path = os.path.join(tmpdir, f"{base}.xmp")

                with open(img_path, "wb") as f:
                    f.write(create_unique_png(i))  # Each image has unique hash
                with open(xmp_path, "wb") as f:
                    f.write(b"<x:xmpmeta>test</x:xmpmeta>")

                # Add to mixed list (will be shuffled to simulate random discovery)
                all_files.append(("image", img_path))
                all_files.append(("xmp", xmp_path))

            # Shuffle to simulate random file system ordering
            # This is the key: files can be discovered in ANY order
            random.shuffle(all_files)

            # Example of what the shuffled order might look like:
            # [('xmp', '.../img_2.xmp'), ('image', '.../img_0.jpg'), ('xmp', '.../img_1.xmp'), ...]
            # This simulates the real problem: XMP files may be discovered before their images!

            # Separate into images and metadata (simulating what scan_photos does)
            from api.models.file import is_metadata

            image_paths = [path for ftype, path in all_files if not is_metadata(path)]
            xmp_paths = [path for ftype, path in all_files if is_metadata(path)]

            # Verify separation happened correctly
            self.assertEqual(len(image_paths), N, "Should have N images")
            self.assertEqual(len(xmp_paths), N, "Should have N XMP files")

            # Mock pyvips to accept our test images
            with patch("api.image_decoding.thumbnail"):
                # Process images first
                for img_path in image_paths:
                    photo = create_new_image(user, img_path)
                    self.assertIsNotNone(
                        photo, f"Photo should be created for {img_path}"
                    )

                # Then process XMP files
                for xmp_path in xmp_paths:
                    create_new_image(user, xmp_path)

            # Validate: all photos should have their XMP sidecars
            photos = list(Photo.objects.filter(owner=user))
            self.assertEqual(len(photos), N, "All images should produce Photo objects")

            for photo in photos:
                xmp_files = list(photo.files.filter(path__endswith=".xmp"))
                base = os.path.splitext(os.path.basename(photo.main_file.path))[0]
                self.assertEqual(
                    len(xmp_files),
                    1,
                    f"Photo {base} should have exactly 1 XMP sidecar, got {len(xmp_files)}",
                )

    def test_xmp_processed_before_image_fails_gracefully(self):
        """
        Test that XMP files processed before their images are handled gracefully.

        A sidecar whose photo does not exist yet has nothing to attach to.
        The XMP should not be associated (logged as warning) and later when the
        image is processed, it won't automatically pick up the orphaned XMP.
        """
        user = create_test_user()

        with tempfile.TemporaryDirectory() as tmpdir:
            img_path = os.path.join(tmpdir, "test_img.jpg")
            xmp_path = os.path.join(tmpdir, "test_img.xmp")

            with open(img_path, "wb") as f:
                f.write(create_unique_png(100))  # Use seed 100 for this test
            with open(xmp_path, "wb") as f:
                f.write(b"<x:xmpmeta>test</x:xmpmeta>")

            with patch("api.image_decoding.thumbnail"):
                # Process XMP first (the scan avoids this by grouping it with its photo)
                result_xmp = create_new_image(user, xmp_path)
                self.assertIsNone(result_xmp, "XMP without photo should return None")

                # Now process the image
                photo = create_new_image(user, img_path)
                self.assertIsNotNone(photo, "Photo should be created")

                # The XMP won't be auto-associated (this is expected without rescan)
                xmp_files = list(photo.files.filter(path__endswith=".xmp"))
                self.assertEqual(
                    len(xmp_files),
                    0,
                    "XMP processed before image won't be auto-associated",
                )


class SlowIngestQueue:
    """Stand-in for ``AsyncTask`` modelling a busy django-q cluster.

    Tasks queued in a django-q ``group`` (the scan's image groups) only finish
    after every ungrouped task has run: the worst case where the workers pick
    up the metadata work while the photos it belongs to are still being
    ingested. ``count_group`` reports the grouped tasks finished so far.
    """

    def __init__(self):
        self.grouped = deque()
        self.ungrouped = deque()
        self.completed = defaultdict(int)

    def __call__(self, func, *args, **kwargs):
        return _QueuedTask(self, func, args, kwargs)

    def count_group(self, group_id, *args, **kwargs):
        return self.completed[group_id]

    def drain(self):
        while self.ungrouped or self.grouped:
            if self.ungrouped:
                func, args, kwargs, _group = self.ungrouped.popleft()
                func(*args, **kwargs)
                continue
            func, args, kwargs, group = self.grouped.popleft()
            func(*args, **kwargs)
            self.completed[group] += 1


class _QueuedTask:
    def __init__(self, queue, func, args, kwargs):
        self.queue = queue
        self.group = kwargs.pop("group", None)
        self.entry = (func, args, kwargs, self.group)

    def run(self):
        target = self.queue.grouped if self.group else self.queue.ungrouped
        target.append(self.entry)


class SidecarsSurviveSlowIngestTest(TestCase):
    """A sidecar whose photo is still being ingested must not be dropped."""

    def test_sidecars_link_to_their_photos_when_ingest_lags_behind(self):
        user = create_test_user()
        with (
            tempfile.TemporaryDirectory() as scan_dir,
            tempfile.TemporaryDirectory() as media_root,
        ):
            user.scan_directory = scan_dir
            user.save(update_fields=["scan_directory"])

            expected = {}  # image path -> sidecar path
            for i in range(4):
                img_path = os.path.join(scan_dir, f"img_{i}.jpg")
                # Both naming conventions: img_0.xmp and img_1.jpg.xmp.
                xmp_name = f"img_{i}.jpg.xmp" if i % 2 else f"img_{i}.xmp"
                xmp_path = os.path.join(scan_dir, xmp_name)
                with open(img_path, "wb") as f:
                    f.write(create_unique_png(i))
                with open(xmp_path, "wb") as f:
                    # Distinct bytes: File rows are keyed by content hash.
                    f.write(f"<x:xmpmeta>{i}</x:xmpmeta>".encode())
                expected[img_path] = xmp_path
            # A sidecar whose photo is not in the scan is queued on its own and
            # must still count toward the job finishing.
            with open(os.path.join(scan_dir, "lonely.xmp"), "wb") as f:
                f.write(b"<x:xmpmeta>lonely</x:xmpmeta>")

            queue = SlowIngestQueue()
            with override_settings(MEDIA_ROOT=media_root):
                with (
                    patch("api.directory_watcher.scan_jobs.AsyncTask", queue),
                    patch("django_q.tasks.count_group", queue.count_group),
                    patch(
                        "api.directory_watcher.scan_jobs._queue_followup_jobs"
                    ) as followups,
                    patch("api.directory_watcher.scan_jobs.db.connections.close_all"),
                    patch("api.image_decoding.thumbnail"),
                    patch("api.models.thumbnail.Thumbnail._generate_thumbnail"),
                    patch("api.models.thumbnail.Thumbnail._calculate_aspect_ratio"),
                    patch("api.models.thumbnail.Thumbnail._get_dominant_color"),
                    patch("api.models.photo_metadata.PhotoMetadata.extract_exif_data"),
                    patch("api.models.photo.Photo._extract_date_time_from_exif"),
                ):
                    from api.directory_watcher import scan_photos

                    job_id = str(uuid.uuid4())
                    scan_photos(user, False, job_id)
                    queue.drain()

            photos = list(Photo.objects.filter(owner=user))
            self.assertEqual(len(photos), len(expected))
            linked = {
                p.main_file.path: sorted(
                    p.files.filter(path__iendswith=".xmp").values_list(
                        "path", flat=True
                    )
                )
                for p in photos
            }
            self.assertEqual(
                linked, {img: [xmp] for img, xmp in expected.items()}, linked
            )

            job = LongRunningJob.objects.get(job_id=job_id)
            # 4 file groups (sidecars included) + 1 orphan sidecar
            self.assertEqual(job.progress_target, len(expected) + 1)
            self.assertEqual(job.progress_current, job.progress_target)
            self.assertTrue(job.finished)
            followups.assert_called_once()
