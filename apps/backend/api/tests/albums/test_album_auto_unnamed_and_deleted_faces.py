"""Auto ("event") albums read every face on their photos.

Both places that do so assumed each face has a person and is still live:

* ``AlbumAuto._generate_title`` dereferenced ``face.person.name`` directly. One
  unnamed face on one photo raised ``AttributeError``, and because the whole
  title generation is wrapped in ``except Exception``, the album silently fell
  back to "Album from <date>" - losing the weekday, time of day, people and
  place it had already worked out.
* ``AlbumAutoSerializer.get_people`` listed people from soft-deleted faces.

Unnamed faces are the normal case, not an edge case: a library gets one person
row per *labelled* face, and everything the algorithms have not matched yet has
``person = None``.
"""

from datetime import datetime

import pytz
from django.test import TestCase

from api.models import AlbumAuto
from api.serializers.album_auto import AlbumAutoSerializer
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def utc(*args):
    return datetime(*args).replace(tzinfo=pytz.utc)


class AlbumAutoTitleWithUnnamedFacesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.timestamp = utc(2022, 1, 2, 15, 0)
        self.album = AlbumAuto.objects.create(
            timestamp=self.timestamp, created_on=self.timestamp, owner=self.user
        )
        self.photo = create_test_photo(owner=self.user, exif_timestamp=self.timestamp)
        self.album.photos.add(self.photo)

    def test_an_unnamed_face_does_not_cost_the_album_its_title(self):
        create_test_face(photo=self.photo, person=create_test_person(name="Alice"))
        create_test_face(photo=self.photo, person=None)

        self.album._generate_title()

        self.assertIn("Alice", self.album.title)
        self.assertNotIn("Album from", self.album.title)

    def test_only_unnamed_faces_still_yields_the_normal_title(self):
        create_test_face(photo=self.photo, person=None)

        self.album._generate_title()

        self.assertEqual(self.album.title, "Sunday Afternoon")

    def test_a_deleted_face_is_not_counted_towards_the_title(self):
        create_test_face(photo=self.photo, person=create_test_person(name="Alice"))
        create_test_face(
            photo=self.photo, person=create_test_person(name="Ghost"), deleted=True
        )

        self.album._generate_title()

        self.assertIn("Alice", self.album.title)
        self.assertNotIn("Ghost", self.album.title)


class AlbumAutoPeopleListTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        timestamp = utc(2022, 1, 2, 15, 0)
        self.album = AlbumAuto.objects.create(
            timestamp=timestamp, created_on=timestamp, owner=self.user
        )
        self.photo = create_test_photo(owner=self.user, exif_timestamp=timestamp)
        self.album.photos.add(self.photo)

    def _people(self):
        return AlbumAutoSerializer(self.album).data["people"]

    def test_deleted_faces_are_not_listed(self):
        create_test_face(
            photo=self.photo, person=create_test_person(name="Ghost"), deleted=True
        )

        self.assertEqual(self._people(), [])

    def test_live_faces_are_still_listed_beside_a_deleted_one(self):
        create_test_face(
            photo=self.photo, person=create_test_person(name="Ghost"), deleted=True
        )
        create_test_face(photo=self.photo, person=create_test_person(name="Alice"))

        self.assertEqual([p["name"] for p in self._people()], ["Alice"])
