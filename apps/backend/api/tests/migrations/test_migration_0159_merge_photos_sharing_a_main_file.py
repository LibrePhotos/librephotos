import datetime
import importlib

from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase
from django.utils import timezone

from api.models import DeletionLog, Face, Photo
from api.models.photo_caption import PhotoCaption

from ..utils import (
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_tag,
    create_test_user,
)

# The module name starts with a digit, so a plain import cannot load it.
MIGRATION_NAME = "0159_merge_photos_sharing_a_main_file"
migration_0159 = importlib.import_module(f"api.migrations.{MIGRATION_NAME}")

BOX = {
    "location_top": 10,
    "location_bottom": 90,
    "location_left": 20,
    "location_right": 80,
}
OTHER_BOX = {
    "location_top": 110,
    "location_bottom": 190,
    "location_left": 120,
    "location_right": 180,
}


class MergePhotosSharingAMainFileMigrationTest(TestCase):
    """The rows repeated Nextcloud scans made of one file (#2257).

    Run on the historical models, as ``migrate`` runs it: no model method or
    signal receiver helps out.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        state = MigrationLoader(connection).project_state(("api", MIGRATION_NAME))
        cls.state_apps = state.apps

    def setUp(self):
        self.user = create_test_user()
        now = timezone.now()
        self.first = create_test_photo(
            owner=self.user, added_on=now - datetime.timedelta(days=7)
        )
        self.file = self.first.main_file
        # The second scan's copy, the one the user happened to edit.
        self.second = create_test_photo(
            owner=self.user, main_file=self.file, rating=4, added_on=now
        )

    def _run(self):
        migration_0159.merge_photos_sharing_a_main_file(self.state_apps, None)

    def test_leaves_one_photo_per_file_keeping_the_oldest(self):
        self._run()

        self.assertEqual(
            [self.first.pk],
            list(
                Photo.objects.filter(main_file=self.file).values_list("pk", flat=True)
            ),
        )

    def test_keeps_the_highest_rating(self):
        self._run()

        self.first.refresh_from_db()
        self.assertEqual(4, self.first.rating)

    def test_keeps_album_and_tag_memberships_of_every_copy(self):
        album = create_test_album_user(owner=self.user)
        album.photos.add(self.second)
        tag = create_test_tag(owner=self.user)
        tag.photos.add(self.first, self.second)

        self._run()

        self.assertEqual([self.first.pk], [p.pk for p in album.photos.all()])
        self.assertEqual([self.first.pk], [p.pk for p in tag.photos.all()])
        tag.refresh_from_db()
        self.assertEqual(1, tag.photo_count)

    def test_a_face_found_again_is_kept_once_with_its_label(self):
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=self.first, **BOX)
        labelled = create_test_face(photo=self.second, person=person, **BOX)
        elsewhere = create_test_face(photo=self.second, **OTHER_BOX)

        self._run()

        self.assertEqual(
            {labelled.pk, elsewhere.pk},
            set(Face.objects.filter(photo=self.first).values_list("pk", flat=True)),
        )
        person.refresh_from_db()
        self.assertEqual(1, person.face_count)

    def test_a_labelled_face_of_the_kept_photo_stays(self):
        person = create_test_person(cluster_owner=self.user)
        kept = create_test_face(photo=self.first, person=person, **BOX)
        create_test_face(photo=self.second, **BOX)

        self._run()

        self.assertEqual(
            [kept.pk],
            list(Face.objects.filter(photo=self.first).values_list("pk", flat=True)),
        )

    def test_a_caption_only_a_dropped_copy_has_moves_over(self):
        third = create_test_photo(
            owner=self.user,
            main_file=self.file,
            captions_json={"user_caption": "Grandma's garden"},
        )

        self._run()

        caption = PhotoCaption.objects.get(photo=self.first)
        self.assertEqual({"user_caption": "Grandma's garden"}, caption.captions_json)
        self.assertFalse(PhotoCaption.objects.filter(photo_id=third.pk).exists())

    def test_a_copy_in_the_trash_loses_to_one_that_is_not(self):
        self.first.in_trashcan = True
        self.first.save()

        self._run()

        self.assertEqual(
            [self.second.pk],
            list(
                Photo.objects.filter(main_file=self.file).values_list("pk", flat=True)
            ),
        )

    def test_a_stack_left_with_one_photo_is_removed(self):
        stack = create_test_stack(owner=self.user)
        stack.photos.add(self.first, self.second)

        self._run()

        self.assertFalse(type(stack).objects.filter(pk=stack.pk).exists())

    def test_sync_clients_are_told_the_dropped_row_is_gone(self):
        self._run()

        self.assertTrue(
            DeletionLog.objects.filter(
                entity="photo", entity_id=str(self.second.pk), owner=self.user
            ).exists()
        )

    def test_leaves_other_owners_and_other_files_alone(self):
        other_user = create_test_user()
        theirs = create_test_photo(owner=other_user, main_file=self.file)
        unrelated = create_test_photo(owner=self.user)

        self._run()

        self.assertTrue(Photo.objects.filter(pk=theirs.pk).exists())
        self.assertTrue(Photo.objects.filter(pk=unrelated.pk).exists())

    def test_three_copies_become_one(self):
        create_test_photo(owner=self.user, main_file=self.file)

        self._run()

        self.assertEqual(1, Photo.objects.filter(main_file=self.file).count())
