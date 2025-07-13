from django.test import TestCase
from django.db.models import Q

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


class DirectoryWatcherFixTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_generate_tags_query_works(self):
        """Test that the generate_tags query works with the new PhotoCaption model"""
        # Create a photo without captions
        photo = create_test_photo(owner=self.user)

        # Add some caption data to the photo
        caption_instance = photo._get_or_create_caption_instance()
        caption_instance.captions_json = {
            "places365": {
                "categories": ["outdoor", "nature"],
                "attributes": ["sunny", "green"],
            },
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
                | Q(caption_instance__captions_json__places365__isnull=True)
            )
        )

        # Should find the photo since it has no captions
        self.assertEqual(existing_photos.count(), 1)
        self.assertEqual(existing_photos.first(), photo)

    def test_generate_tags_query_excludes_photos_with_places365(self):
        """Test that photos with places365 captions are excluded"""
        # Create a photo with places365 captions
        photo = create_test_photo(owner=self.user)
        caption_instance = photo._get_or_create_caption_instance()
        caption_instance.captions_json = {
            "places365": {"categories": ["outdoor"], "attributes": ["sunny"]}
        }
        caption_instance.save()

        # This query should exclude the photo since it has places365 captions
        existing_photos = Photo.objects.filter(
            Q(owner=self.user.id)
            & (
                Q(caption_instance__isnull=True)
                | Q(caption_instance__captions_json__isnull=True)
                | Q(caption_instance__captions_json__places365__isnull=True)
            )
        )

        # Should not find the photo since it has places365 captions
        self.assertEqual(existing_photos.count(), 0)
