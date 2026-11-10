"""0155 drops PhotoMetadata's copies of rating, caption, date and location (#2252).

Ratings and captions PATCHed through the metadata API only ever reached those
copies; the migration carries them over to ``Photo.rating`` and the lightbox
caption before the columns go. The tests step the real schema back to 0154,
write the rows a database of that version holds, and migrate forward (and
back) with the migration executor. SQLite will not alter tables inside a
``TestCase`` transaction, hence ``TransactionTestCase``.
"""

import datetime

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from api.models import Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import MetadataEdit
from api.models.photo_search import PhotoSearch

from ..utils import create_test_photo, create_test_user

BEFORE = [("api", "0154_metadata_edit_json_encoder")]
AFTER = [("api", "0155_photo_metadata_one_store")]
WHEN = datetime.datetime(2020, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)


class PhotoMetadataOneStoreMigrationTest(TransactionTestCase):
    def setUp(self):
        self.user = create_test_user()
        self.patched = create_test_photo(owner=self.user)
        self.snapshot = create_test_photo(owner=self.user)
        self.reverted = create_test_photo(owner=self.user)
        self.typed = create_test_photo(
            owner=self.user, captions_json={"user_caption": "typed in the lightbox"}
        )
        self.migrate(BEFORE)
        self.old_apps = self.executor.loader.project_state(BEFORE).apps

    def tearDown(self):
        # Leave the schema as every other test expects it, even on failure: the
        # latest migrations, not AFTER, or a later migration stays unapplied.
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.executor.loader.graph.leaf_nodes("api"))

    def migrate(self, targets):
        self.executor = MigrationExecutor(connection)
        self.executor.loader.build_graph()
        self.executor.migrate(targets)

    def old_metadata(self, photo, **values):
        PhotoMetadata = self.old_apps.get_model("api", "PhotoMetadata")
        PhotoMetadata.objects.update_or_create(photo_id=photo.pk, defaults=values)

    def edit(self, photo, field_name, new_value, minutes=0):
        edit = MetadataEdit.objects.create(
            photo=photo,
            user=self.user,
            field_name=field_name,
            old_value=None,
            new_value=new_value,
        )
        MetadataEdit.objects.filter(pk=edit.pk).update(
            created_at=WHEN + datetime.timedelta(minutes=minutes)
        )

    def rating_of(self, photo):
        # Only the column this migration knows: a full Photo row would also
        # select the columns later migrations add, which are not there yet.
        return Photo.objects.filter(pk=photo.pk).values_list("rating", flat=True)[0]

    def test_patched_ratings_and_captions_reach_the_app(self):
        self.old_metadata(self.patched, rating=5, caption="Grandma's 80th")
        self.edit(self.patched, "rating", 5)
        self.edit(self.patched, "caption", "Grandma's 80th")

        self.migrate(AFTER)

        self.assertEqual(self.rating_of(self.patched), 5)
        captions = PhotoCaption.objects.get(photo_id=self.patched.pk).captions_json
        self.assertEqual(captions["user_caption"], "Grandma's 80th")
        # Only this column, as in rating_of: later columns are not there yet.
        search_captions = (
            PhotoSearch.objects.filter(photo_id=self.patched.pk)
            .values_list("search_captions", flat=True)
            .get()
        )
        self.assertIn("Grandma's 80th", search_captions)

    def test_snapshots_without_an_edit_are_left_behind(self):
        # 0101 copied every lightbox caption into PhotoMetadata; a caption the
        # user deleted since must not come back.
        self.old_metadata(self.snapshot, rating=3, caption="deleted since")

        self.migrate(AFTER)

        self.assertEqual(self.rating_of(self.snapshot), 0)
        self.assertFalse(PhotoCaption.objects.filter(photo=self.snapshot).exists())

    def test_an_edit_undone_by_revert_all_is_left_behind(self):
        self.old_metadata(self.reverted, rating=2, caption="from the file")
        self.edit(self.reverted, "rating", 5, minutes=0)
        self.edit(self.reverted, "caption", "mine", minutes=0)
        self.edit(self.reverted, "_all", {"source": "embedded"}, minutes=1)

        self.migrate(AFTER)

        self.assertEqual(self.rating_of(self.reverted), 0)
        self.assertFalse(PhotoCaption.objects.filter(photo=self.reverted).exists())

    def test_a_lightbox_caption_wins_over_a_patched_one(self):
        self.old_metadata(self.typed, caption="patched")
        self.edit(self.typed, "caption", "patched")

        self.migrate(AFTER)

        captions = PhotoCaption.objects.get(photo=self.typed).captions_json
        self.assertEqual(captions["user_caption"], "typed in the lightbox")

    def test_reversing_fills_the_columns_from_the_photo(self):
        self.migrate(AFTER)
        Photo.objects.filter(pk=self.typed.pk).update(
            rating=4, exif_timestamp=WHEN, exif_gps_lat=1.5, exif_gps_lon=2.5
        )
        # The model as of AFTER: the current one selects columns later
        # migrations add, which are not there yet.
        after_apps = self.executor.loader.project_state(AFTER).apps
        after_apps.get_model("api", "PhotoMetadata").objects.get_or_create(
            photo_id=self.typed.pk
        )

        self.migrate(BEFORE)

        old_apps = self.executor.loader.project_state(BEFORE).apps
        row = old_apps.get_model("api", "PhotoMetadata").objects.get(
            photo_id=self.typed.pk
        )
        self.assertEqual(row.rating, 4)
        self.assertEqual(row.date_taken, WHEN)
        self.assertEqual((row.gps_latitude, row.gps_longitude), (1.5, 2.5))
        self.assertEqual(row.caption, "typed in the lightbox")
