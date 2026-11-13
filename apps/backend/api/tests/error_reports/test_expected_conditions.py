"""Expected, handled conditions are not error reports, and no error is reported twice.

Every ERROR log record becomes an error report (``api.error_reports.capture``).
In 1.6.0 these did, each its own report:

* "Error while parsing datetime from '...': Parsed datetime is N in the
  future.": a camera clock or a file name, which the rule then skips;
* "Error while deleting file not found at : ...": a download's zip that is
  already gone when its cleanup runs;
* "image <hash> - <user> - <path>: scan face failed" and "Could not create
  thumbnail for file ...": logged just before re-raising to a caller that
  reports the same error with its stack, and carrying a username and a path.
"""

import os
import tempfile
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.faces import extractor
from api.faces.photo_faces import extract_faces
from api.metadata.datetime_rules import _extract_no_tz_datetime_from_str
from api.photos.zip_downloads import delete_zip_file
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails import render


class ExpectedConditionsAreWarningsTest(TestCase):
    def test_a_date_far_in_the_future_is_a_warning(self) -> None:
        with self.assertLogs("api.metadata.datetime_rules", "DEBUG") as logs:
            parsed = _extract_no_tz_datetime_from_str("2035:09:19 05:37:53")

        self.assertIsNone(parsed)
        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])

    def test_a_zip_already_gone_is_a_warning(self) -> None:
        with (
            tempfile.TemporaryDirectory() as media,
            override_settings(MEDIA_ROOT=media),
            self.assertLogs("api.photos.zip_downloads", "DEBUG") as logs,
        ):
            os.makedirs(os.path.join(media, "zip"))
            self.assertIsNone(delete_zip_file("gone.zip"))

        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])


@override_settings(FEATURE_FACE_DETECTION=True)
class ReRaisedErrorsAreLoggedOnceTest(TestCase):
    def test_a_failed_face_scan_is_left_to_its_caller(self) -> None:
        photo = create_test_photo(owner=create_test_user())

        with (
            patch.object(extractor, "extract_from_exif", return_value=None),
            self.assertNoLogs("api.faces.photo_faces", "ERROR"),
            self.assertRaises(FileNotFoundError),
        ):
            # No thumbnail on disk: the face service is never asked.
            extract_faces(photo)

    def test_a_failed_static_thumbnail_is_left_to_its_caller(self) -> None:
        with (
            patch.object(render, "_render_big_thumbnail", side_effect=OSError("bad")),
            self.assertNoLogs("api.thumbnails.render", "ERROR"),
            self.assertRaises(OSError),
        ):
            render.create_static_thumbnails(
                "/data/photos/a.jpg", "abc", ["thumbnails_big"]
            )

    def test_a_failed_video_thumbnail_is_left_to_its_caller(self) -> None:
        with (
            patch.object(render, "_run_ffmpeg", side_effect=OSError("ffmpeg")),
            patch.object(render.color, "video_filter", return_value=None),
            self.assertNoLogs("api.thumbnails.render", "ERROR"),
            self.assertRaises(OSError),
        ):
            render.create_thumbnail_for_video(
                "/data/photos/a.mp4", "thumbnails_big", "abc", ".webp"
            )
