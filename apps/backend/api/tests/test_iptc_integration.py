"""
Integration test for IPTC keyword extraction.

Tests the full pipeline of reading IPTC:Keywords and XMP:Subject from a
real JPEG file (api/tests/fixtures/iptc_test.jpg) using exiftool,
storing them in PhotoMetadata.keywords, and indexing them in
PhotoSearch.search_captions.

The test fixture iptc_test.jpg contains:
  - IPTC:Keywords = ["vacation", "beach", "sunset"]
  - XMP:Subject   = ["vacation", "beach", "nature"]

After merging and deduplication the expected keywords are:
  ["beach", "nature", "sunset", "vacation"]   (sorted)
"""

import os
import shutil
import uuid

import exiftool
from django.test import TestCase
from django.utils import timezone
from unittest.mock import patch

from api.models import File, Photo
from api.models.photo_metadata import PhotoMetadata
from api.models.photo_search import PhotoSearch
from api.models.thumbnail import Thumbnail
from api.tests.utils import create_test_user

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
IPTC_TEST_IMAGE = os.path.join(FIXTURES_DIR, "iptc_test.jpg")

# Expected keywords in the fixture
IPTC_KEYWORDS = {"vacation", "beach", "sunset"}
XMP_SUBJECT = {"vacation", "beach", "nature"}
ALL_KEYWORDS_SORTED = sorted(IPTC_KEYWORDS | XMP_SUBJECT)


def _exiftool_get_metadata(media_file, tags, try_sidecar=True, struct=False):
    """Call exiftool directly, bypassing the HTTP service.

    This mirrors the behaviour of ``service/exif/main.py`` but runs
    in-process so that tests do not need the Flask micro-service.
    """
    from api.metadata.reader import _get_existing_metadata_files_reversed

    files = _get_existing_metadata_files_reversed(media_file, try_sidecar)

    et = exiftool.ExifTool()
    if not et.running:
        et.start()

    values = []
    try:
        for tag in tags:
            value = None
            for f in files:
                retrieved = et.get_tag(tag, f)
                if retrieved is not None:
                    value = retrieved
            values.append(value)
    finally:
        et.terminate()

    return values


class IPTCKeywordIntegrationTest(TestCase):
    """End-to-end test: real JPEG → exiftool → PhotoMetadata → search index."""

    def setUp(self):
        self.user = create_test_user()
        # Copy the fixture to /tmp so the test does not modify the repo fixture
        self.tmp_name = str(uuid.uuid4())
        self.tmp_path = f"/tmp/{self.tmp_name}.jpg"
        shutil.copy2(IPTC_TEST_IMAGE, self.tmp_path)

        # Build a Photo with a real File pointing at the fixture copy
        pk = uuid.uuid4()
        image_hash = self.tmp_name[:32]
        self.photo = Photo(pk=pk, image_hash=image_hash, owner=self.user)
        file_obj = File.create(self.tmp_path, self.user)
        self.photo.main_file = file_obj
        self.photo.added_on = timezone.now()
        self.photo.save()

        # Thumbnail is required by some codepaths
        Thumbnail.objects.create(
            photo=self.photo,
            thumbnail_big=f"thumbnails_big/{image_hash}.webp",
            aspect_ratio=1.0,
        )

    def tearDown(self):
        if os.path.exists(self.tmp_path):
            os.remove(self.tmp_path)

    # -- helpers ----------------------------------------------------------

    def _extract_with_real_exiftool(self):
        """Run extract_exif_data with exiftool instead of the HTTP service."""
        with patch(
            "api.models.photo_metadata.get_metadata",
            side_effect=_exiftool_get_metadata,
        ):
            return PhotoMetadata.extract_exif_data(self.photo, commit=True)

    # -- tests ------------------------------------------------------------

    def test_fixture_has_expected_tags(self):
        """Sanity-check: the fixture JPEG contains the expected metadata."""
        et = exiftool.ExifTool()
        et.start()
        try:
            xmp = et.get_tag("XMP:Subject", self.tmp_path)
            iptc = et.get_tag("IPTC:Keywords", self.tmp_path)
        finally:
            et.terminate()

        self.assertIsInstance(xmp, list)
        self.assertIsInstance(iptc, list)
        self.assertEqual(set(xmp), XMP_SUBJECT)
        self.assertEqual(set(iptc), IPTC_KEYWORDS)

    def test_extract_exif_data_reads_iptc_keywords(self):
        """extract_exif_data stores merged IPTC+XMP keywords in the DB."""
        metadata = self._extract_with_real_exiftool()

        self.assertIsNotNone(metadata)
        self.assertIsNotNone(metadata.keywords)
        self.assertEqual(metadata.keywords, ALL_KEYWORDS_SORTED)

    def test_keywords_deduplicated(self):
        """Overlapping keywords (vacation, beach) appear only once."""
        metadata = self._extract_with_real_exiftool()

        # "vacation" and "beach" exist in both IPTC and XMP
        keyword_list = metadata.keywords
        self.assertEqual(keyword_list.count("vacation"), 1)
        self.assertEqual(keyword_list.count("beach"), 1)

    def test_keywords_indexed_in_search_captions(self):
        """Keywords extracted from IPTC/XMP are searchable."""
        self._extract_with_real_exiftool()

        search, _ = PhotoSearch.objects.get_or_create(photo=self.photo)
        search.recreate_search_captions()
        search.save()

        for kw in ALL_KEYWORDS_SORTED:
            self.assertIn(
                kw,
                search.search_captions,
                f"Keyword '{kw}' should be in search_captions",
            )

    def test_image_dimensions_extracted(self):
        """Basic EXIF fields (width/height) are also extracted correctly."""
        metadata = self._extract_with_real_exiftool()

        # The fixture is a 100x100 image
        self.assertEqual(metadata.width, 100)
        self.assertEqual(metadata.height, 100)
