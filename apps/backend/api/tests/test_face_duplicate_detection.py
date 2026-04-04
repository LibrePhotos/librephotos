"""Tests for duplicate face detection using IoU-based overlap checking."""

from django.test import TestCase

from api.admin import deduplicate_faces_function
from api.models.photo import _overlaps_existing_face
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)
from api.util import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou


class CalculateIoUTest(TestCase):
    """Tests for the calculate_iou utility function."""

    def test_identical_boxes(self):
        """Identical boxes should have IoU of 1.0."""
        iou = calculate_iou(100, 300, 300, 100, 100, 300, 300, 100)
        self.assertAlmostEqual(iou, 1.0)

    def test_no_overlap(self):
        """Non-overlapping boxes should have IoU of 0.0."""
        iou = calculate_iou(0, 100, 100, 0, 200, 300, 300, 200)
        self.assertAlmostEqual(iou, 0.0)

    def test_partial_overlap(self):
        """Partially overlapping boxes should have IoU between 0 and 1."""
        # Box1: (100, 300, 300, 100) -> 200x200 = 40000
        # Box2: (150, 350, 350, 150) -> 200x200 = 40000
        # Intersection: (150, 300, 300, 150) -> 150x150 = 22500
        # Union: 40000 + 40000 - 22500 = 57500
        # IoU: 22500 / 57500 ≈ 0.3913
        iou = calculate_iou(100, 300, 300, 100, 150, 350, 350, 150)
        self.assertAlmostEqual(iou, 22500 / 57500, places=4)

    def test_one_box_inside_another(self):
        """When one box is entirely inside another, IoU equals the ratio of their areas."""
        # Box1: (0, 200, 200, 0) -> 200x200 = 40000
        # Box2: (50, 150, 150, 50) -> 100x100 = 10000
        # Intersection: 100x100 = 10000
        # Union: 40000 + 10000 - 10000 = 40000
        # IoU: 10000 / 40000 = 0.25
        iou = calculate_iou(0, 200, 200, 0, 50, 150, 150, 50)
        self.assertAlmostEqual(iou, 0.25)

    def test_zero_area_box(self):
        """A degenerate box with zero area should return 0."""
        iou = calculate_iou(100, 100, 100, 100, 100, 200, 200, 100)
        self.assertAlmostEqual(iou, 0.0)

    def test_adjacent_boxes(self):
        """Boxes that share an edge but do not overlap should have IoU 0."""
        iou = calculate_iou(0, 100, 100, 0, 0, 200, 100, 100)
        self.assertAlmostEqual(iou, 0.0)

    def test_slightly_shifted_face(self):
        """A face shifted by ~15 % of its size should still produce high IoU."""
        # Original: 200x200 at (100, 300, 300, 100)
        # Shifted:  200x200 at (130, 330, 330, 130)
        # Intersection: (130, 300, 300, 130) -> 170x170 = 28900
        # Union: 40000 + 40000 - 28900 = 51100
        iou = calculate_iou(100, 300, 300, 100, 130, 330, 330, 130)
        self.assertAlmostEqual(iou, 28900 / 51100, places=4)
        self.assertGreater(iou, FACE_OVERLAP_IOU_THRESHOLD)

    def test_significantly_shifted_face_below_threshold(self):
        """A large shift should produce IoU below the threshold."""
        # Original: 200x200 at (100, 300, 300, 100)
        # Shifted by 150px: (250, 450, 450, 250)
        # Intersection: (250, 300, 300, 250) -> 50x50 = 2500
        # Union: 40000 + 40000 - 2500 = 77500
        iou = calculate_iou(100, 300, 300, 100, 250, 450, 450, 250)
        self.assertAlmostEqual(iou, 2500 / 77500, places=4)
        self.assertLess(iou, FACE_OVERLAP_IOU_THRESHOLD)


class OverlapsExistingFaceTest(TestCase):
    """Tests for _overlaps_existing_face in the photo model."""

    def test_no_existing_faces(self):
        """When no faces exist on the photo, should return False."""
        self.assertFalse(
            _overlaps_existing_face([], 100, 300, 300, 100)
        )

    def test_overlapping_face_detected(self):
        """A new face that overlaps significantly with an existing face should be rejected."""
        existing = [(100, 300, 300, 100)]
        # Slightly shifted face — high IoU
        self.assertTrue(
            _overlaps_existing_face(existing, 110, 310, 310, 110)
        )

    def test_non_overlapping_face_allowed(self):
        """A new face far away from the existing face should not be rejected."""
        existing = [(100, 300, 300, 100)]
        # Completely different region
        self.assertFalse(
            _overlaps_existing_face(existing, 500, 700, 700, 500)
        )

    def test_same_face_different_model_sizes(self):
        """A tighter or wider bounding box around the same face should be detected."""
        # Existing face: large box
        existing = [(50, 350, 350, 50)]
        # New face: smaller box centred inside the large one
        # Box2: (100, 300, 300, 100) -> 200x200 = 40000
        # Intersection: (100, 300, 300, 100) -> 200x200 = 40000
        # Box1 area: 300x300 = 90000
        # Union: 90000 + 40000 - 40000 = 90000
        # IoU: 40000 / 90000 ≈ 0.444
        self.assertTrue(
            _overlaps_existing_face(existing, 100, 300, 300, 100)
        )


class DeduplicateFacesFunctionTest(TestCase):
    """Tests for the admin deduplicate_faces_function."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_no_duplicates(self):
        """When faces don't overlap, no faces should be deleted."""
        create_test_face(
            photo=self.photo,
            location_top=0,
            location_right=100,
            location_bottom=100,
            location_left=0,
        )
        create_test_face(
            photo=self.photo,
            location_top=500,
            location_right=600,
            location_bottom=600,
            location_left=500,
        )
        deduplicate_faces_function([self.photo])
        self.assertEqual(self.photo.faces.count(), 2)

    def test_duplicate_faces_removed(self):
        """Two overlapping faces should be deduplicated to one."""
        create_test_face(
            photo=self.photo,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )
        create_test_face(
            photo=self.photo,
            location_top=120,
            location_right=320,
            location_bottom=320,
            location_left=120,
        )
        deduplicate_faces_function([self.photo])
        self.assertEqual(self.photo.faces.count(), 1)

    def test_keeps_face_with_person_label(self):
        """When deduplicating, the face with a person label should be kept."""
        person = create_test_person(name="Alice", cluster_owner=self.user)
        # Unlabeled face
        create_test_face(
            photo=self.photo,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
            person=None,
        )
        # Labeled face (slightly shifted)
        labeled = create_test_face(
            photo=self.photo,
            location_top=120,
            location_right=320,
            location_bottom=320,
            location_left=120,
            person=person,
        )
        deduplicate_faces_function([self.photo])
        remaining = list(self.photo.faces.all())
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].id, labeled.id)

    def test_multiple_distinct_faces_with_one_duplicate(self):
        """Three faces: two overlap, one is separate. Should end up with two."""
        create_test_face(
            photo=self.photo,
            location_top=100,
            location_right=300,
            location_bottom=300,
            location_left=100,
        )
        # Near-duplicate of the first face
        create_test_face(
            photo=self.photo,
            location_top=110,
            location_right=310,
            location_bottom=310,
            location_left=110,
        )
        # Completely separate face
        create_test_face(
            photo=self.photo,
            location_top=600,
            location_right=800,
            location_bottom=800,
            location_left=600,
        )
        deduplicate_faces_function([self.photo])
        self.assertEqual(self.photo.faces.count(), 2)
