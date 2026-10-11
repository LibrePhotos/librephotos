"""``str(File)`` names the path and the detected type.

``_find_out_type`` stored the detected type but returned None, so
``self.path + " " + None`` raised TypeError for every file: the admin, a log
line or a debugger printing a File crashed instead.
"""

import os
import shutil
import tempfile

from django.test import TestCase

from api.models.file import File


class FileStrTest(TestCase):
    def setUp(self):
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory)
        self.path = os.path.join(directory, "IMG_0001.CR2")
        with open(self.path, "wb") as handle:
            handle.write(b"not really raw")
        # Stored with the wrong type: str() detects and saves the right one.
        self.file = File.objects.create(hash="a" * 32, path=self.path, type=File.IMAGE)

    def test_str_names_path_and_detected_type(self):
        self.assertEqual(f"{self.path} Raw File", str(self.file))
        self.file.refresh_from_db()
        self.assertEqual(File.RAW_FILE, self.file.type)
