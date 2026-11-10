import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models.duplicate import Duplicate

from ..utils import create_test_duplicate, create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0236 = importlib.import_module("api.migrations.0236_review_records")


class ReviewRecordsMigrationTest(TestCase):
    """Groups an older release reviewed, which recorded nothing of it."""

    def setUp(self):
        self.user = create_test_user()

    def test_a_resolved_group_records_its_trashed_photos_but_the_kept_one(self):
        kept = create_test_photo(owner=self.user, in_trashcan=True)
        trashed = create_test_photo(owner=self.user, in_trashcan=True)
        shown = create_test_photo(owner=self.user)
        group = create_test_duplicate(
            self.user,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=kept,
            trashed_count=1,
        )
        group.photos.add(kept, trashed, shown)

        migration_0236.record_trashed_photos(global_apps, None)

        self.assertEqual(list(group.trashed_photos.all()), [trashed])

    def test_a_pending_group_records_nothing(self):
        photo = create_test_photo(owner=self.user, in_trashcan=True)
        group = create_test_duplicate(self.user, trashed_count=1)
        group.photos.add(photo, create_test_photo(owner=self.user))

        migration_0236.record_trashed_photos(global_apps, None)

        self.assertFalse(group.trashed_photos.exists())

    def test_only_empty_dismissed_groups_are_deleted(self):
        empty = create_test_duplicate(
            self.user, review_status=Duplicate.ReviewStatus.DISMISSED
        )
        kept = create_test_duplicate(
            self.user, review_status=Duplicate.ReviewStatus.DISMISSED
        )
        kept.photos.add(create_test_photo(owner=self.user))
        pending = create_test_duplicate(self.user)

        migration_0236.delete_empty_dismissed_groups(global_apps, None)

        self.assertEqual(
            set(Duplicate.objects.values_list("pk", flat=True)), {kept.pk, pending.pk}
        )
        self.assertFalse(Duplicate.objects.filter(pk=empty.pk).exists())
