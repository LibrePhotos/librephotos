from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class IncompleteFacesTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def test_if_classification_person_is_ignored_if_below_threshold(self):
        """Test if unknown faces with classification are returned. Only classification_probability and min_confidence should be looked into."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.4,
        )

        response = self.client.get(
            reverse("incomplete_faces-list"),
            {
                "inferred": "true",
                "analysis_method": "classification",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertIn(
            "Unknown - Other", response.data[0]["name"]
        )  # Ensure unknown face is returned

    def test_if_min_confidence_and_prob_are_compared_correctly(
        self,
    ):
        """Test that incomplete faces with classification analysis method are returned properly."""
        create_test_face(
            photo=self.photo,
            classification_probability=0.3,
        )
        create_test_face(
            photo=self.photo,
            classification_probability=0.4,
        )
        create_test_face(
            photo=self.photo,
            classification_probability=0.6,
        )

        response = self.client.get(
            reverse("incomplete_faces-list"),
            {
                "inferred": "true",
                "analysis_method": "classification",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "Unknown - Other", response.data[0]["name"]
        )  # Ensure unknown face is returned
        # face count should be number of faces with classification probability less than 0.5
        self.assertEqual(response.data[0]["face_count"], 2)

    def test_incomplete_faces_with_clustering(self):
        """Test that incomplete faces with clustering analysis method are returned properly."""
        create_test_face(
            photo=self.photo,
            classification_person=None,
            classification_probability=0.5,
            cluster_person=None,
            cluster_probability=0.8,
        )
        create_test_face(
            photo=self.photo,
            classification_person=None,
            classification_probability=0.5,
            cluster_person=None,
            cluster_probability=0.4,
        )

        response = self.client.get(
            reverse("incomplete_faces-list"),
            {
                "inferred": "true",
                "analysis_method": "clustering",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("Unknown - Other", response.data[0]["name"])
        # face count should be number of faces with clustering person = None
        self.assertEqual(response.data[0]["face_count"], 2)

    def test_no_inferred_faces(self):
        """Test when there are no inferred faces and only user-labeled faces should appear."""
        person = create_test_person(name="John Doe", cluster_owner=self.user)
        create_test_face(photo=self.photo, person=person)

        response = self.client.get(
            reverse("incomplete_faces-list"), {"inferred": "false"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "John Doe", response.data[0]["name"]
        )  # Ensure user-labeled face is returned


class FaceListViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def test_min_confidence_when_classification(self):
        """Test that faces with classification are returned properly."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.6,
        )
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.4,
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": person.id,
                "analysis_method": "classification",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)

    def test_min_confidence_but_for_unknown_other(self):
        """Test that unknown faces with classification are returned properly."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.4,
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": "0",
                "analysis_method": "classification",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(0.4, response.data["results"][0]["person_label_probability"])

    def test_min_confidence_when_clustering(self):
        """Test that faces with clustering are returned properly."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo, cluster_person=person, cluster_probability=0.6
        )
        create_test_face(
            photo=self.photo, cluster_person=person, cluster_probability=0.4
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": person.id,
                "analysis_method": "clustering",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)

    def test_min_confidence_when_clustering_and_unknown(self):
        """Test that unknown faces with clustering are returned properly."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo, cluster_person=person, cluster_probability=0.4
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": "0",
                "analysis_method": "clustering",
                "min_confidence": "0.5",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(0.4, response.data["results"][0]["person_label_probability"])

    def test_face_list_classification_order_by_probability(self):
        """Test that faces with classification are ordered by classification probability."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.7,
        )
        create_test_face(
            photo=self.photo,
            classification_person=person,
            classification_probability=0.9,
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": person.id,
                "analysis_method": "classification",
                "order_by": "probability",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertGreater(
            response.data["results"][0]["person_label_probability"],
            response.data["results"][1]["person_label_probability"],
        )

    def test_face_list_clustering_order_by_probability(self):
        """Test that faces with clustering are ordered by clustering probability."""
        person = create_test_person(cluster_owner=self.user)
        create_test_face(
            photo=self.photo, cluster_person=person, cluster_probability=0.6
        )
        create_test_face(
            photo=self.photo, cluster_person=person, cluster_probability=0.9
        )

        response = self.client.get(
            reverse("faces-list"),
            {
                "person": person.id,
                "analysis_method": "clustering",
                "order_by": "probability",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertGreater(
            response.data["results"][0]["person_label_probability"],
            response.data["results"][1]["person_label_probability"],
        )

    def test_face_list_order_by_date(self):
        """Test that faces can be ordered by the photo's timestamp when 'order_by' is set to 'date'."""
        person = create_test_person(cluster_owner=self.user)
        photo = create_test_photo(
            owner=self.user, exif_timestamp="2021-01-01T00:00:00Z"
        )
        photo2 = create_test_photo(
            owner=self.user, exif_timestamp="2021-01-02T00:00:00Z"
        )
        create_test_face(photo=photo, person=person)
        create_test_face(photo=photo2, person=person)
        response = self.client.get(
            reverse("faces-list"),
            {"person": person.id, "inferred": False, "order_by": "date"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertLess(
            response.data["results"][0]["timestamp"],
            response.data["results"][1]["timestamp"],
        )
