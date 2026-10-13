"""Which XMP sidecar a write-back lands in, and which ones a read sees (#2286).

A library managed with digiKam or darktable already has ``IMG.jpg.xmp`` next
to the photo. The writer used to take the first sidecar name it could think
of (``IMG.xmp``), whether or not it existed, so the photo ended up with two
sidecars that disagree. Written and read back with real ExifTool.
"""

import os
import tempfile

from api.metadata.reader import (
    _get_existing_metadata_files_reversed,
    existing_sidecars,
    get_metadata,
)
from api.metadata.tags import Tags
from api.metadata.writer import write_metadata
from api.tests.metadata.exiftool_harness import RealExifToolTestCase


def _case_sensitive(directory: str) -> bool:
    """Whether ``directory`` tells ``a`` from ``A``."""
    with tempfile.NamedTemporaryFile(dir=directory, prefix="case-") as probe:
        name = os.path.basename(probe.name)
        return not os.path.exists(os.path.join(directory, name.upper()))


class SidecarTargetTest(RealExifToolTestCase):
    def _sidecar(self, path: str, rating: int, *extra: str) -> str:
        """A sidecar at ``path`` with ``rating`` and ``extra`` tags."""
        self.tag(path, f"-XMP:Rating={rating}", *extra)
        return path

    def _rate(self, image: str, rating: int) -> str:
        """Write ``rating`` to the sidecar of ``image``; the file it went to."""
        self.exiftool.writes.clear()
        write_metadata(image, {Tags.RATING: rating}, use_sidecar=True)
        self.assertWritesLanded(expected=1)
        return self.exiftool.writes[0].target

    def _read_rating(self, image: str) -> object:
        (rating,) = get_metadata(image, tags=[Tags.RATING], try_sidecar=True)
        return rating

    def _xmp_files(self) -> list[str]:
        return sorted(
            name for name in os.listdir(self.directory) if name.lower().endswith(".xmp")
        )

    def test_writes_into_an_existing_extension_qualified_sidecar(self):
        image = self.make_image(".jpg", "IMG_2")
        sidecar = self._sidecar(image + ".xmp", 2, "-XMP-dc:Subject=Holiday")

        target = self._rate(image, 4)

        self.assertEqual(sidecar, target)
        self.assertEqual(["IMG_2.jpg.xmp"], self._xmp_files())
        tags = self.read_tags(sidecar, "XMP:Rating", "XMP-dc:Subject")
        self.assertEqual({"XMP:Rating": 4, "XMP-dc:Subject": ["Holiday"]}, tags)
        self.assertEqual(4, self._read_rating(image))

    def test_writes_into_an_existing_basename_sidecar(self):
        # Installs that already have LibrePhotos' own IMG.xmp keep using it.
        image = self.make_image(".jpg", "IMG_3")
        sidecar = self._sidecar(os.path.join(self.directory, "IMG_3.xmp"), 1)

        target = self._rate(image, 5)

        self.assertEqual(sidecar, target)
        self.assertEqual(["IMG_3.xmp"], self._xmp_files())
        self.assertEqual(5, self._read_rating(image))

    def test_creates_an_extension_qualified_sidecar_when_there_is_none(self):
        image = self.make_image(".jpg", "IMG_4")

        target = self._rate(image, 3)

        self.assertEqual(image + ".xmp", target)
        self.assertEqual(["IMG_4.jpg.xmp"], self._xmp_files())
        self.assertEqual(3, self._read_rating(image))
        # The next write goes to the sidecar the first one created.
        self.assertEqual(image + ".xmp", self._rate(image, 2))
        self.assertEqual(2, self._read_rating(image))

    def test_with_two_sidecars_writes_the_one_the_reader_ranks_first(self):
        image = self.make_image(".jpg", "IMG_5")
        theirs = self._sidecar(image + ".xmp", 2)
        ours = self._sidecar(os.path.join(self.directory, "IMG_5.xmp"), 1)

        with self.assertLogs("api.metadata.reader", "WARNING") as logs:
            target = self._rate(image, 5)

        self.assertEqual(ours, target)
        self.assertEqual(5, self._read_rating(image))
        self.assertEqual({"XMP:Rating": 2}, self.read_tags(theirs, "XMP:Rating"))
        self.assertIn("2 XMP sidecars", logs.output[0])

    def test_an_upper_case_sidecar_is_written_in_place(self):
        if not _case_sensitive(self.directory):
            self.skipTest("the temporary directory is case-insensitive")
        image = self.make_image(".jpg", "IMG_6")
        sidecar = self._sidecar(os.path.join(self.directory, "IMG_6.XMP"), 1)

        self.assertEqual(sidecar, self._rate(image, 4))
        self.assertEqual(["IMG_6.XMP"], self._xmp_files())

    def test_each_sidecar_is_read_once(self):
        # On a case-insensitive file system IMG.xmp also "exists" as IMG.XMP.
        image = self.make_image(".jpg", "IMG_7")
        basename = self._sidecar(os.path.join(self.directory, "IMG_7.xmp"), 1)
        qualified = self._sidecar(image + ".xmp", 2)

        self.assertEqual([basename, qualified], existing_sidecars(image))
        self.assertEqual(
            [image, qualified, basename],
            _get_existing_metadata_files_reversed(image, True),
        )
        # The basename sidecar is read last, so its value wins.
        self.assertEqual(1, self._read_rating(image))
