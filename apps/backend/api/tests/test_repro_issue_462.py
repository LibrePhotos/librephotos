"""Repro for issue #462 - "Duplicated auto albums".

https://github.com/LibrePhotos/librephotos/issues/462

``api.autoalbum.generate_event_albums`` groups a user's photos into events
(anything less than 1 day 12 hours apart belongs to the same event) and then
looks for an already existing ``AlbumAuto`` with::

    key     = group[0].exif_timestamp - timedelta(hours=11, minutes=59)
    lastKey = group[-1].exif_timestamp + timedelta(hours=11, minutes=59)
    qs = AlbumAuto.objects.filter(owner=user).filter(timestamp__range=(key, lastKey))

The album that was created for a group stores ``timestamp = key``, i.e. it is
anchored to the *first* photo of the group at the time of creation.  That
anchor is never updated, and the lookup only recognises an album whose anchor
still falls inside the current group's window.  Two consequences, both of
which leave the user staring at two auto albums for one single event:

1. If the earliest photo of an event disappears (deleted by the user, or
   swept away by ``delete_missing_photos``), the next run computes a ``key``
   that is *later* than the stored anchor, the existing album is no longer
   matched, ``qs.count() == 0`` and a brand new ``AlbumAuto`` is created for
   photos that are already in an album -> two albums holding the identical
   set of photos.

2. If newly imported photos bridge the gap between two events, the two
   previously separate albums both fall inside the merged group's window,
   ``qs.count() > 1`` and the code simply logs "found multiple auto albums"
   and gives up (``# To-Do: Merge both auto albums``).  The duplicate albums
   survive every regeneration and the bridging photos end up in no album at
   all.
"""

from datetime import timedelta

import pytz
from django.test import TestCase
from django.utils import timezone

from api.autoalbum import generate_event_albums
from api.models import AlbumAuto
from api.tests.utils import create_test_photo, create_test_user

BASE = timezone.datetime(2020, 1, 1, 12, 0, 0, tzinfo=pytz.utc)


def make_photo(user, offset_hours):
    return create_test_photo(
        owner=user, exif_timestamp=BASE + timedelta(hours=offset_hours)
    )


class DuplicateAutoAlbumAfterPhotoRemovalTestCase(TestCase):
    def test_regeneration_does_not_create_a_second_album_for_the_same_photos(self):
        user = create_test_user()

        # One continuous event: every photo is 30h after the previous one,
        # which is below the 1 day 12 hours grouping delta.
        first = make_photo(user, 0)
        second = make_photo(user, 30)
        third = make_photo(user, 60)

        generate_event_albums(user, "job-462-first")
        albums = AlbumAuto.objects.filter(owner=user)
        self.assertEqual(albums.count(), 1, "setup: the event must yield one album")
        original = albums.first()
        self.assertEqual(original.photos.count(), 3)

        # The earliest photo of the event goes away - the user deleted it, or
        # its file vanished and delete_missing_photos removed it.
        first.delete()

        generate_event_albums(user, "job-462-second")

        albums = AlbumAuto.objects.filter(owner=user)
        photo_sets = [
            sorted(str(pk) for pk in album.photos.values_list("pk", flat=True))
            for album in albums
        ]
        self.assertEqual(
            albums.count(),
            1,
            "Regenerating auto albums produced a duplicate album for photos "
            "that were already in one. AlbumAuto.timestamp is anchored to the "
            "first photo of the group when the album is created and is never "
            "refreshed, so once that photo is gone the "
            "`timestamp__range=(key, lastKey)` lookup no longer finds the "
            f"album and a new one is created. Album photo sets: {photo_sets}",
        )

        # And the surviving album must still be the original one.
        self.assertEqual(
            sorted(
                str(pk) for pk in albums.first().photos.values_list("pk", flat=True)
            ),
            sorted([str(second.pk), str(third.pk)]),
        )


class DuplicateAutoAlbumAfterBridgingTestCase(TestCase):
    """Two events joined by newly imported photos must collapse into one album."""

    def _build_two_events_then_bridge(self, user):
        # Event 1 and event 2 are 94 hours apart -> two separate albums.
        event_one = [make_photo(user, h) for h in (0, 1, 2)]
        event_two = [make_photo(user, h) for h in (96, 97, 98)]

        generate_event_albums(user, "job-462-bridge-first")
        self.assertEqual(
            AlbumAuto.objects.filter(owner=user).count(),
            2,
            "setup: two events 94h apart must yield two albums",
        )

        # Newly scanned photos chain the two events together: 32h, 32h and 30h
        # steps are all below the 1 day 12 hours grouping delta, so everything
        # is now one single event.
        bridge = [make_photo(user, h) for h in (34, 66)]

        generate_event_albums(user, "job-462-bridge-second")
        return event_one, event_two, bridge

    def test_bridged_events_collapse_into_a_single_album(self):
        user = create_test_user()
        self._build_two_events_then_bridge(user)

        albums = AlbumAuto.objects.filter(owner=user)
        self.assertEqual(
            albums.count(),
            1,
            "After new photos merged two events into one, two auto albums "
            "still cover the same event. generate_event_albums sees "
            "qs.count() > 1 and bails out with `# To-Do: Merge both auto "
            "albums`, so the duplicates survive every regeneration. "
            f"Timestamps: {list(albums.values_list('timestamp', flat=True))}",
        )

    def test_bridging_photos_are_added_to_an_album(self):
        user = create_test_user()
        _, _, bridge = self._build_two_events_then_bridge(user)

        orphans = [
            photo.image_hash
            for photo in bridge
            if not AlbumAuto.objects.filter(owner=user, photos=photo).exists()
        ]
        self.assertEqual(
            orphans,
            [],
            "Photos that bridge two previously separate events are never "
            "added to any auto album: the multi-album branch of "
            "generate_event_albums does nothing but log.",
        )


class MergeSafetyTestCase(TestCase):
    """Collapsing duplicates must not destroy albums or the user's own data.

    Matching an album by the photos it holds (the fix for the two cases above)
    only works because this file never removes a photo from an album. A photo
    whose timestamp is corrected into a neighbouring event therefore leaves a
    stale membership behind, and a merge that trusted it blindly would weld two
    unrelated events together and delete one of them.
    """

    def test_album_reaching_outside_the_event_is_not_swallowed(self):
        user = create_test_user()

        event_one = [make_photo(user, h) for h in (0, 1, 2)]
        event_two = [make_photo(user, h) for h in (200, 201, 202)]

        generate_event_albums(user, "job-462-merge-setup")
        before = set(AlbumAuto.objects.filter(owner=user).values_list("pk", flat=True))
        self.assertEqual(
            len(before), 2, "setup: the two events must start out as two albums"
        )

        # The user corrects one photo's date, moving it into the other event.
        # Its old album still lists it, which is exactly the stale membership a
        # membership-based lookup has to tolerate.
        moved = event_one[0]
        moved.exif_timestamp = event_two[0].exif_timestamp + timedelta(minutes=5)
        moved.save()

        generate_event_albums(user, "job-462-merge-rerun")

        after = set(AlbumAuto.objects.filter(owner=user).values_list("pk", flat=True))
        self.assertEqual(
            sorted(before - after),
            [],
            "Correcting the date of a single photo destroyed an auto album: an "
            "album of the other event was folded into this group and deleted, "
            "even though the rest of its photos are days away. "
            f"Albums before: {sorted(before)}, after: {sorted(after)}",
        )
        # Every event still has its photos in some album. (Regeneration is not
        # fully idempotent here: because photos are never removed from an auto
        # album, the album that lost a photo to another event keeps listing it
        # and a fresh album is created for the photos left behind. That leaves a
        # redundant album, which is a great deal better than deleting one.)
        self.assertTrue(
            AlbumAuto.objects.filter(owner=user, photos=event_one[1]).exists(),
            "the untouched photos of the first event lost their album",
        )
        self.assertTrue(
            AlbumAuto.objects.filter(owner=user, photos=event_two[2]).exists(),
            "the photos of the second event lost their album",
        )

    def test_merge_keeps_favorited_and_shares(self):
        user = create_test_user()
        other = create_test_user()

        for hour in (0, 1, 2):
            make_photo(user, hour)
        event_two = [make_photo(user, h) for h in (96, 97, 98)]
        generate_event_albums(user, "job-462-carry-setup")

        later = AlbumAuto.objects.filter(owner=user, photos=event_two[0]).first()
        later.favorited = True
        later.save()
        later.shared_to.add(other)

        # Bridge the two events so the albums have to be merged. Each step is
        # below the 1 day 12 hours grouping delta.
        for hour in (32, 64):
            make_photo(user, hour)
        generate_event_albums(user, "job-462-carry-merge")

        albums = AlbumAuto.objects.filter(owner=user)
        self.assertEqual(albums.count(), 1, "setup: the events must have merged")
        survivor = albums.first()
        self.assertTrue(
            survivor.favorited,
            "merging two auto albums silently dropped the favorite the user "
            "had set on one of them",
        )
        self.assertEqual(
            [u.username for u in survivor.shared_to.all()],
            [other.username],
            "merging two auto albums silently dropped the shares the user had "
            "made on one of them",
        )

    def test_title_refreshes_on_every_run(self):
        user = create_test_user()
        for hour in (0, 1, 2):
            make_photo(user, hour)

        generate_event_albums(user, "job-462-title-first")
        album = AlbumAuto.objects.filter(owner=user).first()
        album.title = "stale title"
        album.save()

        # Nothing about the membership changes on this run.
        generate_event_albums(user, "job-462-title-second")

        album.refresh_from_db()
        self.assertNotEqual(
            album.title,
            "stale title",
            "auto album titles are only regenerated when the membership "
            "changes, so a title never picks up the people and places that "
            "were recognized after the album was created",
        )
