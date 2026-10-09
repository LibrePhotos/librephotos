"""Issue #2151 - one faceless person emptied the whole People section.

The frontend parses ``/api/persons/`` with a strict schema in which ``video``
is an optional boolean, and a row that does not match fails the parse for the
entire list. ``PersonSerializer.get_video`` returned the *string* ``"False"``
for a person that has neither a cover photo nor a face on the requester's
photos, so a single such person made the People section render nothing.

Those persons are easy to end up with: a named XMP face region (digiKam,
Lightroom, ...) creates its ``KIND_USER`` person before the face crop is saved,
so a region that cannot be cropped leaves the person behind with no faces.
"""

from unittest.mock import patch

import PIL
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Person
from api.photo_faces import extract_faces
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class FacelessPersonInPeopleListTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.photo = create_test_photo(owner=self.user, video=False)
        self.person_with_face = create_test_person(
            name="Has a face", cluster_owner=self.user, face_count=1
        )
        create_test_face(photo=self.photo, person=self.person_with_face)

    def _rows(self):
        response = self.client.get("/api/persons/?page_size=1000")
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def _assert_rows_match_frontend_schema(self, rows):
        # useFetchPeopleAlbumsQuery: video: z.boolean().optional()
        for row in rows:
            self.assertIsInstance(row["video"], bool, row)
            self.assertIsInstance(row["face_url"], str, row)
            self.assertIsInstance(row["face_photo_url"], str, row)

    def test_person_without_faces_or_cover_reports_video_as_a_boolean(self):
        orphan = create_test_person(name="No faces", cluster_owner=self.user)

        rows = self._rows()

        self.assertEqual(
            {row["id"] for row in rows},
            {
                self.person_with_face.id,
                orphan.id,
            },
        )
        self._assert_rows_match_frontend_schema(rows)
        orphan_row = next(row for row in rows if row["id"] == orphan.id)
        self.assertIs(orphan_row["video"], False)
        self.assertEqual(orphan_row["face_url"], "")
        self.assertEqual(orphan_row["face_photo_url"], "")

    def test_unannotated_serializer_also_reports_a_boolean(self):
        from api.serializers.person import PersonSerializer

        orphan = create_test_person(name="No faces", cluster_owner=self.user)

        self.assertIs(PersonSerializer(orphan).data["video"], False)

    def test_cover_and_first_face_paths_still_report_the_photo_flag(self):
        video_photo = create_test_photo(owner=self.user, video=True)
        video_person = create_test_person(name="In a video", cluster_owner=self.user)
        create_test_face(photo=video_photo, person=video_person)
        covered = create_test_person(
            name="Covered", cluster_owner=self.user, cover_photo=video_photo
        )

        rows = {row["id"]: row for row in self._rows()}

        self._assert_rows_match_frontend_schema(rows.values())
        self.assertIs(rows[video_person.id]["video"], True)
        self.assertIs(rows[covered.id]["video"], True)
        self.assertIs(rows[self.person_with_face.id]["video"], False)

    @patch(
        "api.photo_faces.PIL.Image.open",
        return_value=PIL.Image.new("RGB", (200, 200)),
    )
    @patch("api.photo_faces.face_extractor")
    def test_an_uncroppable_named_xmp_region_does_not_empty_the_list(
        self, extractor, _open
    ):
        # A zero-height region: the crop is empty and Pillow refuses to save
        # it ("cannot write empty image"), after the person was created.
        extractor.extract.return_value = [(50, 80, 50, 20, "digiKam Person")]
        scan_photo = create_test_photo(owner=self.user)

        with self.assertRaises(ValueError):
            extract_faces(scan_photo)

        orphan = Person.objects.get(name="digiKam Person", cluster_owner=self.user)
        self.assertFalse(orphan.faces.exists())
        self.assertIsNone(orphan.cover_photo)

        rows = self._rows()

        self.assertIn(orphan.id, {row["id"] for row in rows})
        self._assert_rows_match_frontend_schema(rows)
