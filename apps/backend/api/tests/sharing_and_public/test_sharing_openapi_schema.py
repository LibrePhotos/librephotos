"""The sharing list views stay readable for the OpenAPI schema generator.

drf-spectacular calls ``get_queryset`` with an anonymous mock request to learn
the view's model. ``request_user`` raises NotAuthenticated for that request, so
these views answer the generator with an empty queryset instead.
"""

from unittest import mock

from django.test import TestCase
from drf_spectacular.drainage import GENERATOR_STATS
from drf_spectacular.generators import SchemaGenerator
from rest_framework import routers

from api.views import sharing


class SharingSchemaGenerationTest(TestCase):
    def _schema_warnings(self) -> list[str]:
        router = routers.SimpleRouter()
        router.register(
            r"api/albums/user/shared/tome",
            sharing.SharedToMeAlbumUserListViewSet,
            basename="album_user_shared_to_me",
        )
        router.register(
            r"api/albums/user/shared/fromme",
            sharing.SharedFromMeAlbumUserListViewSet,
            basename="album_user_shared_from_me",
        )
        router.register(
            r"api/photos/shared/tome",
            sharing.SharedToMePhotoSuperSimpleListViewSet,
            basename="photo_shared_to_me",
        )
        messages: list[str] = []
        with mock.patch.object(
            GENERATOR_STATS,
            "emit",
            side_effect=lambda msg, severity: messages.append(msg),
        ):
            schema = SchemaGenerator(patterns=router.urls).get_schema(
                request=None, public=True
            )
        self.assertIn("/api/photos/shared/tome/", schema["paths"])
        return messages

    def test_no_queryset_warnings_for_sharing_views(self) -> None:
        warnings = [msg for msg in self._schema_warnings() if "obtain model" in msg]
        self.assertEqual(warnings, [])

    def test_fake_view_gets_an_empty_queryset(self) -> None:
        for view_class in (
            sharing.SharedToMeAlbumUserListViewSet,
            sharing.SharedFromMeAlbumUserListViewSet,
            sharing.SharedToMePhotoSuperSimpleListViewSet,
        ):
            view = view_class()
            view.swagger_fake_view = True
            view.request = mock.Mock(user=mock.Mock(spec=[]))
            with self.subTest(view=view_class.__name__):
                self.assertFalse(view.get_queryset().exists())
