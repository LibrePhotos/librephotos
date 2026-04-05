"""
Tests for social graph functionality.
"""

from django.test import TestCase
from django.utils import timezone

from api.models import Face, Person, Photo, User
from api.social_graph import build_social_graph


class SocialGraphTestCase(TestCase):
    def setUp(self):
        """Set up test data."""
        self.user = User.objects.create_user(username="testuser", password="testpass")

    def test_build_social_graph_no_data(self):
        """Test building social graph with no faces/photos."""
        result = build_social_graph(self.user)
        self.assertEqual(result, {"nodes": [], "links": []})

    def test_build_social_graph_single_person(self):
        """Test building social graph with single person (no connections)."""
        # Create a photo
        photo = Photo.objects.create(
            owner=self.user,
            image_hash="testhash1",
            added_on=timezone.now(),
        )

        # Create a person
        person = Person.objects.create(name="John Doe", cluster_owner=self.user)

        # Create a face
        Face.objects.create(
            photo=photo,
            person=person,
            location_top=0,
            location_bottom=100,
            location_left=0,
            location_right=100,
            encoding="0" * 256,  # Dummy encoding
        )

        # Should return empty since we need at least 2 people in same photo for connections
        result = build_social_graph(self.user)
        self.assertEqual(result, {"nodes": [], "links": []})

    def test_build_social_graph_two_people_same_photo(self):
        """Test building social graph with two people in same photo."""
        # Create a photo
        photo = Photo.objects.create(
            owner=self.user,
            image_hash="testhash2",
            added_on=timezone.now(),
        )

        # Create two people
        person1 = Person.objects.create(name="Alice", cluster_owner=self.user)
        person2 = Person.objects.create(name="Bob", cluster_owner=self.user)

        # Create faces for both people in the same photo
        Face.objects.create(
            photo=photo,
            person=person1,
            location_top=0,
            location_bottom=100,
            location_left=0,
            location_right=100,
            encoding="0" * 256,
        )
        Face.objects.create(
            photo=photo,
            person=person2,
            location_top=0,
            location_bottom=100,
            location_left=100,
            location_right=200,
            encoding="1" * 256,
        )

        result = build_social_graph(self.user)

        # Should have 2 nodes and 1 link
        self.assertEqual(len(result["nodes"]), 2)
        self.assertEqual(len(result["links"]), 1)

        # Check node names
        node_ids = {node["id"] for node in result["nodes"]}
        self.assertEqual(node_ids, {"Alice", "Bob"})

        # Check link
        link = result["links"][0]
        self.assertIn(link["source"], {"Alice", "Bob"})
        self.assertIn(link["target"], {"Alice", "Bob"})
        self.assertNotEqual(link["source"], link["target"])
