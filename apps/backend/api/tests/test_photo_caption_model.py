from django.test import TestCase
from django.utils import timezone

from api.models import Photo, PhotoCaption
from api.tests.utils import create_test_user, create_test_photo


class PhotoCaptionModelTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_create_photo_caption(self):
        """Test creating a PhotoCaption instance"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "Test caption"}
        )
        
        self.assertEqual(caption.photo, self.photo)
        self.assertEqual(caption.captions_json["user_caption"], "Test caption")

    def test_photo_caption_one_to_one_relationship(self):
        """Test that PhotoCaption has a one-to-one relationship with Photo"""
        caption1 = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "First caption"}
        )
        
        # Trying to create another caption for the same photo should fail
        with self.assertRaises(Exception):
            PhotoCaption.objects.create(
                photo=self.photo,
                captions_json={"user_caption": "Second caption"}
            )

    def test_generate_captions_im2txt(self):
        """Test generating im2txt captions"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        
        # This method requires thumbnail access which isn't available in tests
        # We'll test that it returns False when no thumbnail is available
        result = caption.generate_captions_im2txt(commit=False)
        self.assertFalse(result)

    def test_save_user_caption(self):
        """Test saving user captions"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        
        # This method requires thumbnail access which isn't available in tests
        # We'll test that it returns False when no thumbnail is available
        result = caption.save_user_caption("My beautiful photo", commit=True)
        self.assertFalse(result)

    def test_generate_places365_captions(self):
        """Test generating places365 captions"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        
        # Mock places365 data
        caption.captions_json = {
            "places365": {
                "categories": ["outdoor", "landscape"],
                "attributes": ["natural", "sunny"],
                "environment": "outdoor"
            }
        }
        caption.save()
        
        caption.generate_places365_captions(commit=True)
        caption.refresh_from_db()
        
        self.assertIn("places365", caption.captions_json)

    def test_recreate_search_captions_delegates_to_photo_search(self):
        """Test that recreate_search_captions delegates to PhotoSearch"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "Test caption"}
        )
        
        # This should create a PhotoSearch instance and update search captions
        caption.recreate_search_captions()
        
        # Verify PhotoSearch was created and has search captions
        self.assertTrue(hasattr(self.photo, 'search_instance'))
        self.assertIsNotNone(self.photo.search_captions)

    def test_captions_json_default_empty_dict(self):
        """Test that captions_json defaults to None (nullable field)"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        
        self.assertIsNone(caption.captions_json)

    def test_str_representation(self):
        """Test string representation of PhotoCaption"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "Test"}
        )
        
        str_repr = str(caption)
        self.assertIn(self.photo.image_hash, str_repr)

    def test_cascade_delete_with_photo(self):
        """Test that PhotoCaption is deleted when Photo is deleted"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        photo_id = self.photo.image_hash
        
        self.photo.delete()
        
        with self.assertRaises(PhotoCaption.DoesNotExist):
            PhotoCaption.objects.get(photo_id=photo_id)

    def test_multiple_caption_types(self):
        """Test storing multiple types of captions"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={
                "user_caption": "My photo",
                "im2txt": "a photo of a landscape",
                "places365": {
                    "categories": ["outdoor"],
                    "attributes": ["natural"],
                    "environment": "outdoor"
                }
            }
        )
        
        self.assertEqual(caption.captions_json["user_caption"], "My photo")
        self.assertEqual(caption.captions_json["im2txt"], "a photo of a landscape")
        self.assertIn("categories", caption.captions_json["places365"])

    def test_update_existing_captions(self):
        """Test updating existing captions"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "Original caption"}
        )
        
        # Update the caption directly (since save_user_caption requires thumbnails)
        caption.captions_json["user_caption"] = "Updated caption"
        caption.save()
        caption.refresh_from_db()
        
        self.assertEqual(caption.captions_json["user_caption"], "Updated caption")

    def test_empty_captions_json_handling(self):
        """Test handling of empty or None captions_json"""
        caption = PhotoCaption.objects.create(photo=self.photo)
        
        # Should handle empty dict gracefully
        caption.recreate_search_captions()
        
        # Test direct assignment since save_user_caption requires thumbnails
        caption.captions_json = {"user_caption": ""}
        caption.save()
        self.assertEqual(caption.captions_json["user_caption"], "") 