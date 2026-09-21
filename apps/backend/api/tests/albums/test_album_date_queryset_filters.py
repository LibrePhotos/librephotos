"""Characterization tests for ``AlbumDateViewSet.get_queryset`` (CRAP unit 32).

These tests pin the *current* behaviour of the album-date detail queryset
builder before it is refactored. ``get_queryset`` is unusual: it does not
return a queryset at all, but the tuple ``(album_date, page, total_count)``
where ``page`` is a ``django.core.paginator.Page``.

The viewset is driven directly (rather than through the HTTP layer) so that
every query-parameter branch can be exercised in isolation, including the
branches the routed endpoint's permission classes make unreachable.
"""

import datetime

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from api.models import AlbumDate
from api.models.photo_stack import PhotoStack
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)
from api.views.albums import AlbumDateViewSet


class AlbumDateGetQuerysetTestBase(TestCase):
    factory = APIRequestFactory()

    def make_view(self, user, pk, **params):
        request = Request(self.factory.get("/api/albums/date/x/", params))
        request.user = user
        view = AlbumDateViewSet()
        view.request = request
        view.kwargs = {"pk": str(pk)}
        return view

    def run_queryset(self, user, album, **params):
        album_date, page, count = self.make_view(
            user, album.id, **params
        ).get_queryset()
        return album_date, list(page), count

    def ids(self, photos):
        return {str(photo.pk) for photo in photos}


class AlbumDateGetQuerysetFilterTest(AlbumDateGetQuerysetTestBase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.timestamp = timezone.now()
        self.album = AlbumDate.objects.create(
            owner=self.user, date=self.timestamp.date()
        )

    def photo(self, owner=None, **kwargs):
        kwargs.setdefault("exif_timestamp", self.timestamp)
        photo = create_test_photo(owner=owner or self.user, **kwargs)
        photo.files.add(photo.main_file)
        self.album.photos.add(photo)
        return photo

    # --- happy path ---------------------------------------------------

    def test_returns_album_page_and_count_triple(self):
        visible = self.photo()

        album_date, photos, count = self.run_queryset(self.user, self.album)

        self.assertEqual(album_date.id, self.album.id)
        self.assertEqual(self.ids(photos), {str(visible.pk)})
        self.assertEqual(count, 1)

    def test_default_filters_hide_other_owners_hidden_and_trashed_photos(self):
        mine = self.photo()
        self.photo(owner=self.other)
        self.photo(hidden=True)
        self.photo(in_trashcan=True)

        _, photos, count = self.run_queryset(self.user, self.album)

        self.assertEqual(self.ids(photos), {str(mine.pk)})
        self.assertEqual(count, 1)

    def test_photo_without_thumbnail_aspect_ratio_is_excluded(self):
        kept = self.photo()
        self.photo(aspect_ratio=None)

        _, photos, _ = self.run_queryset(self.user, self.album)

        self.assertEqual(self.ids(photos), {str(kept.pk)})

    # --- favorite / rating -------------------------------------------

    def test_favorite_uses_requesting_users_favorite_min_rating(self):
        self.user.favorite_min_rating = 4
        self.user.save()
        low = self.photo(rating=3)
        high = self.photo(rating=4)

        _, photos, _ = self.run_queryset(self.user, self.album, favorite="true")

        self.assertEqual(self.ids(photos), {str(high.pk)})
        self.assertNotIn(str(low.pk), self.ids(photos))

    # --- public / username -------------------------------------------

    def test_public_for_anonymous_returns_only_public_photos_of_all_owners(self):
        mine_public = self.photo(public=True)
        other_public = self.photo(owner=self.other, public=True)
        self.photo(public=False)

        _, photos, count = self.run_queryset(AnonymousUser(), self.album, public="true")

        self.assertEqual(self.ids(photos), {str(mine_public.pk), str(other_public.pk)})
        self.assertEqual(count, 2)

    def test_public_with_username_restricts_to_that_owner(self):
        self.photo(public=True)
        other_public = self.photo(owner=self.other, public=True)

        _, photos, _ = self.run_queryset(
            AnonymousUser(),
            self.album,
            public="true",
            username=self.other.username,
        )

        self.assertEqual(self.ids(photos), {str(other_public.pk)})

    def test_public_drops_the_owner_filter_even_for_authenticated_users(self):
        """``public`` suppresses ``Q(owner=user)``: foreign public photos show up."""
        other_public = self.photo(owner=self.other, public=True)
        self.photo(public=False)

        _, photos, _ = self.run_queryset(self.user, self.album, public="true")

        self.assertEqual(self.ids(photos), {str(other_public.pk)})

    # --- folder --------------------------------------------------------

    def test_folder_filters_on_file_path_prefix(self):
        match = self.photo()
        other = self.photo()
        match.main_file.path = "/tmp/keepdir/a.png"
        match.main_file.save(update_fields=["path"])
        other.main_file.path = "/tmp/otherdir/b.png"
        other.main_file.save(update_fields=["path"])

        _, photos, _ = self.run_queryset(self.user, self.album, folder="/tmp/keepdir")

        self.assertEqual(self.ids(photos), {str(match.pk)})

    # --- boolean media flags -------------------------------------------

    def test_hidden_true_returns_only_hidden_photos(self):
        self.photo()
        hidden = self.photo(hidden=True)

        _, photos, _ = self.run_queryset(self.user, self.album, hidden="true")

        self.assertEqual(self.ids(photos), {str(hidden.pk)})

    def test_video_and_photo_flags(self):
        still = self.photo()
        video = self.photo(video=True)

        _, only_videos, _ = self.run_queryset(self.user, self.album, video="true")
        _, only_stills, _ = self.run_queryset(self.user, self.album, photo="true")

        self.assertEqual(self.ids(only_videos), {str(video.pk)})
        self.assertEqual(self.ids(only_stills), {str(still.pk)})

    def test_video_and_photo_together_are_mutually_exclusive(self):
        self.photo()
        self.photo(video=True)

        _, photos, count = self.run_queryset(
            self.user, self.album, video="true", photo="true"
        )

        self.assertEqual(photos, [])
        self.assertEqual(count, 0)

    def test_is_screenshot_and_is_document_flags(self):
        self.photo()
        screenshot = self.photo(is_screenshot=True)
        document = self.photo(is_document=True)

        _, shots, _ = self.run_queryset(self.user, self.album, is_screenshot="true")
        _, docs, _ = self.run_queryset(self.user, self.album, is_document="true")

        self.assertEqual(self.ids(shots), {str(screenshot.pk)})
        self.assertEqual(self.ids(docs), {str(document.pk)})

    def test_in_trashcan_excludes_removed_photos(self):
        self.photo()
        trashed = self.photo(in_trashcan=True)
        self.photo(in_trashcan=True, removed=True)

        _, photos, _ = self.run_queryset(self.user, self.album, in_trashcan="true")

        self.assertEqual(self.ids(photos), {str(trashed.pk)})

    # --- stacks ---------------------------------------------------------

    def test_non_primary_stack_photos_are_hidden_unless_show_all_stack_photos(self):
        primary = self.photo()
        secondary = self.photo()
        unstacked = self.photo()
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=primary,
        )
        primary.stacks.add(stack)
        secondary.stacks.add(stack)

        _, default_photos, _ = self.run_queryset(self.user, self.album)
        _, all_photos, _ = self.run_queryset(
            self.user, self.album, show_all_stack_photos="true"
        )

        self.assertEqual(self.ids(default_photos), {str(primary.pk), str(unstacked.pk)})
        self.assertEqual(
            self.ids(all_photos),
            {str(primary.pk), str(secondary.pk), str(unstacked.pk)},
        )

    # --- person ---------------------------------------------------------

    def test_person_filter_matches_photos_with_that_persons_face(self):
        tagged = self.photo()
        self.photo()
        person = create_test_person()
        create_test_face(photo=tagged, person=person)

        _, photos, count = self.run_queryset(
            self.user, self.album, person=str(person.id)
        )

        self.assertEqual(self.ids(photos), {str(tagged.pk)})
        self.assertEqual(count, 1)

    def test_person_filter_deduplicates_photos_with_several_matching_faces(self):
        tagged = self.photo()
        person = create_test_person()
        create_test_face(photo=tagged, person=person)
        create_test_face(photo=tagged, person=person)

        _, photos, count = self.run_queryset(
            self.user, self.album, person=str(person.id)
        )

        self.assertEqual([str(p.pk) for p in photos], [str(tagged.pk)])
        self.assertEqual(count, 1)

    # --- last_modified ----------------------------------------------------

    def test_last_modified_resets_every_other_filter(self):
        """``last_modified`` throws the accumulated filters away.

        Only ``owner`` and ``exif_timestamp__gte`` survive, so hidden and
        trashed photos (and photos without a thumbnail aspect ratio, and
        non-primary stack members) come back even though the other query
        parameters are still present.
        """
        recent = self.photo()
        hidden = self.photo(hidden=True)
        trashed = self.photo(in_trashcan=True)
        no_ratio = self.photo(aspect_ratio=None)
        self.photo(owner=self.other)
        old = self.photo(exif_timestamp=self.timestamp - datetime.timedelta(days=10))

        cutoff = (self.timestamp - datetime.timedelta(days=1)).isoformat()
        _, photos, count = self.run_queryset(
            self.user, self.album, last_modified=cutoff, video="true"
        )

        self.assertEqual(
            self.ids(photos),
            {str(recent.pk), str(hidden.pk), str(trashed.pk), str(no_ratio.pk)},
        )
        self.assertNotIn(str(old.pk), self.ids(photos))
        self.assertEqual(count, 4)


class AlbumDateGetQuerysetPaginationTest(AlbumDateGetQuerysetTestBase):
    def setUp(self):
        self.user = create_test_user()
        base = timezone.now()
        self.album = AlbumDate.objects.create(owner=self.user, date=base.date())
        self.photos = []
        for index in range(5):
            photo = create_test_photo(
                owner=self.user,
                exif_timestamp=base - datetime.timedelta(minutes=index),
            )
            self.album.photos.add(photo)
            self.photos.append(photo)

    def test_default_page_size_is_100_and_page_none_falls_back_to_first_page(self):
        _, photos, count = self.run_queryset(self.user, self.album)

        self.assertEqual(len(photos), 5)
        self.assertEqual(count, 5)

    def test_photos_are_ordered_by_descending_exif_timestamp(self):
        _, photos, _ = self.run_queryset(self.user, self.album)

        self.assertEqual([str(p.pk) for p in photos], [str(p.pk) for p in self.photos])

    def test_size_and_page_slice_the_result_while_count_stays_total(self):
        _, page_two, count = self.run_queryset(
            self.user, self.album, size="2", page="2"
        )

        self.assertEqual(
            [str(p.pk) for p in page_two],
            [str(self.photos[2].pk), str(self.photos[3].pk)],
        )
        self.assertEqual(count, 5)

    def test_non_integer_page_falls_back_to_the_first_page(self):
        _, photos, _ = self.run_queryset(
            self.user, self.album, size="2", page="not-a-number"
        )

        self.assertEqual(
            [str(p.pk) for p in photos],
            [str(self.photos[0].pk), str(self.photos[1].pk)],
        )

    def test_page_beyond_the_end_falls_back_to_the_last_page(self):
        _, photos, _ = self.run_queryset(self.user, self.album, size="2", page="99")

        self.assertEqual([str(p.pk) for p in photos], [str(self.photos[4].pk)])

    def test_empty_album_still_returns_a_page_and_zero_count(self):
        empty = AlbumDate.objects.create(
            owner=self.user, date=datetime.date(1999, 1, 1)
        )

        album_date, photos, count = self.run_queryset(self.user, empty)

        self.assertEqual(album_date.id, empty.id)
        self.assertEqual(photos, [])
        self.assertEqual(count, 0)


class AlbumDateGetQuerysetMissingAlbumTest(AlbumDateGetQuerysetTestBase):
    def test_unknown_album_pk_raises_attribute_error(self):
        """Known rough edge: a missing album is not turned into a 404.

        ``AlbumDate.objects.filter(...).first()`` returns ``None`` and the very
        next line dereferences ``album_date.photos``.
        """
        user = create_test_user()
        view = self.make_view(user, 999999)

        with self.assertRaises(AttributeError):
            view.get_queryset()
