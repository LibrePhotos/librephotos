"""A sidecar named after a RAW variant (``IMG.CR2.xmp``) is read (#2269).

For a RAW+JPEG pair the JPEG is the photo's main file, but darktable and
other RAW editors write the sidecar of the RAW. The scan groups that sidecar
with the photo and re-reads the photo when it changes, so the read has to
look at it too, below a sidecar named after the main file.
"""

import os
import shutil
from unittest.mock import patch

from django.test import override_settings

from api.faces import extractor
from api.faces.photo_faces import extract_faces
from api.metadata.photo_reader import extract_exif_data
from api.metadata.reader import sidecar_files_for_photo
from api.models.file import File
from api.models.photo import Photo
from api.photos.media_files import get_or_create_file
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)


class VariantSidecarTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def pair(self, main: str) -> tuple[Photo, str]:
        """A photo with ``main`` as its main file and ``IMG.CR2`` as RAW variant.

        The RAW is a stand-in under a RAW extension: only its name matters.
        """
        raw = self.fake_raw(main)
        photo = self.photo_for(main, self.user)
        variant = get_or_create_file(raw, self.user)
        self.assertEqual(File.RAW_FILE, variant.type)
        photo.files.add(photo.main_file, variant)
        return Photo.objects.select_related("main_file", "owner").get(pk=photo.pk), raw

    def fake_raw(self, main: str) -> str:
        """``<main stem>.CR2``, with bytes of its own: a File row is keyed by its hash."""
        raw = os.path.splitext(main)[0] + ".CR2"
        with open(main, "rb") as source, open(raw, "wb") as target:
            target.write(source.read() + b"raw")
        return raw

    def test_the_raw_sidecar_is_read(self) -> None:
        photo, raw = self.pair(self.make_image(name="IMG"))
        self.tag(raw + ".xmp", "-XMP-xmp:Rating=4", "-XMP-dc:Subject=raw-tag")

        metadata = extract_exif_data(photo)

        photo.refresh_from_db()
        self.assertEqual(4, photo.rating)
        assert metadata is not None
        self.assertIn("raw-tag", metadata.keywords or [])

    def test_the_main_file_sidecar_wins_over_the_raw_sidecar(self) -> None:
        main = self.make_image(name="IMG")
        photo, raw = self.pair(main)
        self.tag(raw + ".xmp", "-XMP-xmp:Rating=4")
        self.tag(os.path.join(self.directory, "IMG.xmp"), "-XMP-xmp:Rating=2")

        extract_exif_data(photo)

        photo.refresh_from_db()
        self.assertEqual(2, photo.rating)

    def test_a_photo_without_variants_reads_its_own_sidecars(self) -> None:
        main = self.make_image(name="IMG")
        own = os.path.join(self.directory, "IMG.xmp")
        qualified = os.path.join(self.directory, "IMG.jpg.xmp")
        unrelated = os.path.join(self.directory, "OTHER.xmp")
        for sidecar in (own, qualified, unrelated):
            self.tag(sidecar, "-XMP-xmp:Rating=1")
        photo = self.photo_for(main, self.user)

        # Lowest priority first: the bare-basename sidecar is the main one.
        self.assertEqual([qualified, own], sidecar_files_for_photo(photo))

    def test_a_sidecar_attached_to_the_photo_is_read_last(self) -> None:
        # Grouped by the scan, but not named after any of the photo's files.
        main = self.make_image(name="IMG")
        photo, raw = self.pair(main)
        attached = os.path.join(self.directory, "IMG.edit.xmp")
        self.tag(attached, "-XMP-xmp:Rating=1")
        photo.files.add(get_or_create_file(attached, self.user))
        self.tag(raw + ".xmp", "-XMP-xmp:Rating=4")

        self.assertEqual([attached, raw + ".xmp"], sidecar_files_for_photo(photo))

    @override_settings(FEATURE_FACE_DETECTION=True)
    def test_face_regions_in_the_raw_sidecar_become_faces(self) -> None:
        main = os.path.join(self.directory, "niaz.jpg")
        shutil.copyfile(os.path.join(FIXTURES, "niaz.jpg"), main)
        raw = self.fake_raw(main)
        shutil.copyfile(os.path.join(FIXTURES, "niaz.xmp"), raw + ".xmp")
        photo = self.photo_for(main, self.user, thumbnails=True)
        photo.files.add(photo.main_file, get_or_create_file(raw, self.user))

        # The face service also looks at the photo (#2260); here it finds nothing.
        with patch.object(extractor, "extract_from_face_service", return_value=[]):
            extract_faces(photo)

        self.assertEqual(
            ["Niaz Faridani-Rad"],
            [face.person.name for face in photo.faces.all() if face.person],
        )
