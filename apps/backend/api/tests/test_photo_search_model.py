from django.test import TestCase
from django.utils import timezone

from api.models import Photo, PhotoSearch, PhotoCaption, Face, Person
from api.tests.utils import create_test_user, create_test_photo, create_test_face, create_test_person


class PhotoSearchModelTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_create_photo_search(self):
        """Test creating a PhotoSearch instance"""
        search = PhotoSearch.objects.create(
            photo=self.photo,
            search_captions="outdoor nature sunny",
            search_location="New York, USA"
        )
        
        self.assertEqual(search.photo, self.photo)
        self.assertEqual(search.search_captions, "outdoor nature sunny")
        self.assertEqual(search.search_location, "New York, USA")

    def test_photo_search_one_to_one_relationship(self):
        """Test that PhotoSearch has a one-to-one relationship with Photo"""
        search1 = PhotoSearch.objects.create(
            photo=self.photo,
            search_captions="first search"
        )
        
        # Trying to create another search for the same photo should fail
        with self.assertRaises(Exception):
            PhotoSearch.objects.create(
                photo=self.photo,
                search_captions="second search"
            )

    def test_recreate_search_captions_with_places365(self):
        """Test recreating search captions with places365 data"""
        # Create PhotoCaption with places365 data
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={
                "places365": {
                    "attributes": ["natural", "sunny"],
                    "categories": ["outdoor", "landscape"],
                    "environment": "outdoor"
                }
            }
        )
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        self.assertIn("natural", search.search_captions)
        self.assertIn("sunny", search.search_captions)
        self.assertIn("outdoor", search.search_captions)
        self.assertIn("landscape", search.search_captions)

    def test_recreate_search_captions_with_user_caption(self):
        """Test recreating search captions with user caption"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"user_caption": "My beautiful vacation photo"}
        )
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        self.assertIn("My beautiful vacation photo", search.search_captions)

    def test_recreate_search_captions_with_im2txt(self):
        """Test recreating search captions with im2txt caption"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={"im2txt": "a photo of a mountain landscape"}
        )
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        self.assertIn("a photo of a mountain landscape", search.search_captions)

    def test_recreate_search_captions_with_faces(self):
        """Test recreating search captions with face names"""
        person = create_test_person(name="John Doe", cluster_owner=self.user)
        face = create_test_face(photo=self.photo, person=person)
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        self.assertIn("John Doe", search.search_captions)

    def test_recreate_search_captions_with_file_path(self):
        """Test recreating search captions with file path"""
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        # Should include the file path
        self.assertIn(self.photo.main_file.path, search.search_captions)

    def test_recreate_search_captions_with_video(self):
        """Test recreating search captions for video files"""
        video_photo = create_test_photo(owner=self.user, video=True)
        search = PhotoSearch.objects.create(photo=video_photo)
        search.recreate_search_captions()
        
        self.assertIn("type: video", search.search_captions)

    def test_recreate_search_captions_with_camera_info(self):
        """Test recreating search captions with camera information"""
        camera_photo = create_test_photo(
            owner=self.user,
            camera="Canon EOS 5D",
            lens="Canon 24-70mm"
        )
        search = PhotoSearch.objects.create(photo=camera_photo)
        search.recreate_search_captions()
        
        self.assertIn("Canon EOS 5D", search.search_captions)
        self.assertIn("Canon 24-70mm", search.search_captions)

    def test_update_search_location(self):
        """Test updating search location"""
        search = PhotoSearch.objects.create(photo=self.photo)
        
        geolocation_data = {
            "features": [
                {"text": "New York"},
                {"text": "USA"}
            ]
        }
        
        search.update_search_location(geolocation_data)
        
        self.assertIn("New York", search.search_location)
        self.assertIn("USA", search.search_location)

    def test_update_search_location_with_empty_data(self):
        """Test updating search location with empty data"""
        search = PhotoSearch.objects.create(photo=self.photo)
        
        search.update_search_location({})
        
        self.assertEqual(search.search_location, "")

    def test_search_captions_default_empty(self):
        """Test that search_captions defaults to None (nullable field)"""
        search = PhotoSearch.objects.create(photo=self.photo)
        
        self.assertIsNone(search.search_captions)

    def test_search_location_default_empty(self):
        """Test that search_location defaults to None (nullable field)"""
        search = PhotoSearch.objects.create(photo=self.photo)
        
        self.assertIsNone(search.search_location)

    def test_str_representation(self):
        """Test string representation of PhotoSearch"""
        search = PhotoSearch.objects.create(
            photo=self.photo,
            search_captions="test captions"
        )
        
        str_repr = str(search)
        self.assertIn(self.photo.image_hash, str_repr)

    def test_cascade_delete_with_photo(self):
        """Test that PhotoSearch is deleted when Photo is deleted"""
        search = PhotoSearch.objects.create(photo=self.photo)
        photo_id = self.photo.image_hash
        
        self.photo.delete()
        
        with self.assertRaises(PhotoSearch.DoesNotExist):
            PhotoSearch.objects.get(photo_id=photo_id)

    def test_recreate_search_captions_comprehensive(self):
        """Test recreating search captions with all types of data"""
        # Create comprehensive test data
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={
                "user_caption": "My vacation",
                "im2txt": "a beautiful landscape",
                "places365": {
                    "attributes": ["natural", "sunny"],
                    "categories": ["outdoor"],
                    "environment": "outdoor"
                }
            }
        )
        
        person = create_test_person(name="Jane Smith", cluster_owner=self.user)
        face = create_test_face(photo=self.photo, person=person)
        
        # Update photo with camera info
        self.photo.camera = "Nikon D850"
        self.photo.lens = "Nikon 50mm"
        self.photo.save()
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        # Verify all components are included
        self.assertIn("My vacation", search.search_captions)
        self.assertIn("a beautiful landscape", search.search_captions)
        self.assertIn("natural", search.search_captions)
        self.assertIn("sunny", search.search_captions)
        self.assertIn("outdoor", search.search_captions)
        self.assertIn("Jane Smith", search.search_captions)
        self.assertIn("Nikon D850", search.search_captions)
        self.assertIn("Nikon 50mm", search.search_captions)

    def test_search_captions_indexing(self):
        """Test that search_captions field is properly indexed"""
        # This is more of a model definition test
        field = PhotoSearch._meta.get_field('search_captions')
        self.assertTrue(field.db_index)

    def test_search_location_indexing(self):
        """Test that search_location field is properly indexed"""
        field = PhotoSearch._meta.get_field('search_location')
        self.assertTrue(field.db_index)

    def test_empty_places365_handling(self):
        """Test handling of empty places365 data"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={
                "places365": {
                    "attributes": [],
                    "categories": [],
                    "environment": ""
                }
            }
        )
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        # Should not crash and should handle empty data gracefully
        self.assertIsInstance(search.search_captions, str)

    def test_none_values_handling(self):
        """Test handling of None values in caption data"""
        caption = PhotoCaption.objects.create(
            photo=self.photo,
            captions_json={
                "user_caption": None,
                "im2txt": None
            }
        )
        
        search = PhotoSearch.objects.create(photo=self.photo)
        search.recreate_search_captions()
        
        # Should not crash with None values
        self.assertIsInstance(search.search_captions, str) 