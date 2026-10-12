"""A RAW pairs with its HEIF, AVIF, JPEG XL or WebP sibling (#2339).

The scan has always grouped files by folder and stem whatever their extension,
but ``find_matching_jpeg_photo`` (uploads and the repair job that follows every
scan) only tried seven extensions in two spellings. A RAW next to a ``.hif``,
``.avif``, ``.jxl`` or ``.webp`` that was not in the same scan therefore stayed
a photo of its own. The pairing set now lives in ``api.mime`` and includes
them, in lower and upper case.

The rescan tests pin what an existing library sees after the upgrade: the
first rescan merges such a RAW-only photo into its image's photo (the RAW and
its sidecar move over, the RAW-only photo is deleted), and nothing is
duplicated or lost on that or any later rescan.
"""

import datetime
import os
import shutil
import tempfile
import uuid
from unittest.mock import patch

import pyvips
from django.test import TestCase

from api.directory_watcher.file_grouping import (
    find_matching_image_for_video,
    find_matching_jpeg_photo,
)
from api.directory_watcher.file_handlers import handle_file_group
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.directory_watcher.scan_jobs import _partition_scan_paths
from api.models import File, Photo, User
from api.photos.media_files import get_or_create_file
from api.tests.utils import create_test_user

MODULE = "api.directory_watcher.file_handlers"


class _LibraryTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.directory = tempfile.mkdtemp(prefix="lp-raw-pair-")
        self.addCleanup(shutil.rmtree, self.directory, True)

    def write(self, name: str, content: bytes | None = None) -> str:
        path = os.path.join(self.directory, name)
        with open(path, "wb") as handle:
            handle.write(content if content is not None else name.encode())
        return path

    def photo_of(
        self, files: list[File], pk: uuid.UUID | None = None, user: User | None = None
    ) -> Photo:
        """A Photo as an earlier scan left it: the first file is the main one."""
        photo = Photo(
            pk=pk or uuid.uuid4(),
            owner=user or self.user,
            image_hash=files[0].hash,
            added_on=datetime.datetime.now(datetime.timezone.utc),
            geolocation_json={},
        )
        photo.save()
        photo.files.add(*files)
        photo.main_file = files[0]
        photo.save()
        return photo


class RawPairsWithModernFormatsTest(_LibraryTestCase):
    def test_a_raw_pairs_with_an_upper_case_hif(self) -> None:
        image = get_or_create_file(self.write("DSC_0001.HIF"), self.user)
        photo = self.photo_of([image])
        self.assertEqual(
            find_matching_jpeg_photo(
                os.path.join(self.directory, "DSC_0001.ARW"), self.user
            ),
            photo,
        )

    def test_every_modern_format_in_either_case(self) -> None:
        for name in ("A.avif", "B.AVIF", "C.jxl", "D.JXL", "E.webp", "F.WEBP", "G.hif"):
            with self.subTest(name):
                photo = self.photo_of([get_or_create_file(self.write(name), self.user)])
                stem = os.path.splitext(name)[0]
                raw_path = os.path.join(self.directory, f"{stem}.CR3")
                self.assertEqual(find_matching_jpeg_photo(raw_path, self.user), photo)

    def test_the_stem_must_match_exactly(self) -> None:
        self.photo_of([get_or_create_file(self.write("img_0001.jpg"), self.user)])
        self.photo_of([get_or_create_file(self.write("IMG_0001.extra.jpg"), self.user)])
        raw_path = os.path.join(self.directory, "IMG_0001.CR2")
        self.assertIsNone(find_matching_jpeg_photo(raw_path, self.user))

    def test_a_sibling_in_another_folder_does_not_pair(self) -> None:
        os.mkdir(os.path.join(self.directory, "sub"))
        self.photo_of(
            [get_or_create_file(self.write(os.path.join("sub", "IMG.jpg")), self.user)]
        )
        raw_path = os.path.join(self.directory, "IMG.CR2")
        self.assertIsNone(find_matching_jpeg_photo(raw_path, self.user))

    def test_a_format_outside_the_pairing_set_does_not_pair(self) -> None:
        self.photo_of([get_or_create_file(self.write("IMG.gif"), self.user)])
        raw_path = os.path.join(self.directory, "IMG.CR2")
        self.assertIsNone(find_matching_jpeg_photo(raw_path, self.user))

    def test_another_users_photo_does_not_pair(self) -> None:
        other = create_test_user()
        self.photo_of([get_or_create_file(self.write("IMG.webp"), other)], user=other)
        raw_path = os.path.join(self.directory, "IMG.CR2")
        self.assertIsNone(find_matching_jpeg_photo(raw_path, self.user))

    def test_the_first_sibling_by_path_wins(self) -> None:
        jpeg = self.photo_of(
            [get_or_create_file(self.write("IMG.jpg", b"j"), self.user)]
        )
        self.photo_of([get_or_create_file(self.write("IMG.webp", b"w"), self.user)])
        raw_path = os.path.join(self.directory, "IMG.CR2")
        self.assertEqual(find_matching_jpeg_photo(raw_path, self.user), jpeg)

    def test_a_live_photo_video_pairs_in_either_case(self) -> None:
        photo = self.photo_of([get_or_create_file(self.write("IMG_1.HEIC"), self.user)])
        for name in ("IMG_1.mov", "IMG_1.MOV"):
            with self.subTest(name):
                video_path = os.path.join(self.directory, name)
                self.assertEqual(
                    find_matching_image_for_video(video_path, self.user), photo
                )

    def test_only_a_mov_is_a_live_photo_video(self) -> None:
        self.photo_of([get_or_create_file(self.write("IMG_1.HEIC"), self.user)])
        video_path = os.path.join(self.directory, "IMG_1.mp4")
        self.assertIsNone(find_matching_image_for_video(video_path, self.user))


class RescanOfAnExistingLibraryTest(_LibraryTestCase):
    """What the first rescans after the upgrade do to an unpaired WebP + RAW."""

    def setUp(self) -> None:
        super().setUp()
        self.image_path = os.path.join(self.directory, "IMG_0001.webp")
        pyvips.Image.black(8, 8).write_to_file(self.image_path)
        self.raw_path = self.write("IMG_0001.CR2", b"raw-bytes")
        self.sidecar_path = self.write("IMG_0001.xmp", b"<x:xmpmeta/>")
        # Thumbnails, EXIF and the rest of the processing are not under test.
        for target in ("_process_photo", "has_embedded_motion_video"):
            patcher = patch(f"{MODULE}.{target}", return_value=False)
            patcher.start()
            self.addCleanup(patcher.stop)

    def unpaired_library(self, image_first: bool) -> None:
        """The WebP and the RAW as two photos, the RAW carrying the sidecar.

        That is what a library holds when the RAW was uploaded after the WebP,
        or scanned in a different scan: the old pairing set had no ``.webp``,
        so the repair job never merged them. ``image_first`` decides which of
        the two photos the database returns first.
        """
        image = get_or_create_file(self.image_path, self.user)
        raw = get_or_create_file(self.raw_path, self.user)
        sidecar = get_or_create_file(self.sidecar_path, self.user)
        first, second = uuid.UUID(int=1), uuid.UUID(int=2)
        self.photo_of([image], pk=first if image_first else second)
        self.photo_of([raw, sidecar], pk=second if image_first else first)

    def incremental_rescan(self) -> None:
        # Every path is known, so no file group is processed; the scan's
        # follow-ups still run the repair job.
        repair_ungrouped_file_variants(self.user, uuid.uuid4())

    def full_rescan(self) -> None:
        # As scan_photos does with full_scan: every group again, then the
        # follow-ups.
        groups, sidecars = _partition_scan_paths(
            [self.image_path, self.raw_path, self.sidecar_path]
        )
        self.assertEqual(sidecars, [])
        for paths in groups.values():
            handle_file_group(self.user, paths, "job")
        repair_ungrouped_file_variants(self.user, uuid.uuid4())

    def assert_one_photo_with_every_variant(self) -> None:
        photo = Photo.objects.owned_by(self.user).get()
        self.assertEqual(photo.main_file.path, self.image_path)
        self.assertEqual(
            sorted(photo.files.values_list("path", flat=True)),
            sorted([self.image_path, self.raw_path, self.sidecar_path]),
        )
        self.assertEqual(File.objects.count(), 3)

    def test_an_incremental_rescan_merges_the_raw_photo(self) -> None:
        self.unpaired_library(image_first=True)
        self.incremental_rescan()
        self.assert_one_photo_with_every_variant()
        self.incremental_rescan()
        self.assert_one_photo_with_every_variant()

    def test_an_incremental_rescan_merges_the_raw_photo_listed_first(self) -> None:
        self.unpaired_library(image_first=False)
        self.incremental_rescan()
        self.assert_one_photo_with_every_variant()

    def test_a_full_rescan_merges_the_raw_photo(self) -> None:
        self.unpaired_library(image_first=True)
        self.full_rescan()
        self.assert_one_photo_with_every_variant()
        self.full_rescan()
        self.assert_one_photo_with_every_variant()

    def test_a_full_rescan_merges_the_raw_photo_listed_first(self) -> None:
        self.unpaired_library(image_first=False)
        self.full_rescan()
        self.assert_one_photo_with_every_variant()
        self.full_rescan()
        self.assert_one_photo_with_every_variant()

    def test_an_already_paired_photo_is_left_as_it_is(self) -> None:
        # A WebP and RAW scanned together were always one photo.
        groups, _ = _partition_scan_paths(
            [self.image_path, self.raw_path, self.sidecar_path]
        )
        for paths in groups.values():
            handle_file_group(self.user, paths, "job")
        photo = Photo.objects.owned_by(self.user).get()
        self.incremental_rescan()
        self.full_rescan()
        self.assert_one_photo_with_every_variant()
        self.assertEqual(Photo.objects.owned_by(self.user).get().pk, photo.pk)
