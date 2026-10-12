"""
Tests for social graph functionality.
"""

from django.test import TestCase
from django.utils import timezone

from api.faces.social_graph import build_social_graph
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class SocialGraphTestCase(TestCase):
    def setUp(self):
        """Set up test data."""
        self.user = create_test_user(username="testuser")

    def test_build_social_graph_no_data(self):
        """Test building social graph with no faces/photos."""
        result = build_social_graph(self.user)
        self.assertEqual(result, {"nodes": [], "links": []})

    def test_build_social_graph_single_person(self):
        """Test building social graph with single person (no connections)."""
        # Create a photo
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        # Create a person
        person = create_test_person(name="John Doe", cluster_owner=self.user)

        # Create a face
        create_test_face(
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
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        # Create two people
        person1 = create_test_person(name="Alice", cluster_owner=self.user)
        person2 = create_test_person(name="Bob", cluster_owner=self.user)

        # Create faces for both people in the same photo
        create_test_face(
            photo=photo,
            person=person1,
            location_top=0,
            location_bottom=100,
            location_left=0,
            location_right=100,
            encoding="0" * 256,
        )
        create_test_face(
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
