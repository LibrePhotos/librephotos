from django.test import TestCase
from django.db.models import Q
from constance import config as site_config

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


class DirectoryWatcherFixTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_generate_tags_query_works(self):
        """Test that the generate_tags query works with the new PhotoCaption model"""
        tagging_model = str(site_config.TAGGING_MODEL).strip().lower()
        # Create a photo without active-model tags
        photo = create_test_photo(owner=self.user)

        # Add some caption data to the photo (but NOT the active model tags)
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "im2txt": "A beautiful landscape",
            "user_caption": "My vacation photo",
        }
        caption_instance.save()

        # This query should work without FieldError
        existing_photos = Photo.objects.filter(
            Q(owner=self.user.id)
            & (
                Q(caption_instance__isnull=True)
                | Q(caption_instance__captions_json__isnull=True)
                | Q(**{f"caption_instance__captions_json__{tagging_model}__isnull": True})
            )
        )

        # Should find the photo since it has no active-model tags
        self.assertEqual(existing_photos.count(), 1)
        self.assertEqual(existing_photos.first(), photo)

    def test_generate_tags_query_excludes_photos_with_active_model_tags(self):
        """Test that photos with active-model tags are excluded"""
        tagging_model = str(site_config.TAGGING_MODEL).strip().lower()
        # Create a photo with active-model tags
        photo = create_test_photo(owner=self.user)
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {tagging_model: {"tags": ["outdoor", "sunny"]}}
        caption_instance.save()

        # This query should exclude the photo since it has active-model tags
        existing_photos = Photo.objects.filter(
            Q(owner=self.user.id)
            & (
                Q(caption_instance__isnull=True)
                | Q(caption_instance__captions_json__isnull=True)
                | Q(**{f"caption_instance__captions_json__{tagging_model}__isnull": True})
            )
        )

        # Should not find the photo since it has active-model tags
        self.assertEqual(existing_photos.count(), 0)
