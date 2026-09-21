"""Repro for issue #897 -- "Timeout when tagging large amount of faces".

https://github.com/LibrePhotos/librephotos/issues/897

Tagging a multi-selection of faces goes through ``POST /api/labelfaces``
(``api.views.faces.SetFacePersonLabel``), which does::

    faces = Face.objects.in_bulk(data["face_ids"])
    for face in faces.values():
        if face.photo.owner == request.user:
            face.person = person
            ...
            face.save()
    ...
    search_instance, created = PhotoSearch.objects.get_or_create(photo=face.photo)
    search_instance.recreate_search_captions()

``in_bulk()`` returns bare ``Face`` rows with no related objects selected, so
each loop iteration fires an extra ``SELECT`` for ``face.photo`` and another
for ``face.photo.owner`` *before* the row is written -- three queries per face
instead of one.  That is the request cost that blows past the reverse-proxy
timeout once a user selects a few thousand inferred faces, which is the symptom
in the issue ("the operation times out and the faces end up not being tagged
(sometimes a part of them succeed)").

The second test covers the other half of the symptom: because the
``PhotoSearch`` refresh sits *outside* the loop it runs against the dangling
``face`` loop variable, so only the last photo of the batch gets its search
captions rebuilt and the freshly tagged person is not findable on any of the
others.
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.models import Face
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_face, create_test_photo, create_test_user

LABEL_FACES_URL = "/api/labelfaces"


class TagManyFacesTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _create_faces(self, count):
        """One face per photo, which is what the inference view hands over."""
        photos = [create_test_photo(owner=self.user) for _ in range(count)]
        return photos, [create_test_face(photo=photo) for photo in photos]

    def _label(self, faces, person_name):
        return self.client.post(
            LABEL_FACES_URL,
            {"person_name": person_name, "face_ids": [face.id for face in faces]},
            format="json",
        )

    def test_labelling_faces_costs_at_most_one_query_per_face(self):
        """The per-face marginal query cost must not exceed the single write.

        Measured against two batch sizes so the fixed overhead of the endpoint
        (person lookup, face-count recalculation, cover photo, ...) cancels out
        and only the part that scales with the batch size is asserted on.
        """
        small_count, large_count = 4, 20

        _, small_batch = self._create_faces(small_count)
        with CaptureQueriesContext(connection) as small_ctx:
            small_response = self._label(small_batch, "Alice")
        self.assertEqual(small_response.status_code, 200)

        _, large_batch = self._create_faces(large_count)
        with CaptureQueriesContext(connection) as large_ctx:
            large_response = self._label(large_batch, "Bob")
        self.assertEqual(large_response.status_code, 200)

        extra_faces = large_count - small_count
        extra_queries = len(large_ctx.captured_queries) - len(
            small_ctx.captured_queries
        )

        self.assertLessEqual(
            extra_queries,
            extra_faces,
            "labelling {} extra faces cost {} extra queries ({:.1f} per face); "
            "a face only needs its own UPDATE, the photo/owner rows should come "
            "from a single select_related/bulk read".format(
                extra_faces, extra_queries, extra_queries / extra_faces
            ),
        )

    def test_every_tagged_photo_gets_its_search_captions_refreshed(self):
        """All photos in the batch must become searchable by the new name."""
        photos, faces = self._create_faces(3)

        response = self._label(faces, "Carol")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            Face.objects.filter(person__name="Carol").count(),
            3,
            "all faces of the batch should be tagged",
        )

        missing = []
        for photo in photos:
            search = PhotoSearch.objects.filter(photo=photo).first()
            if search is None or "Carol" not in (search.search_captions or ""):
                missing.append(photo.image_hash)

        self.assertEqual(
            missing,
            [],
            "search captions were not rebuilt for {} of 3 tagged photos".format(
                len(missing)
            ),
        )
