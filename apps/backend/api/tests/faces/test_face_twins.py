"""Labelling a face labels its twins in a burst, bracket or duplicate group (#2754).

A twin is the same face in another frame: an unlabelled face of another
photo of the same burst or bracket stack or duplicate group, at nearly the
same place, with a near-identical encoding.
"""

from typing import Any

import numpy as np
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.twins import twin_faces
from api.models import Face, Person, Photo, PhotoStack
from api.models.duplicate import Duplicate
from api.models.user import User
from api.tests.utils import (
    create_test_duplicate,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_user,
)

# A face box in big-thumbnail pixels: (top, right, bottom, left).
ANNA_BOX = (100, 300, 300, 100)
BEN_BOX = (100, 900, 300, 700)


def encoding(seed: int, noise: float = 0.0, noise_seed: int = 0) -> str:
    """A person's encoding (``seed``), or a frame of it moved by ``noise``."""
    base = np.random.RandomState(seed).randn(512)
    base /= np.linalg.norm(base)
    jitter = np.random.RandomState(1000 + noise_seed).randn(512)
    jitter *= noise / np.linalg.norm(jitter)
    return (base + jitter).astype(np.float64).tobytes().hex()


def face_at(
    photo: Photo,
    box: tuple[int, int, int, int],
    person_seed: int,
    frame: int = 0,
    **kwargs: Any,
) -> Face:
    top, right, bottom, left = box
    return create_test_face(
        photo=photo,
        location_top=top,
        location_right=right,
        location_bottom=bottom,
        location_left=left,
        encoding=encoding(person_seed, noise=0.15 if frame else 0.0, noise_seed=frame),
        cluster_person=None,
        classification_person=None,
        **kwargs,
    )


def nudged(box: tuple[int, int, int, int], by: int) -> tuple[int, int, int, int]:
    top, right, bottom, left = box
    return (top + by, right + by, bottom + by, left + by)


class TwinFacesTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photos = [create_test_photo(owner=self.user) for _ in range(5)]
        self.burst = create_test_stack(
            self.user, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        self.burst.photos.add(*self.photos)
        self.anna_faces = [
            face_at(photo, nudged(ANNA_BOX, 4 * frame), 1, frame)
            for frame, photo in enumerate(self.photos)
        ]
        self.ben_faces = [
            face_at(photo, BEN_BOX, 2, frame) for frame, photo in enumerate(self.photos)
        ]

    def twins_of(self, face: Face, person: Person | None = None) -> list[Face]:
        return twin_faces(self.user, [face], person)

    def test_a_burst_gives_the_same_face_in_every_other_frame(self) -> None:
        twins = self.twins_of(self.anna_faces[0])

        self.assertEqual(
            [face.pk for face in self.anna_faces[1:]], [f.pk for f in twins]
        )

    def test_an_exposure_bracket_counts_like_a_burst(self) -> None:
        self.burst.stack_type = PhotoStack.StackType.EXPOSURE_BRACKET
        self.burst.save()

        self.assertEqual(4, len(self.twins_of(self.anna_faces[0])))

    def test_a_manual_stack_gives_no_twins(self) -> None:
        self.burst.stack_type = PhotoStack.StackType.MANUAL
        self.burst.save()

        self.assertEqual([], self.twins_of(self.anna_faces[0]))

    def test_a_photo_in_no_group_gives_no_twins(self) -> None:
        alone = create_test_photo(owner=self.user)
        face = face_at(alone, ANNA_BOX, 1)

        self.assertEqual([], self.twins_of(face))

    def test_a_duplicate_group_gives_twins(self) -> None:
        original, copy = (create_test_photo(owner=self.user) for _ in range(2))
        create_test_duplicate(self.user).photos.add(original, copy)
        face = face_at(original, ANNA_BOX, 1)
        twin = face_at(copy, ANNA_BOX, 1, frame=1)

        self.assertEqual([twin], self.twins_of(face))

    def test_a_dismissed_duplicate_group_gives_no_twins(self) -> None:
        original, copy = (create_test_photo(owner=self.user) for _ in range(2))
        create_test_duplicate(
            self.user, review_status=Duplicate.ReviewStatus.DISMISSED
        ).photos.add(original, copy)
        face = face_at(original, ANNA_BOX, 1)
        face_at(copy, ANNA_BOX, 1, frame=1)

        self.assertEqual([], self.twins_of(face))

    def test_a_face_elsewhere_in_the_frame_is_no_twin(self) -> None:
        moved = face_at(create_test_photo(owner=self.user), BEN_BOX, 1, frame=1)
        self.burst.photos.add(moved.photo)

        self.assertNotIn(moved, self.twins_of(self.anna_faces[0]))

    def test_another_person_at_the_same_place_is_no_twin(self) -> None:
        photo = create_test_photo(owner=self.user)
        self.burst.photos.add(photo)
        stranger = face_at(photo, ANNA_BOX, 3)

        self.assertNotIn(stranger, self.twins_of(self.anna_faces[0]))

    def test_labelled_deleted_and_unencoded_faces_are_no_twins(self) -> None:
        anna = create_test_person(name="Anna", cluster_owner=self.user)
        Face.objects.filter(pk=self.anna_faces[1].pk).update(person=anna)
        Face.objects.filter(pk=self.anna_faces[2].pk).update(deleted=True)
        Face.objects.filter(pk=self.anna_faces[3].pk).update(encoding="")

        twins = self.twins_of(self.anna_faces[0])

        self.assertEqual([self.anna_faces[4].pk], [face.pk for face in twins])

    def test_a_face_rejected_for_the_person_is_no_twin(self) -> None:
        anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.anna_faces[1].rejected_persons.add(anna)

        twins = self.twins_of(self.anna_faces[0], anna)

        self.assertNotIn(self.anna_faces[1].pk, [face.pk for face in twins])
        self.assertEqual(3, len(twins))

    def test_a_trashed_frame_gives_no_twin(self) -> None:
        Photo.objects.filter(pk=self.photos[1].pk).update(in_trashcan=True)

        twins = self.twins_of(self.anna_faces[0])

        self.assertNotIn(self.anna_faces[1].pk, [face.pk for face in twins])

    def test_each_frame_gives_its_closest_face_only(self) -> None:
        # A second, farther match on frame 1, overlapping the first.
        farther = face_at(self.photos[1], nudged(ANNA_BOX, 20), 1, frame=7)
        Face.objects.filter(pk=farther.pk).update(
            encoding=encoding(1, noise=0.4, noise_seed=7)
        )

        twins = self.twins_of(self.anna_faces[0])

        self.assertIn(self.anna_faces[1], twins)
        self.assertNotIn(farther, twins)

    def test_a_face_twin_of_two_labelled_faces_is_returned_once(self) -> None:
        twins = twin_faces(self.user, self.anna_faces[:2], None)

        self.assertEqual(
            [face.pk for face in self.anna_faces[2:]], [f.pk for f in twins]
        )

    def test_boxes_are_compared_at_their_thumbnail_size(self) -> None:
        # A small copy has a smaller big thumbnail, and smaller boxes.
        original = create_test_photo(owner=self.user)
        small_copy = create_test_photo(
            owner=self.user, width=600, height=settings.BIG_THUMBNAIL_HEIGHT // 2
        )
        create_test_duplicate(self.user).photos.add(original, small_copy)
        face = face_at(original, ANNA_BOX, 1)
        twin = face_at(small_copy, tuple(side // 2 for side in ANNA_BOX), 1, frame=1)

        self.assertEqual([twin], self.twins_of(face))

    def test_another_users_face_is_never_a_twin(self) -> None:
        other: User = create_test_user()
        foreign_photo = create_test_photo(owner=other)
        self.burst.photos.add(foreign_photo)
        foreign = face_at(foreign_photo, ANNA_BOX, 1, frame=1)

        self.assertNotIn(foreign, self.twins_of(self.anna_faces[0]))

    def test_another_users_burst_gives_no_twins(self) -> None:
        other: User = create_test_user()
        their_burst = create_test_stack(
            other, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        photo, frame = (create_test_photo(owner=self.user) for _ in range(2))
        their_burst.photos.add(photo, frame)
        face = face_at(photo, ANNA_BOX, 1)
        face_at(frame, ANNA_BOX, 1, frame=1)

        self.assertEqual([], self.twins_of(face))


class LabelTwinsApiTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        photos = [create_test_photo(owner=self.user) for _ in range(5)]
        burst = create_test_stack(
            self.user, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        burst.photos.add(*photos)
        self.anna_faces = [
            face_at(photo, ANNA_BOX, 1, frame) for frame, photo in enumerate(photos)
        ]
        self.ben_faces = [
            face_at(photo, BEN_BOX, 2, frame) for frame, photo in enumerate(photos)
        ]

    def label(self, face: Face, name: str) -> dict[str, Any]:
        response = self.client.post(
            "/api/labelfaces",
            {"face_ids": [face.pk], "person_name": name},
            format="json",
        )
        self.assertEqual(200, response.status_code, response.content)
        body: dict[str, Any] = response.json()
        return body

    def people_of(self, faces: list[Face]) -> list[int | None]:
        return [Face.objects.get(pk=face.pk).person_id for face in faces]

    def test_labelling_one_frame_labels_the_face_in_every_frame(self) -> None:
        body = self.label(self.anna_faces[0], "Anna")

        anna = Person.objects.get(name="Anna")
        self.assertEqual([anna.pk] * 5, self.people_of(self.anna_faces))
        self.assertEqual([None] * 5, self.people_of(self.ben_faces))
        self.assertEqual(
            sorted(face.pk for face in self.anna_faces[1:]), sorted(body["twin_ids"])
        )
        self.assertEqual(5, len(body["results"]))
        self.assertEqual(5, len(body["previous"]))

    def test_undo_gives_every_frame_back(self) -> None:
        body = self.label(self.anna_faces[0], "Anna")

        response = self.client.post(
            "/api/restore-face-labels/", {"faces": body["previous"]}, format="json"
        )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual([None] * 5, self.people_of(self.anna_faces))

    def test_not_this_person_leaves_the_twins_alone(self) -> None:
        anna = create_test_person(name="Anna", cluster_owner=self.user)
        Face.objects.filter(pk__in=[face.pk for face in self.anna_faces]).update(
            cluster_person=anna
        )

        body = self.label(self.anna_faces[0], Person.UNKNOWN_PERSON_NAME)

        self.assertEqual([], body["twin_ids"])
        self.assertEqual(1, len(body["results"]))
        twins = Face.objects.filter(pk__in=[face.pk for face in self.anna_faces[1:]])
        self.assertEqual({anna.pk}, set(twins.values_list("cluster_person", flat=True)))
