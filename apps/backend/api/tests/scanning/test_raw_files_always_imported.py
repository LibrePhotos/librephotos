"""
RAW files are always imported. The deprecated skip_raw_files and
stack_raw_jpeg are no longer read: a RAW is always imported, and a JPEG of the
same name in the same folder takes it as a file variant (see
stacks/test_raw_jpeg_always_grouped).
"""

from unittest.mock import patch

from django.test import TestCase

from api.models import Photo, User
from api.models.file import is_valid_media


class StackRawJpegTestCase(TestCase):
    """Test to verify that RAW files are always imported"""

    def setUp(self):
        """Set up the test environment"""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )
        self.user.scan_directory = "/tmp/test_photos"
        self.user.save()

    def tearDown(self):
        """Clean up after tests"""
        Photo.objects.filter(owner=self.user).delete()
        self.user.delete()

    def test_raw_files_always_valid(self):
        """
        Test: RAW files are always considered valid (no longer skipped)
        """
        # Verify that is_valid_media returns True for RAW files regardless of stack_raw_jpeg
        with patch("api.models.file.is_raw") as mock_is_raw:
            mock_is_raw.return_value = True
            # With stack_raw_jpeg=True
            self.user.stack_raw_jpeg = True
            self.user.save()
            result = is_valid_media("/new/raw/file.NEF", self.user)
            self.assertTrue(
                result,
                "RAW files should always be considered valid",
            )

            # With stack_raw_jpeg=False
            self.user.stack_raw_jpeg = False
            self.user.save()
            result = is_valid_media("/new/raw/file.NEF", self.user)
            self.assertTrue(
                result,
                "RAW files should always be considered valid even with stack_raw_jpeg=False",
            )
