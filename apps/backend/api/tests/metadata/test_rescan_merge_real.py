"""How a rescan merges the file with edits made in LibrePhotos, read with
real ExifTool through the exif service, as a scan reads them (the rules are
in ``test_rescan_merge``).

A sidecar's keyword list replaces the photo's own keywords (#2772).

Each tag comes from the highest-priority file that has it, so without this a
sidecar's ``XMP-dc:Subject`` replaced the photo's embedded one while the
photo's ``IPTC:Keywords``, which an ``.xmp`` cannot hold, were still added.
"""

import os

from api.metadata import edits
from api.metadata.photo_reader import extract_exif_data
from api.models.photo import Photo
from api.models.photo_metadata import PhotoMetadata
from api.models.tag import Tag
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user


class SidecarKeywordsTest(RealExifToolTestCase):
    def setUp(self):
        super().setUp()
        self.user = create_test_user()
        self.path = self.make_image(".jpg", "IMG")
        self.tag(
            self.path,
            "-EXIF:Model=Test Cam",
            "-XMP-dc:Subject=beach",
            "-XMP-dc:Subject=2019",
            "-IPTC:Keywords=family",
        )

    def sidecar(self, *arguments):
        """``IMG.xmp`` (Lightroom's name) with ``arguments`` written into it."""
        sidecar = os.path.splitext(self.path)[0] + ".xmp"
        self.tag(sidecar, *arguments)
        return sidecar

    def scan(self):
        photo = self.photo_for(self.path, self.user)
        extract_exif_data(photo, commit=True)
        metadata = PhotoMetadata.objects.get(photo=photo)
        tags = sorted(
            Tag.objects.owned_by(self.user)
            .filter(photos=photo)
            .values_list("name", flat=True)
        )
        return metadata, tags

    def test_the_sidecar_list_is_the_photos_whole_list(self):
        self.sidecar("-XMP-dc:Subject=holiday")

        metadata, tags = self.scan()

        self.assertEqual(["holiday"], metadata.keywords)
        self.assertEqual(["holiday"], tags)

    def test_without_a_sidecar_the_embedded_keywords_merge(self):
        metadata, tags = self.scan()

        self.assertEqual(["2019", "beach", "family"], metadata.keywords)
        self.assertEqual(["2019", "beach", "family"], tags)

    def test_a_sidecar_without_keywords_keeps_the_embedded_ones(self):
        self.sidecar("-XMP-xmp:Rating=3")

        metadata, _ = self.scan()

        self.assertEqual(["2019", "beach", "family"], metadata.keywords)
        self.assertEqual(3, metadata.file_rating)

    def test_a_sidecar_hierarchy_alone_replaces_them_too(self):
        self.sidecar("-XMP-lr:HierarchicalSubject=Places|Portugal|Lisbon")

        metadata, _ = self.scan()

        self.assertEqual(["Lisbon"], metadata.keywords)

    def test_other_fields_are_read_as_before(self):
        self.sidecar("-XMP-dc:Subject=holiday")

        metadata, _ = self.scan()

        self.assertEqual("Test Cam", metadata.camera_model)


class RatingRescanRealTest(RealExifToolTestCase):
    """#2771 with "Write edits to files" Off: the file's ``Rating`` wins only
    when it changed since the last read."""

    def test_a_favorite_survives_until_the_file_changes(self):
        user = create_test_user()
        path = self.make_image(".jpg", "rated")
        self.tag(path, "-XMP-xmp:Rating=0")
        photo = self.photo_for(path, user)
        extract_exif_data(photo, commit=True)

        edits.set_rating(Photo.objects.filter(pk=photo.pk), 5, user)
        extract_exif_data(self.photo_for_rescan(photo), commit=True)
        self.assertEqual(5, Photo.objects.get(pk=photo.pk).rating)

        self.tag(path, "-XMP-xmp:Rating=3")
        extract_exif_data(self.photo_for_rescan(photo), commit=True)
        self.assertEqual(3, Photo.objects.get(pk=photo.pk).rating)

    def photo_for_rescan(self, photo):
        return Photo.objects.select_related("main_file", "owner").get(pk=photo.pk)
