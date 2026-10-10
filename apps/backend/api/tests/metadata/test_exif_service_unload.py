"""The exif sidecar gives its ExifTool processes back when the watchdog asks."""

import os
import shutil
import tempfile
import unittest

import PIL.Image
from django.test import SimpleTestCase

from service.exif import main

EXIFTOOL = shutil.which("exiftool")


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class ExifServiceUnloadTest(SimpleTestCase):
    def setUp(self):
        self.client = main.app.test_client()
        directory = tempfile.mkdtemp(prefix="librephotos-exif-unload")
        self.addCleanup(shutil.rmtree, directory, True)
        self.photo = os.path.join(directory, "photo.jpg")
        PIL.Image.new("RGB", (16, 16)).save(self.photo)
        self.addCleanup(main.stop_exiftools)

    def get_tags(self, struct=False):
        return self.client.post(
            "/get-tags",
            json={
                "files_by_reverse_priority": [self.photo],
                "tags": ["File:ImageWidth"],
                "struct": struct,
            },
        )

    def test_unload_stops_both_processes_and_the_next_request_restarts_one(self):
        self.assertEqual(self.get_tags().status_code, 200)
        self.assertEqual(self.get_tags(struct=True).status_code, 200)
        self.assertTrue(self.client.get("/health").json["model_loaded"])

        self.assertEqual(self.client.get("/unload-model").status_code, 200)
        self.assertFalse(main.static_et.running)
        self.assertFalse(main.static_struct_et.running)
        self.assertFalse(self.client.get("/health").json["model_loaded"])

        response = self.get_tags()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["values"], [16])
        self.assertTrue(main.static_et.running)
        self.assertFalse(main.static_struct_et.running)
