"""Characterization tests for api/serializers/photos.py (CRAP unit 26).

Pins the CURRENT behavior of ``PublicPhotoDetailSerializer.get_people``.

These are behavior snapshots taken before refactoring - they encode what the
code does today, including the quirks noted in the docstrings below.

No ML models, network or exiftool binaries are involved: the serializer method
only touches the ``Photo.faces`` relation and the ``sharing_settings`` context.
"""

from django.test import TestCase

from api.serializers.photos import PublicPhotoDetailSerializer
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _people(photo, sharing_settings=None, include_key=True):
    """Call get_people through a serializer built the way the view builds it."""
    context = {}
    if include_key:
        context["sharing_settings"] = sharing_settings
    serializer = PublicPhotoDetailSerializer(photo, context=context)
    return serializer.get_people(photo)


class GetPeopleSharingGateTestCase(TestCase):
    """The ``share_faces`` gate in ``get_people``."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.person = create_test_person(name="Alice")
        create_test_face(photo=self.photo, person=self.person)

    def test_share_faces_false_returns_empty_list(self):
        self.assertEqual(_people(self.photo, {"share_faces": False}), [])

    def test_share_faces_missing_key_returns_empty_list(self):
        self.assertEqual(_people(self.photo, {"share_location": True}), [])

    def test_empty_sharing_settings_returns_empty_list(self):
        self.assertEqual(_people(self.photo, {}), [])

    def test_missing_sharing_settings_context_key_returns_empty_list(self):
        # _get_sharing_settings() falls back to {} when the key is absent.
        self.assertEqual(_people(self.photo, include_key=False), [])

    def test_sharing_settings_none_raises_attribute_error(self):
        # QUIRK: an explicit ``None`` in the context is NOT defended against -
        # ``self.context.get("sharing_settings", {})`` returns None and .get()
        # blows up. Pinned as current behavior, not as desired behavior.
        with self.assertRaises(AttributeError):
            _people(self.photo, None)

    def test_share_faces_true_returns_the_face(self):
        result = _people(self.photo, {"share_faces": True})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Alice")

    def test_truthy_non_boolean_share_faces_enables_sharing(self):
        self.assertEqual(len(_people(self.photo, {"share_faces": "yes"})), 1)


class GetPeopleNameResolutionTestCase(TestCase):
    """Name/URL/id resolution once sharing is enabled."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.settings_on = {"share_faces": True}

    def test_named_person_wins_over_cluster_person(self):
        person = create_test_person(name="Alice")
        cluster_person = create_test_person(name="Cluster 1")
        create_test_face(photo=self.photo, person=person, cluster_person=cluster_person)

        result = _people(self.photo, self.settings_on)

        self.assertEqual([p["name"] for p in result], ["Alice"])

    def test_cluster_person_used_when_person_is_null(self):
        cluster_person = create_test_person(name="Cluster 7")
        create_test_face(photo=self.photo, person=None, cluster_person=cluster_person)

        result = _people(self.photo, self.settings_on)

        self.assertEqual([p["name"] for p in result], ["Cluster 7"])

    def test_face_without_person_or_cluster_person_is_filtered_out(self):
        create_test_face(photo=self.photo, person=None, cluster_person=None)

        self.assertEqual(_people(self.photo, self.settings_on), [])

    def test_unknown_fallback_is_dead_code(self):
        """BUG/DEAD CODE: the ``"Unknown"`` literal can never be produced.

        The comprehension filters on ``if f.person or f.cluster_person``, so
        the inner ``else "Unknown"`` branch is unreachable. A refactor may drop
        it, but must keep filtering faces that have neither person.
        """
        create_test_face(photo=self.photo, person=None, cluster_person=None)
        create_test_face(
            photo=self.photo, person=create_test_person(name="Bob"), cluster_person=None
        )

        names = [p["name"] for p in _people(self.photo, self.settings_on)]

        self.assertEqual(names, ["Bob"])
        self.assertNotIn("Unknown", names)

    def test_face_url_and_face_id_are_exposed(self):
        person = create_test_person(name="Alice")
        face = create_test_face(photo=self.photo, person=person, image="faces/a.jpg")

        entry = _people(self.photo, self.settings_on)[0]

        self.assertEqual(entry["face_id"], face.id)
        self.assertTrue(entry["face_url"].endswith("faces/a.jpg"))
        self.assertEqual(set(entry.keys()), {"name", "face_url", "face_id"})

    def test_face_without_image_has_null_face_url(self):
        person = create_test_person(name="Alice")
        create_test_face(photo=self.photo, person=person, image=None)

        entry = _people(self.photo, self.settings_on)[0]

        self.assertIsNone(entry["face_url"])

    def test_deleted_faces_are_still_returned(self):
        """QUIRK: ``obj.faces.all()`` is unfiltered - soft-deleted faces leak."""
        person = create_test_person(name="Ghost")
        create_test_face(photo=self.photo, person=person, deleted=True)

        self.assertEqual(
            [p["name"] for p in _people(self.photo, self.settings_on)], ["Ghost"]
        )

    def test_photo_without_faces_returns_empty_list(self):
        self.assertEqual(_people(self.photo, self.settings_on), [])

    def test_multiple_faces_all_returned(self):
        for name in ("A", "B", "C"):
            create_test_face(photo=self.photo, person=create_test_person(name=name))

        result = _people(self.photo, self.settings_on)

        self.assertEqual(len(result), 3)
        self.assertEqual({p["name"] for p in result}, {"A", "B", "C"})

    def test_faces_of_other_photos_are_not_included(self):
        other = create_test_photo(owner=self.user)
        create_test_face(photo=other, person=create_test_person(name="Elsewhere"))
        create_test_face(photo=self.photo, person=create_test_person(name="Here"))

        self.assertEqual(
            [p["name"] for p in _people(self.photo, self.settings_on)], ["Here"]
        )


class GetPeopleThroughSerializerDataTestCase(TestCase):
    """``people`` as rendered through the full serializer output."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        create_test_face(
            photo=self.photo, person=create_test_person(name="Alice"), image="f/a.jpg"
        )

    def test_people_present_in_serializer_data_when_shared(self):
        data = PublicPhotoDetailSerializer(
            self.photo, context={"sharing_settings": {"share_faces": True}}
        ).data

        self.assertEqual([p["name"] for p in data["people"]], ["Alice"])

    def test_people_empty_in_serializer_data_when_not_shared(self):
        data = PublicPhotoDetailSerializer(
            self.photo, context={"sharing_settings": {"share_faces": False}}
        ).data

        self.assertEqual(data["people"], [])
