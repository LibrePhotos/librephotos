"""
Test per verificare il comportamento della feature skip_raw_files durante le scansioni
"""
import datetime
import os
import tempfile
from unittest import TestCase
from unittest.mock import patch

import pytz

from api.models import File, Photo, User
from api.models.file import is_valid_media


class SkipRawFilesTestCase(TestCase):
    """Test per verificare che i file RAW vengano ignorati con skip_raw_files=True"""

    def setUp(self):
        """Setup del test environment"""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )
        self.user.scan_directory = "/tmp/test_photos"
        self.user.save()

    def tearDown(self):
        """Cleanup dopo i test"""
        Photo.objects.filter(owner=self.user).delete()
        self.user.delete()

    def test_new_raw_files_not_imported_during_normal_scan(self):
        """
        Test: Nuovi file RAW NON vengono importati durante una scansione normale
        quando skip_raw_files è attivo
        """
        self.user.skip_raw_files = True
        self.user.save()

        # Verifica che is_valid_media ritorni False per file RAW
        with patch("api.models.file.is_raw") as mock_is_raw:
            mock_is_raw.return_value = True
            result = is_valid_media("/new/raw/file.NEF", self.user)
            self.assertFalse(
                result,
                "I file RAW non dovrebbero essere considerati validi con skip_raw_files=True",
            )

    def test_new_raw_files_not_imported_during_full_scan(self):
        """
        Test: Nuovi file RAW NON vengono importati durante un full scan
        quando skip_raw_files è attivo
        """
        # Crea un file temporaneo RAW
        with tempfile.NamedTemporaryFile(
            suffix=".CR2", delete=False
        ) as temp_raw_file:
            raw_path = temp_raw_file.name
            temp_raw_file.write(b"fake raw content for full scan")

        try:
            self.user.skip_raw_files = True
            self.user.save()

            initial_photo_count = Photo.objects.filter(owner=self.user).count()

            # Simula full scan chiamando create_new_image
            from api.directory_watcher import create_new_image

            result = create_new_image(self.user, raw_path)

            # create_new_image dovrebbe restituire None perché is_valid_media ritorna False
            self.assertIsNone(
                result,
                "create_new_image dovrebbe restituire None per file RAW durante full scan",
            )

            # Verifica che non sia stata creata nessuna foto
            final_photo_count = Photo.objects.filter(owner=self.user).count()
            self.assertEqual(
                initial_photo_count,
                final_photo_count,
                "Non dovrebbe essere creata nessuna foto durante full scan con skip_raw_files=True",
            )

        finally:
            # Cleanup
            if os.path.exists(raw_path):
                os.unlink(raw_path)


if __name__ == "__main__":
    import django

    django.setup()
    import unittest

    unittest.main()
