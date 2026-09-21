import uuid
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api import autoalbum
from api.autoalbum import delete_missing_photos
from api.models import AlbumDate, AlbumPlace, File, LongRunningJob, Photo
from api.models.album_thing import AlbumThing
from api.models.tag import Tag
from api.tests.utils import create_test_photo, create_test_user


class DeleteMissingPhotosAsyncTaskTest(TestCase):
    """Guards the AsyncTask wrap in DeleteMissingPhotosView._delete_missing_photos.

    Before this fix the work ran synchronously in the request thread, so libraries
    with many missing photos timed out the gunicorn worker (issues #1405, #672).
    The endpoint must return immediately and hand the work to django-q2.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_post_queues_async_task_and_returns_immediately(self):
        with patch("api.views.views.AsyncTask") as async_task_cls:
            response = self.client.post("/api/deletemissingphotos/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["status"])
        self.assertIn("job_id", data)

        async_task_cls.assert_called_once()
        args = async_task_cls.call_args.args
        self.assertIs(args[0], delete_missing_photos)
        self.assertEqual(args[1], self.user)
        self.assertEqual(str(args[2]), data["job_id"])
        async_task_cls.return_value.run.assert_called_once_with()


class DeleteMissingPhotosCorrectnessTest(TestCase):
    """Guards three correctness fixes in api.autoalbum.delete_missing_photos.

    The function had a Q-filter precedence bug that scoped only the first OR
    clause to the requesting user, letting a non-admin scan touch other users'
    photos. It also relied on a User instance reaching a CharField lookup, and
    never reported progress to the LongRunningJob it ran under.
    """

    def test_does_not_touch_other_users_missing_photos(self):
        """Cross-user data-leak guard.

        With the original `Q(owner=user) & Q(files=None) | Q(main_file=None)`
        operator precedence, the second clause has no owner restriction, so any
        photo with `main_file=None` would match regardless of who initiated
        the scan. Once parenthesised, the filter is scoped per-user.
        """
        user1 = create_test_user()
        user2 = create_test_user()

        # user1's photo is a candidate for deletion (owner matches, M2M empty).
        photo1 = create_test_photo(owner=user1)
        # user2's photo is NOT a candidate when user1 scans, but it has
        # main_file=None which the buggy second OR clause would match.
        # Populate the M2M so Q(files=None) does not match, isolating the
        # main_file=None branch.
        photo2 = create_test_photo(owner=user2)
        photo2.files.add(photo2.main_file)
        photo2.main_file = None
        photo2.save()

        delete_missing_photos(user1, str(uuid.uuid4()))

        # user1's photo gets cleaned up; user2's must survive.
        self.assertFalse(Photo.objects.filter(pk=photo1.pk).exists())
        self.assertTrue(Photo.objects.filter(pk=photo2.pk).exists())

    def test_missing_files_filtered_by_owning_user_id(self):
        """File.hash is composed as `md5 + str(user.id)`; the user-owned
        subset of missing files is identified by that suffix. Passing the
        User instance directly relied on `str(user)` → username, which
        never matches the hash suffix in practice.
        """
        user = create_test_user()
        other = create_test_user()

        mine = File.objects.create(
            hash=f"deadbeef{user.id}",
            path=f"/tmp/mine-{user.id}.png",
            type=File.IMAGE,
            missing=True,
        )
        theirs = File.objects.create(
            hash=f"deadbeef{other.id}",
            path=f"/tmp/theirs-{other.id}.png",
            type=File.IMAGE,
            missing=True,
        )

        delete_missing_photos(user, str(uuid.uuid4()))

        self.assertFalse(File.objects.filter(pk=mine.pk).exists())
        self.assertTrue(File.objects.filter(pk=theirs.pk).exists())

    def test_reports_progress_to_long_running_job(self):
        """Without per-iteration `lrj.update_progress`, the UI was stuck on
        "running" indefinitely (issue #1405). Both target and current must
        reach the count of processed missing photos.
        """
        user = create_test_user()
        for _ in range(3):
            create_test_photo(owner=user)  # files=None makes them candidates

        job_id = str(uuid.uuid4())
        delete_missing_photos(user, job_id)

        lrj = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(lrj.progress_target, 3)
        self.assertEqual(lrj.progress_current, 3)


class DeleteMissingPhotosAlbumThingTest(TestCase):
    """Guards the AlbumThing photo_count refresh path.

    The original loop removed each missing photo from every AlbumThing it
    belonged to one at a time, and the ``update_photo_count`` ``m2m_changed``
    receiver fired a fresh ``COUNT(*)`` join on every removal. A library with
    hundreds of thousands of missing photos took hours under that pattern.
    The fix snapshots the affected AlbumThing ids before deletion, lets the
    through-rows cascade away with the photos, and refreshes
    ``photo_count`` / ``cover_photos`` once per AlbumThing afterwards.
    """

    def _make_album_thing(self, owner, photos):
        thing = AlbumThing.objects.create(title="x", thing_type="thing", owner=owner)
        thing.photos.add(*photos)
        return thing

    def test_photo_count_reflects_remaining_photos_after_deletion(self):
        """After missing photos are removed, ``photo_count`` must equal the
        number of remaining ``hidden=False`` photos in the AlbumThing.
        """
        user = create_test_user()
        kept = create_test_photo(owner=user)
        # Survival of `kept` requires populated `files` and a `main_file`.
        kept.files.add(kept.main_file)
        missing = [create_test_photo(owner=user) for _ in range(3)]

        thing = self._make_album_thing(user, [kept, *missing])

        delete_missing_photos(user, str(uuid.uuid4()))

        thing.refresh_from_db()
        self.assertEqual(thing.photo_count, 1)
        self.assertEqual(list(thing.photos.values_list("pk", flat=True)), [kept.pk])

    def test_cover_photos_refilled_after_deletion(self):
        """If the deleted photos were in ``cover_photos``, the refresh sweep
        must repopulate the cover from remaining photos.

        Seeding the cover with only-missing photos avoids tripping a
        pre-existing quirk in ``update_default_cover_photo`` where its top-up
        slice does not exclude photos already in ``cover_photos``; that quirk
        predates this fix and applies equally to the original receiver path.
        """
        user = create_test_user()
        survivors = []
        for _ in range(4):
            photo = create_test_photo(owner=user)
            photo.files.add(photo.main_file)
            survivors.append(photo)
        missing = [create_test_photo(owner=user) for _ in range(2)]

        thing = self._make_album_thing(user, [*survivors, *missing])
        thing.cover_photos.add(*missing)

        delete_missing_photos(user, str(uuid.uuid4()))

        thing.refresh_from_db()
        cover_ids = set(thing.cover_photos.values_list("pk", flat=True))
        survivor_ids = {p.pk for p in survivors}
        self.assertTrue(cover_ids)
        self.assertTrue(cover_ids.issubset(survivor_ids))

    def test_album_thing_updated_once_per_album_not_once_per_photo(self):
        """The load-bearing performance guard: regardless of how many photos
        the AlbumThing contained, the fix must issue a single
        ``UPDATE api_albumthing`` for ``photo_count`` (plus the cover-photo
        repopulation), not one update per removed photo. This is what the
        plan in #1405 calls the "COUNT-storm" pathology.
        """
        user = create_test_user()
        missing = [create_test_photo(owner=user) for _ in range(10)]
        thing = self._make_album_thing(user, missing)

        with CaptureQueriesContext(connection) as ctx:
            delete_missing_photos(user, str(uuid.uuid4()))

        album_thing_updates = [
            q
            for q in ctx.captured_queries
            if 'update "api_albumthing"' in q["sql"].lower()
            and "photo_count" in q["sql"].lower()
        ]
        self.assertEqual(
            len(album_thing_updates),
            1,
            f"expected one photo_count UPDATE, got {len(album_thing_updates)}; "
            f"queries:\n{[q['sql'] for q in album_thing_updates]}",
        )
        thing.refresh_from_db()
        self.assertEqual(thing.photo_count, 0)


class DeleteMissingPhotosCascadeTest(TestCase):
    """Guards the move from per-photo ``.remove()`` loops to cascade deletion.

    AlbumDate, AlbumPlace and AlbumUser have no ``m2m_changed`` receivers, so
    cascade through ``Photo.delete()`` cleans up their through-rows with the
    same observable result and far less work. These tests pin the cascade
    behaviour so a future contributor doesn't bring the explicit loops back
    by accident.
    """

    def test_album_date_through_rows_cleaned_on_cascade(self):
        user = create_test_user()
        kept = create_test_photo(owner=user)
        kept.files.add(kept.main_file)
        missing = [create_test_photo(owner=user) for _ in range(3)]

        album_date = AlbumDate.objects.create(owner=user)
        album_date.photos.add(kept, *missing)

        delete_missing_photos(user, str(uuid.uuid4()))

        remaining = list(album_date.photos.values_list("pk", flat=True))
        self.assertEqual(remaining, [kept.pk])

    def test_album_place_through_rows_cleaned_on_cascade(self):
        user = create_test_user()
        kept = create_test_photo(owner=user)
        kept.files.add(kept.main_file)
        missing = [create_test_photo(owner=user) for _ in range(3)]

        album_place = AlbumPlace.objects.create(title="Somewhere", owner=user)
        album_place.photos.add(kept, *missing)

        delete_missing_photos(user, str(uuid.uuid4()))

        remaining = list(album_place.photos.values_list("pk", flat=True))
        self.assertEqual(remaining, [kept.pk])


class DeleteMissingPhotosBatchingTest(TestCase):
    """Guards the batched processing that bounds peak memory.

    Sweeps with hundreds of thousands of missing photos can no longer keep
    the entire snapshot in scope at once; the function chunks the work into
    ``_DELETE_MISSING_BATCH_SIZE`` slices and runs the snapshot/delete/refresh
    sequence per slice. These tests assert the work happens at all (i.e. no
    photos are stranded between batches) and that AlbumThing accounting is
    still consistent when a single AlbumThing's membership straddles batches.
    """

    def test_processes_photos_across_batch_boundary(self):
        user = create_test_user()
        # A small batch size exercised against a slightly-larger photo count
        # demonstrates the multi-batch path without making the test slow.
        with patch.object(autoalbum, "_DELETE_MISSING_BATCH_SIZE", 3):
            missing = [create_test_photo(owner=user) for _ in range(7)]
            thing = AlbumThing.objects.create(
                title="multi-batch", thing_type="thing", owner=user
            )
            thing.photos.add(*missing)
            self.assertEqual(thing.photos.count(), 7)

            delete_missing_photos(user, str(uuid.uuid4()))

        self.assertFalse(Photo.objects.filter(pk__in=[p.pk for p in missing]).exists())
        thing.refresh_from_db()
        self.assertEqual(thing.photo_count, 0)
        self.assertEqual(thing.photos.count(), 0)

    def test_progress_reaches_target_after_multi_batch_run(self):
        # The progress refresh moved from per-photo to per-batch; the final
        # current must still equal the target.
        user = create_test_user()
        with patch.object(autoalbum, "_DELETE_MISSING_BATCH_SIZE", 2):
            for _ in range(5):
                create_test_photo(owner=user)
            job_id = str(uuid.uuid4())
            delete_missing_photos(user, job_id)

        lrj = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(lrj.progress_target, 5)
        self.assertEqual(lrj.progress_current, 5)


class DeleteMissingPhotosTagTest(TestCase):
    """The same photo_count refresh, for the Tag model.

    ``Tag`` arrived after the AlbumThing sweep above (#1930 vs #1848) and was
    not wired into it, so deleting a library's missing photos left every tag
    holding them with a stale count -- a tag whose only photo had gone still
    read "1 photo" over a placeholder tile.
    """

    def _make_tag(self, owner, photos, name="beach"):
        tag = Tag.objects.create(name=name, owner=owner)
        tag.photos.add(*photos)
        return tag

    def test_photo_count_reflects_remaining_photos_after_deletion(self):
        user = create_test_user()
        kept = create_test_photo(owner=user)
        # Survival of `kept` requires populated `files` and a `main_file`.
        kept.files.add(kept.main_file)
        missing = [create_test_photo(owner=user) for _ in range(3)]

        tag = self._make_tag(user, [kept, *missing])

        delete_missing_photos(user, str(uuid.uuid4()))

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)
        self.assertEqual(list(tag.photos.values_list("pk", flat=True)), [kept.pk])

    def test_an_emptied_tag_survives_with_a_zero_count(self):
        user = create_test_user()
        missing = [create_test_photo(owner=user) for _ in range(2)]
        tag = self._make_tag(user, missing)

        delete_missing_photos(user, str(uuid.uuid4()))

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 0)
        self.assertTrue(Tag.objects.filter(pk=tag.pk).exists())

    def test_tags_are_refreshed_once_not_once_per_photo(self):
        user = create_test_user()
        missing = [create_test_photo(owner=user) for _ in range(10)]
        self._make_tag(user, missing)

        with CaptureQueriesContext(connection) as queries:
            delete_missing_photos(user, str(uuid.uuid4()))

        tag_updates = [
            query["sql"]
            for query in queries.captured_queries
            if query["sql"].strip().upper().startswith("UPDATE")
            and "api_tag" in query["sql"]
            and "photo_count" in query["sql"]
        ]
        self.assertEqual(len(tag_updates), 1)

    def test_another_users_tag_is_left_alone(self):
        user = create_test_user()
        other_user = create_test_user()
        missing = create_test_photo(owner=user)
        theirs = create_test_photo(owner=other_user)
        theirs.files.add(theirs.main_file)

        mine = self._make_tag(user, [missing])
        not_mine = self._make_tag(other_user, [theirs])

        delete_missing_photos(user, str(uuid.uuid4()))

        mine.refresh_from_db()
        not_mine.refresh_from_db()
        self.assertEqual(mine.photo_count, 0)
        self.assertEqual(not_mine.photo_count, 1)
