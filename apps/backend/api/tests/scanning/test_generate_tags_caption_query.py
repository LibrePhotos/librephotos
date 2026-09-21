from django.test import TestCase
from django.db.models import Q

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


class DirectoryWatcherFixTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_generate_tags_query_works(self):
        """Test that the generate_tags query works with the new PhotoCaption model"""
        # Create a photo without mobileclip_s2 captions
        photo = create_test_photo(owner=self.user)

        # Add some caption data to the photo (but NOT mobileclip_s2)
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
                | Q(caption_instance__captions_json__mobileclip_s2__isnull=True)
            )
        )

        # Should find the photo since it has no mobileclip_s2 captions
        self.assertEqual(existing_photos.count(), 1)
        self.assertEqual(existing_photos.first(), photo)

    def test_generate_tags_query_excludes_photos_with_mobileclip_s2(self):
        """Test that photos with mobileclip_s2 captions are excluded"""
        # Create a photo with mobileclip_s2 captions
        photo = create_test_photo(owner=self.user)
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "mobileclip_s2": {"tags": ["outdoor", "sunny"]}
        }
        caption_instance.save()

        # This query should exclude the photo since it has mobileclip_s2 captions
        existing_photos = Photo.objects.filter(
            Q(owner=self.user.id)
            & (
                Q(caption_instance__isnull=True)
                | Q(caption_instance__captions_json__isnull=True)
                | Q(caption_instance__captions_json__mobileclip_s2__isnull=True)
            )
        )

        # Should not find the photo since it has mobileclip_s2 captions
        self.assertEqual(existing_photos.count(), 0)
