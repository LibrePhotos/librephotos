"""A library on disk for the move tests (#352): a user whose scan directory
is a temporary folder, and photos with real files in it."""

import os
import shutil
import tempfile

from django.test import TestCase

from api.models import File, Photo, User
from api.tests.utils import create_test_file, create_test_photo, create_test_user


class LibraryTestCase(TestCase):
    """``self.user`` owns ``self.root`` (its scan directory) with folders ``a`` and ``b``."""

    def setUp(self) -> None:
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="move-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.user = create_test_user(scan_directory=self.root)
        self.source = self.folder("a")
        self.target = self.folder("b")

    def folder(self, *parts: str) -> str:
        path = os.path.join(self.root, *parts)
        os.makedirs(path, exist_ok=True)
        return path

    def write(self, path: str, content: bytes | None = None) -> str:
        with open(path, "wb") as handle:
            handle.write(content or os.urandom(16))
        return path

    def file(
        self,
        folder: str,
        name: str,
        file_type: int = File.IMAGE,
        user: User | None = None,
    ) -> File:
        """A file on disk in ``folder`` with its row."""
        path = os.path.join(folder, name)
        file = create_test_file(path, user or self.user, os.urandom(32))
        if file_type != File.IMAGE:
            File.objects.filter(pk=file.pk).update(type=file_type)
            file.refresh_from_db()
        return file

    def photo(
        self,
        name: str = "IMG_1.jpg",
        folder: str | None = None,
        variants: tuple[File, ...] = (),
    ) -> Photo:
        """A photo whose main file ``name`` is in ``folder`` (default ``a``)."""
        main = self.file(folder or self.source, name)
        photo = create_test_photo(owner=self.user, main_file=main)
        photo.files.add(main, *variants)
        return photo
