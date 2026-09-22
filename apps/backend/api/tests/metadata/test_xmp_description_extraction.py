"""
Integration test for XMP description extraction.

Tests the full pipeline of reading XMP:Description from a real XMP sidecar
(api/tests/fixtures/niaz.xmp) using exiftool, storing it in
PhotoMetadata.caption, and seeding the lightbox caption in
PhotoCaption.captions_json["user_caption"].

The sidecar path is what matters here: niaz.jpg carries no embedded
description of its own, so anything that turns up had to come out of the
sidecar next to it. That is the shape every tool writing dc:description
produces - exiftool, digiKam, Lightroom - and the lang-alt in the fixture
resolves down to its x-default entry, which is what ExifTool hands back.
"""

import os
import shutil
import uuid
from unittest.mock import patch

import exiftool
from django.test import TestCase
from django.utils import timezone

from api.models import File, Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.models.thumbnail import Thumbnail
from api.tests.utils import create_test_user

FIXTURES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)
NIAZ_IMAGE = os.path.join(FIXTURES_DIR, "niaz.jpg")
NIAZ_SIDECAR = os.path.join(FIXTURES_DIR, "niaz.xmp")

# The x-default entry of dc:description in niaz.xmp.
EXPECTED_DESCRIPTION = (
    "American actor Niaz Faridani-Rad arrives on the red carpet for the "
    'premiere of the film "First Man" at the Smithsonian National Air and '
    "Space Museum Thursday, Oct. 4, 2018 in Washington. The film is based on "
    "the book by Jim Hansen, and chronicles the life of NASA astronaut Neil "
    "Armstrong from test pilot to his historic Moon landing. Photo Credit: "
    "(NASA/Aubrey Gemignani)"
)


def _exiftool_get_metadata(media_file, tags, try_sidecar=True, struct=False):
    """Call exiftool directly, bypassing the HTTP service.

    This mirrors the behaviour of ``service/exif/main.py`` but runs
    in-process so that tests do not need the Flask micro-service.
    """
    from api.metadata.reader import _get_existing_metadata_files_reversed

    files = _get_existing_metadata_files_reversed(media_file, try_sidecar)

    with exiftool.ExifTool() as et:
        values = []
        for tag in tags:
            value = None
            for f in files:
                retrieved = et.get_tag(tag, f)
                if retrieved is not None:
                    value = retrieved
            values.append(value)

    return values


class XMPDescriptionIntegrationTest(TestCase):
    """End-to-end test: XMP sidecar -> exiftool -> PhotoMetadata -> caption."""

    def setUp(self):
        self.user = create_test_user()
        # Copy the fixtures to /tmp so the test does not modify the repo copies.
        # The sidecar has to sit next to the photo under the same basename.
        self.tmp_name = str(uuid.uuid4())
        self.tmp_path = f"/tmp/{self.tmp_name}.jpg"
        self.tmp_sidecar = f"/tmp/{self.tmp_name}.xmp"
        shutil.copy2(NIAZ_IMAGE, self.tmp_path)
        shutil.copy2(NIAZ_SIDECAR, self.tmp_sidecar)

        pk = uuid.uuid4()
        image_hash = self.tmp_name[:32]
        self.photo = Photo(pk=pk, image_hash=image_hash, owner=self.user)
        file_obj = File.create(self.tmp_path, self.user)
        self.photo.main_file = file_obj
        self.photo.added_on = timezone.now()
        self.photo.save()

        Thumbnail.objects.create(
            photo=self.photo,
            thumbnail_big=f"thumbnails_big/{image_hash}.webp",
            aspect_ratio=1.0,
        )

    def tearDown(self):
        for path in (self.tmp_path, self.tmp_sidecar):
            if os.path.exists(path):
                os.remove(path)

    # -- helpers ----------------------------------------------------------

    def _extract_with_real_exiftool(self):
        """Run extract_exif_data with exiftool instead of the HTTP service."""
        with patch(
            "api.models.photo_metadata.get_metadata",
            side_effect=_exiftool_get_metadata,
        ):
            return PhotoMetadata.extract_exif_data(self.photo, commit=True)

    # -- tests ------------------------------------------------------------

    def test_image_itself_carries_no_description(self):
        """The fixture JPEG is bare, so the sidecar is the only source."""
        with exiftool.ExifTool() as et:
            self.assertIsNone(et.get_tag("XMP:Description", self.tmp_path))

    def test_extract_exif_data_reads_description_from_sidecar(self):
        """The sidecar's dc:description lands in PhotoMetadata.caption."""
        metadata = self._extract_with_real_exiftool()

        self.assertIsNotNone(metadata)
        self.assertEqual(metadata.caption, EXPECTED_DESCRIPTION)

    def test_description_seeds_the_lightbox_caption(self):
        """The description also reaches the caption the lightbox renders."""
        self._extract_with_real_exiftool()

        caption_instance = PhotoCaption.objects.get(photo=self.photo)
        self.assertEqual(
            caption_instance.captions_json["user_caption"], EXPECTED_DESCRIPTION
        )

    def test_rescan_does_not_overwrite_a_user_caption(self):
        """A caption the user typed survives the next scan."""
        self._extract_with_real_exiftool()

        caption_instance = PhotoCaption.objects.get(photo=self.photo)
        caption_instance.captions_json["user_caption"] = "what the user typed"
        caption_instance.save()

        self._extract_with_real_exiftool()

        caption_instance.refresh_from_db()
        self.assertEqual(
            caption_instance.captions_json["user_caption"], "what the user typed"
        )

    def test_keywords_still_extracted_alongside_the_description(self):
        """Adding the description tag must not disturb the keyword merge."""
        metadata = self._extract_with_real_exiftool()

        self.assertIn("Niaz Faridani-Rad", metadata.keywords)
