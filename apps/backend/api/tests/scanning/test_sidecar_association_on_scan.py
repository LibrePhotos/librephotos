"""Sidecar (XMP) association during scanning.

Covers two layers of the same guarantee: that metadata sidecars end up linked to
the right Photo even when the filesystem hands files back in a shuffled order.

* ``XMPAssociationTest`` drives ``create_new_image`` directly, verifying the
  image-before-metadata ordering the scan sentinel is responsible for producing.
* ``MetadataOrderingSentinelTest`` exercises the real async sequencing --
  ``handle_new_image`` in a group followed by
  ``wait_for_group_and_process_metadata`` -- with django-q replaced by
  synchronous doubles.
"""

import os
import random
import struct
import tempfile
import uuid
import zlib
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import create_new_image
from api.models import Photo
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

        This test simulates the real scenario that the sentinel handles:
        - Files arrive in random mixed order from directory scanning
        - The sentinel logic separates them into images and metadata
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
            with patch("pyvips.Image.thumbnail"):
                # Process images first (simulating what the sentinel ensures)
                # This is the critical ordering that the sentinel guarantees
                for img_path in image_paths:
                    photo = create_new_image(user, img_path)
                    self.assertIsNotNone(
                        photo, f"Photo should be created for {img_path}"
                    )

                # Then process XMP files (after sentinel waits for image group completion)
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

        Without the sentinel ordering, this would be the problematic scenario.
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

            with patch("pyvips.Image.thumbnail"):
                # Process XMP first (the problematic order that sentinel prevents)
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


class DummyAsyncTask:
    """Synchronous replacement for django_q.tasks.AsyncTask.

    - Immediately executes the callable.
    - Tracks completion counts per group id when used for image tasks.
    """

    GROUP_COMPLETIONS: dict[str, int] = {}

    def __init__(self, func, *args, **kwargs):
        self.func = func
        self.args = args
        # Extract 'group' from kwargs before passing to func (func doesn't accept it)
        self.group_id = kwargs.pop("group", None)
        self.kwargs = kwargs

    def run(self):
        # Execute the callable synchronously (without 'group' in kwargs)
        result = self.func(*self.args, **self.kwargs)

        # If this was an image/video task scheduled with a group,
        # increment the completion counter for that group
        func_name = getattr(self.func, "__name__", "")
        if self.group_id and func_name == "handle_new_image":
            DummyAsyncTask.GROUP_COMPLETIONS[self.group_id] = (
                DummyAsyncTask.GROUP_COMPLETIONS.get(self.group_id, 0) + 1
            )
        return result


class DummyChain:
    def __init__(self, *args, **kwargs):
        self.appended = []

    def append(self, *args, **kwargs):
        self.appended.append((args, kwargs))
        return self

    def run(self):
        return None


class MetadataOrderingSentinelTest(TestCase):
    def test_random_order_images_and_xmp_are_consistently_linked(self):
        user = create_test_user()
        with tempfile.TemporaryDirectory() as tmpdir:
            user.scan_directory = tmpdir
            user.save(update_fields=["scan_directory"])

            # Create N image files and corresponding XMP sidecars
            N = 4
            image_paths = []
            xmp_paths = []
            for i in range(N):
                base = f"img_{i}"
                img_path = os.path.join(tmpdir, f"{base}.jpg")
                xmp_path = os.path.join(tmpdir, f"{base}.xmp")
                with open(img_path, "wb") as f:
                    f.write(create_unique_png(i))  # Each image has unique hash
                with open(xmp_path, "wb") as f:
                    f.write(b"<x:xmpmeta>test</x:xmpmeta>")
                image_paths.append(img_path)
                xmp_paths.append(xmp_path)

            # Randomize processing order explicitly via scan_files
            all_files = image_paths + xmp_paths
            random.shuffle(all_files)

            # Patch environment to make processing synchronous and lightweight
            with override_settings(MEDIA_ROOT=tmpdir):
                with (
                    patch("api.directory_watcher.scan_jobs.AsyncTask", DummyAsyncTask),
                    patch("api.directory_watcher.scan_jobs.Chain", DummyChain),
                    patch(
                        "django_q.tasks.count_group",
                        side_effect=lambda gid: DummyAsyncTask.GROUP_COMPLETIONS.get(
                            gid, 0
                        ),
                    ),
                    patch(
                        "api.directory_watcher.scan_jobs.db.connections.close_all"
                    ) as _close_all,
                    patch(
                        "api.directory_watcher.scan_jobs.update_scan_counter"
                    ) as _update_counter,
                    patch("api.directory_watcher.scan_jobs.util.logger") as _logger,
                    patch("pyvips.Image.thumbnail") as _thumb,
                    patch(
                        "api.models.thumbnail.Thumbnail._generate_thumbnail"
                    ) as _gen_thumb,
                    patch(
                        "api.models.thumbnail.Thumbnail._calculate_aspect_ratio"
                    ) as _calc_ar,
                    patch(
                        "api.models.thumbnail.Thumbnail._get_dominant_color"
                    ) as _dom_color,
                    patch(
                        "api.models.photo_metadata.PhotoMetadata.extract_exif_data"
                    ) as _exif,
                    patch(
                        "api.models.photo.Photo._extract_date_time_from_exif"
                    ) as _exif_dt,
                ):
                    # No-op patches
                    _thumb.return_value = None
                    _close_all.return_value = None
                    _update_counter.side_effect = lambda *_args, **_kwargs: None
                    _logger.info.side_effect = lambda *_a, **_k: None
                    _logger.warning.side_effect = lambda *_a, **_k: None
                    _logger.exception.side_effect = lambda *_a, **_k: None
                    _gen_thumb.return_value = None
                    _calc_ar.return_value = None
                    _dom_color.return_value = None
                    _exif.return_value = None
                    _exif_dt.return_value = None

                    job_id = str(uuid.uuid4())
                    # Emulate the core of scan_photos sequencing explicitly:
                    # 1) Enqueue all images/videos in a group and run them synchronously
                    # 2) Run the sentinel to process metadata after the group completes
                    from api.directory_watcher import (
                        handle_new_image,
                        wait_for_group_and_process_metadata,
                    )

                    image_group_id = str(uuid.uuid4())
                    for img in image_paths:
                        DummyAsyncTask(
                            handle_new_image, user, img, job_id, group=image_group_id
                        ).run()

                    DummyAsyncTask(
                        wait_for_group_and_process_metadata,
                        image_group_id,
                        xmp_paths,
                        user.id,
                        False,
                        job_id,
                        len(image_paths),
                    ).run()

            # Validate: image tasks ran and each image must have its XMP associated to the same Photo
            total_completions = sum(DummyAsyncTask.GROUP_COMPLETIONS.values())
            self.assertEqual(
                total_completions,
                N,
                msg=f"Expected {N} image task completions, got {total_completions}",
            )

            photos = list(Photo.objects.all())
            self.assertEqual(
                len(photos), N, msg="All images should produce Photo objects"
            )

            # Build a map from image base name to whether an XMP is linked
            linked = {}
            for p in photos:
                # main_file.path is the image path
                main_path = p.main_file.path if p.main_file else ""
                base = os.path.splitext(os.path.basename(main_path))[0]
                xmp_list = list(
                    p.files.filter(path__endswith=".xmp").values_list("path", flat=True)
                )
                linked[base] = len(xmp_list) >= 1

            # All should be True
            self.assertTrue(
                all(linked.values()), msg=f"Some photos missing XMP: {linked}"
            )
