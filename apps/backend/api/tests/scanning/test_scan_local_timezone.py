"""The scan's timestamps are UTC whatever the host's local zone is (#2193).

Django pins the process zone to ``TIME_ZONE = "UTC"`` with ``time.tzset()``,
which does not exist on Windows: there the process keeps the host's zone. A
local wall-clock time labelled UTC is then off by the host's UTC offset, so
file mtimes and ``Photo.added_on`` were compared with real UTC values that
far off. On a host with ``tzset`` the tests switch to New York; on Windows
they run in the host's own zone and are skipped when that is UTC.
"""

import datetime
import os
import shutil
import tempfile
import time
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.file_handlers import (
    create_file_record,
    create_new_image,
    group_files_into_photo,
)
from api.directory_watcher.scan_jobs import _file_was_modified_after
from api.models import Photo
from api.tests.scanning.test_file_handlers import _write_image
from api.tests.scanning.test_replaced_file_rescan import (
    ReplacedFileTestCase,
)
from api.tests.scanning.test_replaced_file_rescan import (
    _write_image as _write_picture,
)
from api.tests.utils import create_test_user

CLOSE_TO_NOW = datetime.timedelta(minutes=1)


def _use_a_local_zone_other_than_utc(test: TestCase) -> None:
    if hasattr(time, "tzset"):
        previous = os.environ.get("TZ")

        def restore() -> None:
            if previous is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = previous
            time.tzset()

        test.addCleanup(restore)
        os.environ["TZ"] = "America/New_York"
        time.tzset()
    elif not datetime.datetime.now().astimezone().utcoffset():
        test.skipTest("the host's local zone is UTC and cannot be changed here")


class FileModifiedAfterTest(TestCase):
    def setUp(self):
        _use_a_local_zone_other_than_utc(self)
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.path = os.path.join(directory, "a.jpg")
        with open(self.path, "wb") as f:
            f.write(b"jpeg")
        self.baseline = timezone.now() - datetime.timedelta(days=1)

    def set_mtime(self, moment: datetime.datetime) -> None:
        os.utime(self.path, (moment.timestamp(), moment.timestamp()))

    def test_a_file_changed_an_hour_after_the_baseline_was_modified(self):
        self.set_mtime(self.baseline + datetime.timedelta(hours=1))

        self.assertTrue(_file_was_modified_after(self.path, self.baseline))

    def test_a_file_changed_an_hour_before_the_baseline_was_not(self):
        self.set_mtime(self.baseline - datetime.timedelta(hours=1))

        self.assertFalse(_file_was_modified_after(self.path, self.baseline))


class AddedOnTest(TestCase):
    """The incremental tag, geolocation and face jobs compare it with UTC."""

    def setUp(self):
        _use_a_local_zone_other_than_utc(self)
        self.user = create_test_user()
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.path = _write_image(os.path.join(directory, "IMG_1.png"))
        patcher = patch(
            "api.directory_watcher.file_handlers.has_embedded_motion_video",
            return_value=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_added_now(self, photo: Photo | None) -> None:
        self.assertIsNotNone(photo)
        assert photo is not None
        added_on = Photo.objects.get(pk=photo.pk).added_on
        self.assertLess(abs(added_on - timezone.now()), CLOSE_TO_NOW)

    def test_a_scanned_photo(self):
        file = create_file_record(self.user, self.path)
        assert file is not None

        self.assert_added_now(group_files_into_photo(self.user, [file], "job"))

    def test_an_uploaded_photo(self):
        self.assert_added_now(create_new_image(self.user, self.path))


class ReplacedFileAddedOnTest(ReplacedFileTestCase):
    """A replaced file's photo looks new again to the follow-up jobs."""

    def setUp(self):
        super().setUp()
        _use_a_local_zone_other_than_utc(self)

    def test_a_replaced_file(self):
        _write_picture(self.path, 1)
        photo = self._index()
        Photo.objects.filter(pk=photo.pk).update(
            added_on=timezone.now() - datetime.timedelta(days=30)
        )

        _write_picture(self.path, 2)
        rescanned = self._scan()

        self.assertLess(
            abs(Photo.objects.get(pk=rescanned.pk).added_on - timezone.now()),
            CLOSE_TO_NOW,
        )
