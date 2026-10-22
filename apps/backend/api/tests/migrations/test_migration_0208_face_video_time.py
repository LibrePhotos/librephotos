import importlib

from django.apps import apps as global_apps
from django.test import TestCase
from django.utils import timezone

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration = importlib.import_module("api.migrations.0208_face_video_time")


class FaceVideoTimeMigrationTest(TestCase):
    """Scanned videos are scanned again for their later frames (#2761)."""

    def test_only_videos_count_as_not_scanned_again(self) -> None:
        user = create_test_user()
        scanned = timezone.now()
        video = create_test_photo(owner=user, video=True)
        photo = create_test_photo(owner=user)
        Photo.objects.filter(pk__in=[video.pk, photo.pk]).update(
            faces_scanned_at=scanned
        )

        migration.forwards(global_apps, None)

        self.assertIsNone(Photo.objects.get(pk=video.pk).faces_scanned_at)
        self.assertEqual(scanned, Photo.objects.get(pk=photo.pk).faces_scanned_at)
