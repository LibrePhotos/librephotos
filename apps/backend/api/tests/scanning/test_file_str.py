"""``str(File)`` is the path, read from the row without touching the disk.

It used to sniff the file's type and save the row on every call
(``_find_out_type``), so the admin, a log line or a debugger printing a File
wrote to the database, and before that fix raised ``TypeError``. A model's
``__str__`` does no I/O (#2336).
"""

import os
import shutil
import tempfile

from django.test import TestCase
from django.urls import reverse

from api.models.file import File
from api.tests.utils import create_test_file, create_test_photo, create_test_user


class FileStrTest(TestCase):
    def setUp(self):
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory)
        self.path = os.path.join(directory, "IMG_0001.CR2")
        with open(self.path, "wb") as handle:
            handle.write(b"not really raw")
        # Stored with a type the content does not have: str() leaves it alone.
        self.file = create_test_file(
            hash_value="a" * 32, path=self.path, file_type=File.IMAGE
        )

    def test_str_is_the_path_without_a_query(self):
        with self.assertNumQueries(0):
            self.assertEqual(self.path, str(self.file))

    def test_str_does_not_change_the_stored_type(self):
        str(self.file)
        self.file.refresh_from_db()
        self.assertEqual(File.IMAGE, self.file.type)


class AdminRendersFilesTest(TestCase):
    """The admin renders ``str(File)``: the File list and the Photo list's
    ``main_file`` column."""

    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.client.force_login(self.admin)
        self.photo = create_test_photo(owner=self.admin)

    def test_photo_changelist_renders(self):
        response = self.client.get(reverse("admin:api_photo_changelist"))
        self.assertEqual(response.status_code, 200)
        assert self.photo.main_file is not None
        self.assertContains(response, self.photo.main_file.path)

    def test_file_changelist_renders(self):
        response = self.client.get(reverse("admin:api_file_changelist"))
        self.assertEqual(response.status_code, 200)
