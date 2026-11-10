"""A duplicate group's review moves between pending, resolved and dismissed.

Resolving trashed every other photo of the group, whatever its state, and
reverting took every trashed photo of the group out of the trash, so a photo
the user had trashed on their own came back. Resolving again re-trashed with
the kept photo still in the trash, and "Not duplicates" unlinked the photos,
leaving an empty row that no list showed. The group now records the photos
its resolve trashed, and every transition starts by undoing that.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Person, Photo
from api.models.duplicate import Duplicate
from api.models.photo import trash_photos
from api.tests.utils import (
    create_test_duplicate,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)


def in_trash(*photos: Photo) -> list[bool]:
    return [Photo.objects.get(pk=photo.pk).in_trashcan for photo in photos]


class DuplicateReviewTransitionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.a = create_test_photo(owner=self.user)
        self.b = create_test_photo(owner=self.user)
        self.c = create_test_photo(owner=self.user)
        self.group = create_test_duplicate(
            owner=self.user, duplicate_type=Duplicate.DuplicateType.EXACT_COPY
        )
        self.group.photos.add(self.a, self.b, self.c)

    def test_revert_restores_only_what_the_resolve_trashed(self):
        trash_photos(Photo.objects.filter(pk=self.c.pk))

        self.group.resolve(self.a)
        self.assertEqual(self.group.trashed_count, 1)
        restored = self.group.revert()

        self.assertEqual(restored, 1)
        self.assertEqual(in_trash(self.a, self.b, self.c), [False, False, True])

    def test_a_photo_trashed_after_the_resolve_stays_in_the_trash(self):
        self.group.resolve(self.a)
        trash_photos(Photo.objects.filter(pk=self.a.pk))

        self.group.revert()

        self.assertEqual(in_trash(self.a, self.b, self.c), [True, False, False])

    def test_resolving_again_keeps_the_new_choice_out_of_the_trash(self):
        self.group.resolve(self.a)
        self.group.resolve(self.b)

        self.assertEqual(in_trash(self.a, self.b, self.c), [True, False, True])
        self.group.refresh_from_db()
        self.assertEqual(self.group.kept_photo, self.b)
        self.assertEqual(self.group.trashed_count, 2)

        self.group.revert()
        self.assertEqual(in_trash(self.a, self.b, self.c), [False, False, False])

    def test_a_stale_copy_of_the_group_cannot_resolve_it_twice(self):
        """Two requests load the pending group; both resolve it."""
        stale = Duplicate.objects.get(pk=self.group.pk)
        self.group.resolve(self.a)

        stale.resolve(self.b)

        self.assertEqual(in_trash(self.a, self.b, self.c), [True, False, True])
        self.group.refresh_from_db()
        self.assertEqual(self.group.trashed_count, 2)
        self.group.revert()
        self.assertEqual(in_trash(self.a, self.b, self.c), [False, False, False])

    def test_revert_gives_the_tags_their_photos_back(self):
        tag = create_test_tag(self.user)
        tag.photos.add(self.a, self.b)
        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 2)

        self.group.resolve(self.a)
        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)

        self.group.revert()
        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 2)

    def test_revert_gives_the_people_their_faces_back(self):
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=self.a, person=person)
        create_test_face(photo=self.b, person=person)
        person._calculate_face_count()

        self.group.resolve(self.a)
        self.assertEqual(Person.objects.get(pk=person.pk).face_count, 1)

        self.group.revert()
        self.assertEqual(Person.objects.get(pk=person.pk).face_count, 2)

    def test_not_duplicates_keeps_the_group_and_its_photos(self):
        self.group.dismiss()

        self.group.refresh_from_db()
        self.assertEqual(self.group.review_status, Duplicate.ReviewStatus.DISMISSED)
        self.assertEqual(self.group.photos.count(), 3)

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get("/api/duplicates/", {"status": "dismissed"})
        self.assertEqual(
            [row["id"] for row in response.json()["results"]], [str(self.group.pk)]
        )

    def test_not_duplicates_after_a_resolve_takes_its_photos_out_of_the_trash(self):
        self.group.resolve(self.a)

        self.group.dismiss()

        self.assertEqual(in_trash(self.a, self.b, self.c), [False, False, False])
        self.group.refresh_from_db()
        self.assertEqual(self.group.trashed_count, 0)

    def test_detection_leaves_a_dismissed_group_alone(self):
        self.group.dismiss()

        found = Duplicate.create_or_merge(
            self.user, Duplicate.DuplicateType.EXACT_COPY, [self.a, self.b]
        )

        self.assertEqual(found.pk, self.group.pk)
        found.refresh_from_db()
        self.assertEqual(found.review_status, Duplicate.ReviewStatus.DISMISSED)

    def test_a_new_copy_asks_again(self):
        """The user said these photos are not duplicates, not a later one."""
        self.group.dismiss()
        later = create_test_photo(owner=self.user)

        found = Duplicate.create_or_merge(
            self.user, Duplicate.DuplicateType.EXACT_COPY, [self.a, later]
        )

        found.refresh_from_db()
        self.assertEqual(found.review_status, Duplicate.ReviewStatus.PENDING)
        self.assertEqual(found.photos.count(), 4)
