from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user


class FavoritePhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user(favorite_min_rating=1)
        self.user2 = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user1)

    def test_tag_my_photos_as_favorite(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user1)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(3, data["count"])
        self.assertEqual(3, len(data["updated_hashes"]))
        self.assertEqual(0, len(data["not_updated_hashes"]))

    def test_untag_my_photos_as_favorite(self):
        photos1 = create_test_photos(
            number_of_photos=1, owner=self.user1, rating=self.user1.favorite_min_rating
        )
        photos2 = create_test_photos(number_of_photos=2, owner=self.user1)
        image_hashes = [p.image_hash for p in photos1 + photos2]

        payload = {"image_hashes": image_hashes, "favorite": False}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(1, data["count"])
        self.assertEqual(1, len(data["updated_hashes"]))
        self.assertEqual(2, len(data["not_updated_hashes"]))

    def test_tag_photos_of_other_user_as_favorite(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user2)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, data["count"])
        self.assertEqual(0, len(data["updated_hashes"]))
        # Photos not owned by user are treated as "missing" for security (no info leak)
        self.assertEqual(0, len(data["not_updated_hashes"]))

    @patch("api.views.photos.logger.warning", autospec=True)
    def test_tag_nonexistent_photo_as_favorite(self, logger):
        payload = {"image_hashes": ["nonexistent_photo"], "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, data["count"])
        self.assertEqual(0, len(data["updated_hashes"]))
        self.assertEqual(0, len(data["not_updated_hashes"]))
        logger.assert_called_with(
            "Could not set photo %s to %s. It does not exist or is not owned by user.",
            "nonexistent_photo",
            "favorite",
        )


class UnfavoriteClearsRatingTest(TestCase):
    """Un-favorite sets the rating to 0, whatever it was (#2202, option A).

    The web never calls /photosedit/favorite/ for a user in stars mode, and the
    rating style setting says that removing a favorite clears the stars.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=4)
        self.client.force_authenticate(user=self.user)

    def test_unfavorite_of_a_five_star_photo_sets_rating_to_zero(self):
        photo = create_test_photos(number_of_photos=1, owner=self.user, rating=5)[0]

        response = self.client.post(
            "/api/photosedit/favorite/",
            format="json",
            data={"image_hashes": [photo.image_hash], "favorite": False},
        )

        self.assertEqual(200, response.status_code)
        photo.refresh_from_db()
        self.assertEqual(0, photo.rating)

    def test_favorite_sets_rating_to_the_threshold(self):
        photo = create_test_photos(number_of_photos=1, owner=self.user, rating=1)[0]

        self.client.post(
            "/api/photosedit/favorite/",
            format="json",
            data={"image_hashes": [photo.image_hash], "favorite": True},
        )

        photo.refresh_from_db()
        self.assertEqual(4, photo.rating)
