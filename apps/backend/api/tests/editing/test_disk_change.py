"""DiskChange puts back the files a failed save replaced, and only those."""

from __future__ import annotations

import os
import tempfile
from unittest import TestCase, mock

from api.editing import files

real_replace = os.replace


def posix_replace(source: str, target: str) -> None:
    """``os.replace`` as POSIX ``rename`` does it: two links of one file stay."""
    if os.path.exists(target) and os.path.samefile(source, target):
        return
    real_replace(source, target)


class DiskChangeRollBackTest(TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = directory.name
        self.path = os.path.join(self.root, "thumbnail.webp")
        with open(self.path, "wb") as handle:
            handle.write(b"before")

    def roll_back(self, disk: files.DiskChange) -> None:
        with mock.patch.object(files.os, "replace", side_effect=posix_replace):
            disk.roll_back(photo_gone=False)

    def test_a_kept_file_the_save_never_replaced_leaves_no_copy(self) -> None:
        disk = files.DiskChange()
        disk.keep(self.path)

        self.roll_back(disk)

        self.assertEqual(os.listdir(self.root), ["thumbnail.webp"])
        with open(self.path, "rb") as handle:
            self.assertEqual(handle.read(), b"before")

    def test_a_replaced_file_gets_its_old_content_back(self) -> None:
        disk = files.DiskChange()
        disk.keep(self.path)
        part = os.path.join(self.root, "part.webp")
        with open(part, "wb") as handle:
            handle.write(b"after")
        os.replace(part, self.path)

        self.roll_back(disk)

        self.assertEqual(os.listdir(self.root), ["thumbnail.webp"])
        with open(self.path, "rb") as handle:
            self.assertEqual(handle.read(), b"before")
