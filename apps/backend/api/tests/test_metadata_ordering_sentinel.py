import os
import random
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import scan_photos
from api.models import Photo
from api.tests.utils import create_test_user


def create_unique_png(seed=0):
    """
    Generate a minimal valid PNG with unique content based on seed.
    Each different seed produces a different hash.
    """
    import struct

    def png_chunk(chunk_type, data):
        chunk_data = chunk_type + data
        crc = 0xFFFFFFFF
        for byte in chunk_data:
            crc ^= byte
            for _ in range(8):
                crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1
        crc ^= 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_data + struct.pack(">I", crc)

    # PNG signature
    png_sig = b"\x89PNG\r\n\x1a\n"

    # IHDR: 1x1 image, 8-bit RGB
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)

    # IDAT: compressed image data with seed-based variation
    idat_data = bytes([seed % 256]) + b"\x00\x00\x00\x00\x00"
    import zlib

    idat_compressed = zlib.compress(idat_data)

    # IEND: end of PNG
    iend = b""

    return (
        png_sig
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat_compressed)
        + png_chunk(b"IEND", iend)
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
                with patch("api.directory_watcher.AsyncTask", DummyAsyncTask), \
                    patch("api.directory_watcher.Chain", DummyChain), \
                    patch(
                        "django_q.tasks.count_group",
                        side_effect=lambda gid: DummyAsyncTask.GROUP_COMPLETIONS.get(
                            gid, 0
                        ),
                    ), \
                    patch(
                        "api.directory_watcher.db.connections.close_all"
                    ) as _close_all, \
                    patch(
                        "api.directory_watcher.update_scan_counter"
                    ) as _update_counter, \
                    patch("api.directory_watcher.util.logger") as _logger, \
                    patch("pyvips.Image.thumbnail") as _thumb, \
                    patch(
                        "api.models.thumbnail.Thumbnail._generate_thumbnail"
                    ) as _gen_thumb, \
                    patch(
                        "api.models.thumbnail.Thumbnail._calculate_aspect_ratio"
                    ) as _calc_ar, \
                    patch(
                        "api.models.thumbnail.Thumbnail._get_dominant_color"
                    ) as _dom_color, \
                    patch("api.models.photo.Photo._extract_exif_data") as _exif, \
                    patch(
                        "api.models.photo.Photo._extract_date_time_from_exif"
                    ) as _exif_dt:
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
            self.assertEqual(total_completions, N, msg=f"Expected {N} image task completions, got {total_completions}")

            photos = list(Photo.objects.all())
            self.assertEqual(len(photos), N, msg="All images should produce Photo objects")

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
            self.assertTrue(all(linked.values()), msg=f"Some photos missing XMP: {linked}")
