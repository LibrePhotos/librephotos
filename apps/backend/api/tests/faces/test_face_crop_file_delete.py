"""A deleted face's crop file goes once the delete commits, not before.

The receiver used to remove the file inside the delete, so a delete that was
rolled back afterwards restored a face row pointing at a missing crop.
"""

import os
import shutil
import tempfile
import uuid

from django.db import transaction
from django.test import TestCase, override_settings

from api.models.face import Face
from api.tests.utils import create_test_face, create_test_photo, create_test_user


class FaceCropFileDeleteTest(TestCase):
    def setUp(self) -> None:
        media_root = tempfile.mkdtemp(prefix="face-crops-")
        self.addCleanup(shutil.rmtree, media_root, ignore_errors=True)
        settings_override = override_settings(MEDIA_ROOT=media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        photo = create_test_photo(owner=create_test_user())
        self.face = create_test_face(photo=photo, image=f"faces/{uuid.uuid4()}.jpg")
        self.crop = self.face.image.path
        os.makedirs(os.path.dirname(self.crop), exist_ok=True)
        with open(self.crop, "wb") as crop:
            crop.write(b"crop")

    def test_a_committed_delete_removes_the_crop(self) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            self.face.delete()
            self.assertTrue(os.path.isfile(self.crop), "removed before the commit")

        self.assertFalse(os.path.exists(self.crop))

    def test_a_rolled_back_delete_keeps_the_crop(self) -> None:
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    Face.objects.get(pk=self.face.pk).delete()
                    raise RuntimeError("roll back")

        self.assertEqual(callbacks, [])
        self.assertTrue(Face.objects.filter(pk=self.face.pk).exists())
        self.assertTrue(os.path.isfile(self.crop))

    def test_a_missing_crop_does_not_fail_the_delete(self) -> None:
        os.remove(self.crop)

        with self.captureOnCommitCallbacks(execute=True):
            self.face.delete()

        self.assertFalse(Face.objects.filter(pk=self.face.pk).exists())
