"""The face list views stay readable for the OpenAPI schema generator.

drf-spectacular calls ``get_queryset`` with an anonymous mock request to learn
the view's model. ``FaceIncompleteListViewSet`` resolves the user through
``request_user``, which raises NotAuthenticated, and ``FaceListView`` filters
on ``photo__owner=AnonymousUser``, which raises TypeError, so the generator
logged "Failed to obtain model". They answer it with an empty queryset instead.
"""

from unittest import mock

from django.test import TestCase
from drf_spectacular.drainage import GENERATOR_STATS
from drf_spectacular.generators import SchemaGenerator
from rest_framework import routers

from api.models import Face, Person
from api.views import faces


class FaceListSchemaGenerationTest(TestCase):
    def _schema_warnings(self) -> list[str]:
        router = routers.SimpleRouter()
        router.register(
            r"api/faces/incomplete",
            faces.FaceIncompleteListViewSet,
            basename="incomplete_faces",
        )
        router.register(r"api/faces", faces.FaceListView, basename="faces")
        messages: list[str] = []
        with mock.patch.object(
            GENERATOR_STATS,
            "emit",
            side_effect=lambda msg, severity: messages.append(msg),
        ):
            schema = SchemaGenerator(patterns=router.urls).get_schema(
                request=None, public=True
            )
        self.assertIn("/api/faces/", schema["paths"])
        self.assertIn("/api/faces/incomplete/", schema["paths"])
        return messages

    def test_no_queryset_warnings_for_face_views(self) -> None:
        warnings = [msg for msg in self._schema_warnings() if "obtain model" in msg]
        self.assertEqual(warnings, [])

    def test_fake_view_gets_an_empty_queryset(self) -> None:
        for view_class, model in (
            (faces.FaceIncompleteListViewSet, Person),
            (faces.FaceListView, Face),
        ):
            with self.subTest(view=view_class.__name__):
                view = view_class()
                view.swagger_fake_view = True
                queryset = view.get_queryset()
                self.assertIs(queryset.model, model)
                self.assertFalse(queryset.exists())
