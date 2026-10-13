"""The manager scopes of every owned model (api/models/scopes.py, issue #2343).

``owned_by`` returns exactly the rows whose owner column (``owner``,
``cluster_owner``, ``started_by`` or ``photo__owner``) is the user, and none
for ``None`` or an anonymous user; ``get_owned`` raises ``DoesNotExist`` for
another user's row; ``owned_or_shared_to`` adds rows shared to the user, once
each, and never public ones.
"""

from django.contrib.auth.models import AnonymousUser
from django.db.models import Count
from django.test import TestCase

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Cluster,
    DeletionLog,
    Duplicate,
    Face,
    LongRunningJob,
    Person,
    Photo,
    PhotoStack,
    Tag,
)
from api.models.scopes import OwnedQuerySet, SharedOwnedQuerySet
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_date,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_cluster,
    create_test_duplicate,
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_tag,
    create_test_user,
)


class OwnedByTest(TestCase):
    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()

    def assertScoped(self, model, alice_row, bob_row):
        self.assertEqual(list(model.objects.owned_by(self.alice)), [alice_row])
        self.assertEqual(list(model.objects.owned_by(self.bob)), [bob_row])
        self.assertEqual(list(model.objects.owned_by(None)), [])
        self.assertEqual(list(model.objects.owned_by(AnonymousUser())), [])
        self.assertEqual(
            model.objects.get_owned(self.alice, pk=alice_row.pk), alice_row
        )
        with self.assertRaises(model.DoesNotExist):
            model.objects.get_owned(self.alice, pk=bob_row.pk)
        with self.assertRaises(model.DoesNotExist):
            model.objects.get_owned(AnonymousUser(), pk=alice_row.pk)

    def test_owner_column(self):
        self.assertScoped(
            Tag,
            create_test_tag(name="a", owner=self.alice),
            create_test_tag(name="b", owner=self.bob),
        )
        self.assertScoped(
            PhotoStack,
            create_test_stack(owner=self.alice),
            create_test_stack(owner=self.bob),
        )
        self.assertScoped(
            Duplicate,
            create_test_duplicate(owner=self.alice),
            create_test_duplicate(owner=self.bob),
        )
        self.assertScoped(
            Cluster,
            create_test_cluster(owner=self.alice),
            create_test_cluster(owner=self.bob),
        )

    def test_cluster_owner_column(self):
        self.assertScoped(
            Person,
            create_test_person(name="A", cluster_owner=self.alice),
            create_test_person(name="B", cluster_owner=self.bob),
        )

    def test_started_by_column(self):
        self.assertScoped(
            LongRunningJob,
            create_test_job(started_by=self.alice),
            create_test_job(started_by=self.bob),
        )

    def test_photo_owner_path(self):
        self.assertScoped(
            Face,
            create_test_face(photo=create_test_photo(owner=self.alice)),
            create_test_face(photo=create_test_photo(owner=self.bob)),
        )

    def test_photo_keeps_its_scopes(self):
        mine = create_test_photo(owner=self.alice, public=False)
        theirs = create_test_photo(owner=self.bob, public=False)
        self.assertScoped(Photo, mine, theirs)
        public = create_test_photo(owner=self.bob, public=True)
        self.assertEqual(set(Photo.objects.visible_to(self.alice)), {mine, public})
        self.assertEqual(list(Photo.objects.visible_to(None)), [public])

    def test_related_managers_have_the_scopes(self):
        photo = create_test_photo(owner=self.alice)
        album = create_test_album_user(owner=self.alice)
        album.photos.add(photo)
        self.assertEqual(list(photo.albumuser_set.owned_by(self.alice)), [album])
        self.assertEqual(list(photo.albumuser_set.owned_by(self.bob)), [])

    def test_every_owned_model_has_the_scope(self):
        expected = {
            Photo: "owner",
            AlbumAuto: "owner",
            AlbumDate: "owner",
            AlbumPlace: "owner",
            AlbumThing: "owner",
            AlbumUser: "owner",
            Cluster: "owner",
            DeletionLog: "owner",
            Duplicate: "owner",
            PhotoStack: "owner",
            Tag: "owner",
            Person: "cluster_owner",
            LongRunningJob: "started_by",
            Face: "photo__owner",
        }
        for model, lookup in expected.items():
            with self.subTest(model=model.__name__):
                queryset = model.objects.all()
                self.assertIsInstance(queryset, OwnedQuerySet)
                self.assertEqual(queryset.owner_lookup, lookup)
                shared = any(f.name == "shared_to" for f in model._meta.get_fields())
                self.assertEqual(isinstance(queryset, SharedOwnedQuerySet), shared)


class OwnedOrSharedToTest(TestCase):
    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.carol = create_test_user()

    def test_owned_and_shared_rows_once_each(self):
        mine = create_test_album_user(owner=self.alice)
        shared = create_test_album_user(owner=self.bob)
        # Shared to two people: the join must not repeat the row.
        shared.shared_to.add(self.alice, self.carol)
        create_test_album_user(owner=self.bob)

        rows = list(AlbumUser.objects.owned_or_shared_to(self.alice).order_by("id"))
        self.assertEqual(rows, [mine, shared])
        self.assertEqual(AlbumUser.objects.owned_or_shared_to(self.alice).count(), 2)
        self.assertEqual(list(AlbumUser.objects.owned_or_shared_to(None)), [])
        self.assertEqual(
            list(AlbumUser.objects.owned_or_shared_to(AnonymousUser())), []
        )

    def test_public_photos_are_not_included(self):
        create_test_photo(owner=self.bob, public=True)
        shared = create_test_photo(owner=self.bob, public=False)
        shared.shared_to.add(self.alice)
        self.assertEqual(list(Photo.objects.owned_or_shared_to(self.alice)), [shared])

    def test_every_shared_album_kind(self):
        for album in (
            create_test_album_auto(owner=self.bob),
            create_test_album_date(owner=self.bob),
            create_test_album_place(owner=self.bob),
            create_test_album_thing(owner=self.bob),
        ):
            model = type(album)
            with self.subTest(model=model.__name__):
                self.assertEqual(list(model.objects.owned_or_shared_to(self.alice)), [])
                album.shared_to.add(self.alice)
                self.assertEqual(
                    list(model.objects.owned_or_shared_to(self.alice)), [album]
                )


class SharedWithTest(TestCase):
    def test_only_rows_someone_else_shared_to_the_user(self):
        alice = create_test_user()
        bob = create_test_user()
        carol = create_test_user()
        mine = create_test_album_user(owner=alice)
        # Shared to herself: still hers, not something she can leave.
        mine.shared_to.add(alice)
        shared = create_test_album_user(owner=bob)
        shared.shared_to.add(alice, carol)
        create_test_album_user(owner=bob).shared_to.add(carol)

        self.assertEqual(list(AlbumUser.objects.shared_with(alice)), [shared])
        self.assertEqual(list(AlbumUser.objects.shared_with(None)), [])
        self.assertEqual(list(AlbumUser.objects.shared_with(AnonymousUser())), [])


class OwnerQTest(TestCase):
    def test_owner_q_through_a_relation_stays_on_the_joined_row(self):
        alice = create_test_user()
        bob = create_test_user()
        person = create_test_person(name="P", cluster_owner=alice)
        create_test_face(photo=create_test_photo(owner=alice), person=person)
        create_test_face(photo=create_test_photo(owner=bob), person=person)
        create_test_face(photo=create_test_photo(owner=bob), person=person)

        counted = Person.objects.annotate(
            mine=Count("faces", filter=Face.objects.owner_q(alice, through="faces__"))
        ).get(pk=person.pk)
        self.assertEqual(counted.mine, 1)
        self.assertEqual(
            Face.objects.owner_q(alice, through="faces__").children,
            [("faces__photo__owner", alice)],
        )
