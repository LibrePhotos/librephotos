"""Repro for issue #836 - "Auto album generation stuck (looks like #584)".

https://github.com/LibrePhotos/librephotos/issues/836

Two distinct defects in ``api.autoalbum.generate_event_albums`` are covered:

1. The job's progress counters are never advanced for any group that actually
   becomes an auto album.  Every branch that handles a group of >= 2 photos
   ends in ``continue``, which jumps over the trailing
   ``lrj.update_progress(current=idx + 1, target=target_count)``.  Only
   single-photo groups (which produce no album at all) ever reach it, so a
   library made of real events reports 0 / 0 for the whole run -- exactly the
   frozen progress bar screenshotted in the issue.

2. Re-running generation over albums that already exist re-reads the whole
   album membership once per photo (``if item in album.photos.all()``), which
   is why the reporter measured ~15 minutes on a clean database and ~7 hours
   for the very same library once the auto albums were already there.
"""

from datetime import datetime, timedelta

import pytz
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.autoalbum import generate_event_albums
from api.models import AlbumAuto, LongRunningJob
from api.tests.utils import create_test_photo, create_test_user

BASE = datetime(2020, 1, 1, 12, 0, 0, tzinfo=pytz.utc)


def make_group(user, start, size):
    """Create ``size`` photos one hour apart, i.e. a single auto-album group."""
    return [
        create_test_photo(owner=user, exif_timestamp=start + timedelta(hours=i))
        for i in range(size)
    ]


class AutoAlbumProgressTestCase(TestCase):
    def test_progress_advances_for_every_group(self):
        user = create_test_user()
        # Three separate events, 10 days apart so they cannot be merged into
        # one group (the grouping delta is 1 day 12 hours).
        for event in range(3):
            make_group(user, BASE + timedelta(days=10 * event), 3)

        generate_event_albums(user, "job-836-progress")

        self.assertEqual(AlbumAuto.objects.filter(owner=user).count(), 3)

        lrj = LongRunningJob.objects.get(job_id="job-836-progress")
        self.assertEqual(
            (lrj.progress_current, lrj.progress_target),
            (3, 3),
            "generate_event_albums never reports progress for groups that turn "
            "into an album: every branch handling len(group) >= 2 ends in "
            "`continue`, skipping lrj.update_progress(). The UI therefore shows "
            f"a frozen bar - got {lrj.progress_current}/{lrj.progress_target}.",
        )


class AutoAlbumRerunTestCase(TestCase):
    def test_rerun_does_not_reload_album_membership_per_photo(self):
        user = create_test_user()
        photo_count = 20
        make_group(user, BASE, photo_count)

        # First pass: creates the auto album.
        generate_event_albums(user, "job-836-first")
        self.assertEqual(AlbumAuto.objects.filter(owner=user).count(), 1)

        # Second pass over the identical library: nothing has to change.
        with CaptureQueriesContext(connection) as ctx:
            generate_event_albums(user, "job-836-second")

        membership_reads = [
            q["sql"]
            for q in ctx.captured_queries
            if "api_albumauto_photos" in q["sql"] and "api_photo" in q["sql"]
        ]

        self.assertLessEqual(
            len(membership_reads),
            3,
            "Re-running auto album generation reloads the complete album "
            "membership once per photo (`if item in album.photos.all()`), so "
            "the cost is quadratic in album size: "
            f"{len(membership_reads)} membership queries for {photo_count} "
            "photos. A 2800 photo album therefore takes hours on the second "
            "run.",
        )
