"""The timeline filter: one resolver for the date-album list, the per-day page
and server-side select-all (issue #2130).

* ``resolve_timeline_filter`` turns the saved default plus request params into
  a filter: tri-state flags, per-key overrides, and the default only on
  ``apply_default``,
* the list and per-day endpoints agree on what a day holds, and a day mixing
  screenshots with photos is kept (positive filters on the join, no exclude),
* ``build_photo_queryset`` selects exactly what the timeline shows, so "select
  all, then delete" never reaches a hidden screenshot,
* ``default_timeline_filter`` is validated strictly on the user endpoint.
"""

from django.contrib.auth.models import AnonymousUser
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumDate, Photo
from api.tests.utils import create_test_photo, create_test_user
from api.timeline_filter import (
    TimelineFilter,
    parse_tristate,
    resolve_timeline_filter,
)
from api.views.photo_filters import build_photo_queryset


class _FakeUser:
    """Just enough of a User for the resolver: no database needed."""

    is_authenticated = True
    favorite_min_rating = 4

    def __init__(self, default_timeline_filter=None):
        self.default_timeline_filter = default_timeline_filter or {}


class ParseTristateTest(SimpleTestCase):
    def test_true_values(self):
        for value in (True, 1, "true", "True", "1", "yes", "on"):
            self.assertIs(parse_tristate(value), True, value)

    def test_false_values(self):
        for value in (False, 0, "false", "False", "0", "no", "off"):
            self.assertIs(parse_tristate(value), False, value)

    def test_absent_values(self):
        for value in (None, ""):
            self.assertIsNone(parse_tristate(value), value)

    def test_unknown_string_keeps_legacy_truthiness(self):
        # Before the tri-state parser any non-empty value switched a filter on.
        self.assertIs(parse_tristate("screenshots"), True)


class ResolveTimelineFilterTest(SimpleTestCase):
    def test_no_params_is_everything(self):
        self.assertEqual(resolve_timeline_filter(_FakeUser(), {}), TimelineFilter())

    def test_saved_default_ignored_without_apply_default(self):
        user = _FakeUser({"hide_screenshots": True, "media": "photos"})
        self.assertEqual(resolve_timeline_filter(user, {}), TimelineFilter())

    def test_saved_default_applied_on_request(self):
        user = _FakeUser(
            {
                "media": "photos",
                "hide_screenshots": True,
                "hide_documents": True,
                "favorites": True,
            }
        )
        self.assertEqual(
            resolve_timeline_filter(user, {"apply_default": "1"}),
            TimelineFilter(
                media="photos",
                screenshots="hide",
                documents="hide",
                favorites=True,
            ),
        )

    def test_explicit_params_override_default_per_key(self):
        user = _FakeUser(
            {"media": "videos", "hide_screenshots": True, "hide_documents": True}
        )
        resolved = resolve_timeline_filter(
            user,
            {"apply_default": "true", "media": "all", "hide_screenshots": "false"},
        )
        # media and screenshots overridden, documents still from the default.
        self.assertEqual(
            resolved, TimelineFilter(media="all", screenshots="any", documents="hide")
        )

    def test_favorite_false_overrides_saved_favorites(self):
        user = _FakeUser({"favorites": True})
        resolved = resolve_timeline_filter(
            user, {"apply_default": "1", "favorite": "false"}
        )
        self.assertFalse(resolved.favorites)

    def test_is_screenshot_is_tristate(self):
        user = _FakeUser()
        self.assertEqual(
            resolve_timeline_filter(user, {"is_screenshot": "true"}).screenshots,
            "only",
        )
        # Used to return ONLY screenshots: any non-empty string was truthy.
        self.assertEqual(
            resolve_timeline_filter(user, {"is_screenshot": "false"}).screenshots,
            "hide",
        )
        self.assertEqual(
            resolve_timeline_filter(user, {"is_document": "false"}).documents,
            "hide",
        )

    def test_legacy_video_photo_params(self):
        user = _FakeUser()
        self.assertEqual(
            resolve_timeline_filter(user, {"video": "true"}).media, "videos"
        )
        self.assertEqual(
            resolve_timeline_filter(user, {"photo": "true"}).media, "photos"
        )
        self.assertEqual(
            resolve_timeline_filter(user, {"video": "false"}).media, "photos"
        )
        self.assertEqual(resolve_timeline_filter(user, {"photo": True}).media, "photos")
        # Both at once match nothing, on every endpoint alike.
        both = resolve_timeline_filter(user, {"video": "true", "photo": "true"})
        self.assertEqual(both.media, "none")
        self.assertEqual(len(both.q(user)), 2)

    def test_unknown_media_value_is_ignored(self):
        self.assertEqual(
            resolve_timeline_filter(_FakeUser(), {"media": "screenshots"}).media,
            "all",
        )

    def test_malformed_saved_default_is_ignored(self):
        # Written past the serializer (admin, shell): never break the timeline.
        user = _FakeUser({"media": "nope", "hide_screenshots": "yes", "x": 1})
        self.assertEqual(
            resolve_timeline_filter(user, {"apply_default": "1"}), TimelineFilter()
        )

    def test_public_view_never_gets_the_viewers_default(self):
        user = _FakeUser({"hide_screenshots": True})
        for params in (
            {"apply_default": "1", "public": "true"},
            {"apply_default": "1", "public": "true", "username": "bob"},
            {"apply_default": "1", "username": "bob"},
        ):
            with self.subTest(params=params):
                self.assertEqual(
                    resolve_timeline_filter(user, params), TimelineFilter()
                )

    def test_anonymous_user_never_gets_a_default(self):
        self.assertEqual(
            resolve_timeline_filter(AnonymousUser(), {"apply_default": "1"}),
            TimelineFilter(),
        )

    def test_q_objects_use_prefix_and_positive_lookups(self):
        resolved = TimelineFilter(
            media="photos", screenshots="hide", documents="only", favorites=True
        )
        lookups = [
            child
            for q in resolved.q(_FakeUser(), prefix="photos__")
            for child in q.children
        ]
        self.assertEqual(
            sorted(lookups),
            sorted(
                [
                    ("photos__video", False),
                    ("photos__is_screenshot", False),
                    ("photos__is_document", True),
                    ("photos__rating__gte", 4),
                ]
            ),
        )
        for q in resolved.q(_FakeUser(), prefix="photos__"):
            self.assertFalse(q.negated)


class TimelineEndpointsTest(TestCase):
    """The list and per-day endpoints resolve the filter identically."""

    def setUp(self):
        self.user = create_test_user(
            default_timeline_filter={"hide_screenshots": True, "hide_documents": True}
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.day = now.date()
        self.mixed = AlbumDate.objects.create(owner=self.user, date=self.day)
        self.plain = create_test_photo(owner=self.user, exif_timestamp=now)
        self.video = create_test_photo(owner=self.user, exif_timestamp=now, video=True)
        self.screenshot = create_test_photo(
            owner=self.user, exif_timestamp=now, is_screenshot=True
        )
        self.document = create_test_photo(
            owner=self.user, exif_timestamp=now, is_document=True
        )
        self.mixed.photos.add(self.plain, self.video, self.screenshot, self.document)

        earlier = now - timezone.timedelta(days=3)
        self.shots_only = AlbumDate.objects.create(owner=self.user, date=earlier.date())
        self.shots_only.photos.add(
            create_test_photo(
                owner=self.user, exif_timestamp=earlier, is_screenshot=True
            )
        )

    def _list(self, params):
        response = self.client.get("/api/albums/date/list/", params)
        self.assertEqual(response.status_code, 200)
        return {row["id"]: row["numberOfItems"] for row in response.json()["results"]}

    def _day(self, album, params):
        response = self.client.get(f"/api/albums/date/{album.id}/", params)
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        return {item["image_hash"] for item in results["items"]}, results[
            "numberOfItems"
        ]

    def test_without_apply_default_nothing_changes(self):
        days = self._list({})
        self.assertEqual(days, {str(self.mixed.id): 4, str(self.shots_only.id): 1})

    def test_apply_default_hides_screenshot_only_day_and_keeps_mixed_day(self):
        days = self._list({"apply_default": "1"})
        # The mixed day is kept with its two remaining items; the day holding
        # nothing but a screenshot drops out.
        self.assertEqual(days, {str(self.mixed.id): 2})

    def test_list_and_day_agree(self):
        for params in (
            {},
            {"apply_default": "1"},
            {"apply_default": "1", "hide_screenshots": "false"},
            {"media": "videos"},
            {"is_screenshot": "false"},
            {"is_document": "true"},
            {"apply_default": "1", "media": "photos"},
        ):
            with self.subTest(params=params):
                days = self._list(params)
                hashes, count = self._day(self.mixed, params)
                self.assertEqual(len(hashes), count)
                self.assertEqual(days.get(str(self.mixed.id), 0), count)

    def test_day_page_applies_default(self):
        hashes, _ = self._day(self.mixed, {"apply_default": "1"})
        self.assertEqual(hashes, {self.plain.image_hash, self.video.image_hash})

    def test_is_screenshot_false_no_longer_returns_only_screenshots(self):
        hashes, _ = self._day(self.mixed, {"is_screenshot": "false"})
        self.assertNotIn(self.screenshot.image_hash, hashes)
        self.assertIn(self.plain.image_hash, hashes)

    def test_favorite_filter(self):
        self.plain.rating = self.user.favorite_min_rating
        self.plain.save()
        hashes, _ = self._day(self.mixed, {"favorite": "true"})
        self.assertEqual(hashes, {self.plain.image_hash})
        days = self._list({"favorite": "true"})
        self.assertEqual(days, {str(self.mixed.id): 1})


class PublicTimelineIgnoresViewerDefaultTest(TestCase):
    """Bob's saved default never filters Alice's public timeline."""

    def test_public_list_and_day(self):
        alice = create_test_user()
        bob = create_test_user(default_timeline_filter={"hide_screenshots": True})
        now = timezone.now()
        day = AlbumDate.objects.create(owner=alice, date=now.date())
        shot = create_test_photo(
            owner=alice, exif_timestamp=now, is_screenshot=True, public=True
        )
        day.photos.add(shot)
        client = APIClient()
        client.force_authenticate(user=bob)
        params = {"public": "true", "username": alice.username, "apply_default": "1"}

        listed = client.get("/api/albums/date/list/", params).json()["results"]
        self.assertEqual([row["id"] for row in listed], [str(day.id)])
        items = client.get(f"/api/albums/date/{day.id}/", params).json()["results"]
        self.assertEqual(
            [item["image_hash"] for item in items["items"]], [shot.image_hash]
        )


class SelectAllMatchesTimelineTest(TestCase):
    """Select-all with the timeline's filter touches exactly what it shows."""

    def setUp(self):
        self.user = create_test_user(default_timeline_filter={"hide_screenshots": True})
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.plain = create_test_photo(owner=self.user)
        self.screenshot = create_test_photo(owner=self.user, is_screenshot=True)
        self.document = create_test_photo(owner=self.user, is_document=True)

    def test_explicit_filter_matches(self):
        qs = build_photo_queryset(
            self.user, {"hide_screenshots": True, "hide_documents": True}
        )
        self.assertEqual(set(qs), {self.plain})

    def test_apply_default_matches(self):
        qs = build_photo_queryset(self.user, {"apply_default": True})
        self.assertEqual(set(qs), {self.plain, self.document})

    def test_json_false_is_tristate(self):
        qs = build_photo_queryset(self.user, {"is_screenshot": False})
        self.assertEqual(set(qs), {self.plain, self.document})

    def test_select_all_delete_spares_hidden_screenshots(self):
        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {
                "select_all": True,
                "query": {"hide_screenshots": True, "hide_documents": True},
                "deleted": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        trashed = set(
            Photo.objects.filter(in_trashcan=True).values_list("pk", flat=True)
        )
        self.assertEqual(trashed, {self.plain.pk})


class DefaultTimelineFilterSerializerTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _patch(self, value):
        return self.client.patch(
            f"/api/user/{self.user.id}/",
            {"default_timeline_filter": value},
            format="json",
        )

    def test_defaults_to_empty(self):
        response = self.client.get(f"/api/user/{self.user.id}/")
        self.assertEqual(response.json()["default_timeline_filter"], {})

    def test_saves_valid_filter(self):
        value = {
            "media": "photos",
            "hide_screenshots": True,
            "hide_documents": False,
            "favorites": False,
        }
        response = self._patch(value)
        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.default_timeline_filter, value)

    def test_partial_filter_and_empty_are_valid(self):
        self.assertEqual(self._patch({"hide_screenshots": True}).status_code, 200)
        self.assertEqual(self._patch({}).status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.default_timeline_filter, {})

    def test_rejects_invalid_values(self):
        for value in (
            {"unknown": True},
            {"media": "screenshots"},
            {"hide_screenshots": "true"},
            {"favorites": 1},
            ["media"],
            "photos",
            None,
        ):
            with self.subTest(value=value):
                self.assertEqual(self._patch(value).status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.default_timeline_filter, {})
