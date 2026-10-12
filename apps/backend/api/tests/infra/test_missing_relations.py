"""A list serializer handed a row without its relations fails instead of querying (#2331).

The per-row fallbacks (``stack.photos.count()``, ``obj.files.filter(...)``,
``obj.photos.first()``, ``obj.photos.count()`` and the user counts) hid a
forgotten prefetch behind one query per row. Each serializer method now reads
what its ``with_*_relations()`` function loads and raises
``MissingRelationsError`` without touching the database when it is missing.
"""

from collections.abc import Callable

from django.test import TestCase

from api.models import AlbumAuto, AlbumUser, File, Photo, User
from api.models.photo_stack import PhotoStack
from api.serializers.album_auto import AlbumAutoListSerializer
from api.serializers.album_user import (
    AlbumUserListSerializer,
    with_album_user_list_relations,
)
from api.serializers.fields import MissingRelationsError
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.serializers.user import (
    ManageUserSerializer,
    PublicUserSerializer,
    UserSerializer,
    with_user_relations,
)
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_user,
    create_test_file,
    create_test_photo,
    create_test_stack,
    create_test_user,
)


class MissingRelationsTest(TestCase):
    def setUp(self):
        self.user = create_test_user(public_sharing=True)
        self.photo = create_test_photo(owner=self.user, public=True)
        stack = create_test_stack(
            owner=self.user, stack_type=PhotoStack.StackType.MANUAL
        )
        stack.photos.add(self.photo)
        self.photo.files.add(create_test_file(None, self.user, file_type=File.RAW_FILE))
        self.album = create_test_album_user(owner=self.user)
        self.album.photos.add(self.photo)
        self.event = create_test_album_auto(owner=self.user)
        self.event.photos.add(self.photo)

    def _assert_fails_without_a_query(self, method: Callable[[], object]) -> None:
        with (
            self.assertNumQueries(0),
            self.assertRaises(MissingRelationsError),
        ):
            method()

    def test_photo_tile(self):
        plain = Photo.objects.get(pk=self.photo.pk)
        serializer = PhotoSummarySerializer()
        self._assert_fails_without_a_query(lambda: serializer.get_stacks(plain))
        self._assert_fails_without_a_query(
            lambda: serializer.get_has_raw_variant(plain)
        )
        # Prefetched, but without the stack size the tile shows.
        unsized = Photo.objects.prefetch_related("stacks").get(pk=self.photo.pk)
        self._assert_fails_without_a_query(lambda: serializer.get_stacks(unsized))

        loaded = with_photo_summary_relations(
            Photo.objects.filter(pk=self.photo.pk)
        ).get()
        with self.assertNumQueries(0):
            self.assertEqual(serializer.get_stacks(loaded)[0]["photo_count"], 1)
            self.assertIs(serializer.get_has_raw_variant(loaded), True)

    def test_album_card(self):
        plain = AlbumUser.objects.get(pk=self.album.pk)
        serializer = AlbumUserListSerializer()
        self._assert_fails_without_a_query(lambda: serializer.get_photo_count(plain))
        self._assert_fails_without_a_query(lambda: serializer.get_cover_photo(plain))

        loaded = with_album_user_list_relations(
            AlbumUser.objects.filter(pk=self.album.pk)
        ).get()
        with self.assertNumQueries(0):
            self.assertEqual(serializer.get_photo_count(loaded), 1)
            self.assertEqual(
                serializer.get_cover_photo(loaded)["image_hash"],
                self.photo.image_hash,
            )

    def test_event_card(self):
        plain = AlbumAuto.objects.get(pk=self.event.pk)
        serializer = AlbumAutoListSerializer()
        self._assert_fails_without_a_query(lambda: serializer.get_photo_count(plain))
        self._assert_fails_without_a_query(lambda: serializer.get_photos(plain))

    def test_user_serializers(self):
        plain = User.objects.get(pk=self.user.pk)
        for serializer_class in (UserSerializer, PublicUserSerializer):
            serializer = serializer_class()
            with self.subTest(serializer_class.__name__):
                self._assert_fails_without_a_query(
                    lambda: serializer.get_public_photo_count(plain)
                )
                self._assert_fails_without_a_query(
                    lambda: serializer.get_public_photo_samples(plain)
                )
        for serializer_class in (UserSerializer, ManageUserSerializer):
            serializer = serializer_class()
            with self.subTest(serializer_class.__name__):
                self._assert_fails_without_a_query(
                    lambda: serializer.get_photo_count(plain)
                )

        loaded = with_user_relations(User.objects.filter(pk=self.user.pk)).get()
        serializer = UserSerializer()
        with self.assertNumQueries(0):
            self.assertEqual(serializer.get_photo_count(loaded), 1)
            self.assertEqual(serializer.get_public_photo_count(loaded), 1)
            self.assertEqual(
                [p["image_hash"] for p in serializer.get_public_photo_samples(loaded)],
                [self.photo.image_hash],
            )
