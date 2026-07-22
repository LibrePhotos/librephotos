"""Tests for the Tag entity: the API, the EXIF keyword import and migration 0129."""

from importlib import import_module

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Photo, Tag
from api.models.photo_metadata import MetadataEdit, PhotoMetadata
from api.models.tag import (
    NAME_MAX_LENGTH,
    link_tags_from_keywords,
    sync_tags_from_keywords,
)
from api.tests.utils import create_test_photo, create_test_photos, create_test_user
from api.views.photo_filters import build_photo_queryset

_migration = import_module("api.migrations.0129_tag")


def _results(response):
    data = response.json()
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


class TagModelTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()

    def test_same_name_allowed_for_different_owners(self):
        Tag.objects.create(name="beach", owner=self.user)
        Tag.objects.create(name="beach", owner=self.other_user)
        self.assertEqual(Tag.objects.filter(name="beach").count(), 2)

    def test_photo_count_tracks_added_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        photos = create_test_photos(number_of_photos=3, owner=self.user)

        tag.photos.add(*photos)

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 3)

    def test_photo_count_tracks_removed_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        photos = create_test_photos(number_of_photos=3, owner=self.user)
        tag.photos.add(*photos)

        tag.photos.remove(photos[0])

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 2)

    def test_photo_count_ignores_hidden_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        visible = create_test_photo(owner=self.user)
        hidden = create_test_photo(owner=self.user, hidden=True)

        tag.photos.add(visible, hidden)

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)

    def test_photo_count_ignores_trashed_and_removed_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        visible = create_test_photo(owner=self.user)
        trashed = create_test_photo(owner=self.user, in_trashcan=True)
        removed = create_test_photo(owner=self.user, removed=True)

        tag.photos.add(visible, trashed, removed)

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)

    def test_photo_count_updated_from_the_photo_side(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        photo = create_test_photo(owner=self.user)

        photo.tags.add(tag)

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)


class LinkTagsFromKeywordsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_creates_a_tag_per_keyword(self):
        photo = create_test_photo(owner=self.user)

        link_tags_from_keywords(photo, ["beach", "sunset"])

        self.assertEqual(
            sorted(Tag.objects.filter(owner=self.user).values_list("name", flat=True)),
            ["beach", "sunset"],
        )
        self.assertEqual(photo.tags.count(), 2)

    def test_reuses_existing_tags(self):
        existing = Tag.objects.create(name="beach", owner=self.user)
        photo = create_test_photo(owner=self.user)

        link_tags_from_keywords(photo, ["beach"])

        self.assertEqual(Tag.objects.filter(owner=self.user).count(), 1)
        self.assertEqual(list(photo.tags.all()), [existing])

    def test_skips_blank_and_non_string_keywords(self):
        photo = create_test_photo(owner=self.user)

        link_tags_from_keywords(photo, ["beach", "  ", "", None, 42])

        self.assertEqual(
            list(Tag.objects.filter(owner=self.user).values_list("name", flat=True)),
            ["beach"],
        )

    def test_is_additive_so_manual_tags_survive_a_rescan(self):
        photo = create_test_photo(owner=self.user)
        manual = Tag.objects.create(name="favourite", owner=self.user)
        manual.photos.add(photo)

        link_tags_from_keywords(photo, ["beach"])

        self.assertEqual(
            sorted(photo.tags.values_list("name", flat=True)),
            ["beach", "favourite"],
        )

    def test_keeps_tags_of_different_owners_apart(self):
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        photo = create_test_photo(owner=self.user)

        link_tags_from_keywords(photo, ["beach"])
        link_tags_from_keywords(other_photo, ["beach"])

        self.assertEqual(Tag.objects.filter(name="beach").count(), 2)
        self.assertEqual(Tag.objects.get(name="beach", owner=self.user).photo_count, 1)

    def test_clips_keywords_longer_than_a_tag_name(self):
        photo = create_test_photo(owner=self.user)

        link_tags_from_keywords(photo, ["x" * (NAME_MAX_LENGTH + 100)])

        self.assertEqual(
            list(Tag.objects.values_list("name", flat=True)), ["x" * NAME_MAX_LENGTH]
        )


class SyncTagsFromKeywordsTest(TestCase):
    """A deliberate keyword edit is authoritative for the tags it created."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_removed_keyword_detaches_its_tag(self):
        link_tags_from_keywords(self.photo, ["beach", "sunset"])

        sync_tags_from_keywords(self.photo, ["beach"], ["beach", "sunset"])

        self.assertEqual(
            list(self.photo.tags.values_list("name", flat=True)), ["beach"]
        )
        self.assertEqual(Tag.objects.get(name="sunset").photo_count, 0)

    def test_hand_made_tags_are_not_touched(self):
        link_tags_from_keywords(self.photo, ["beach"])
        manual = Tag.objects.create(name="favourite", owner=self.user)
        manual.photos.add(self.photo)

        sync_tags_from_keywords(self.photo, [], ["beach"])

        self.assertEqual(
            list(self.photo.tags.values_list("name", flat=True)), ["favourite"]
        )

    def test_other_photos_keep_the_tag(self):
        other = create_test_photo(owner=self.user)
        link_tags_from_keywords(self.photo, ["beach"])
        link_tags_from_keywords(other, ["beach"])

        sync_tags_from_keywords(self.photo, [], ["beach"])

        tag = Tag.objects.get(name="beach")
        self.assertEqual(list(tag.photos.all()), [other])
        self.assertEqual(tag.photo_count, 1)


class TagFromMetadataUpdateTest(TestCase):
    """Editing keywords through the metadata endpoint projects them into tags."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.filter(photo=self.photo).delete()

    def _patch_keywords(self, keywords):
        return self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"keywords": keywords},
            format="json",
        )

    def test_saving_keywords_creates_tags(self):
        response = self._patch_keywords(["beach", "sunset"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            sorted(self.photo.tags.values_list("name", flat=True)),
            ["beach", "sunset"],
        )

    def test_removing_a_keyword_detaches_its_tag(self):
        self._patch_keywords(["beach", "sunset"])

        response = self._patch_keywords(["beach"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            list(self.photo.tags.values_list("name", flat=True)), ["beach"]
        )
        self.assertEqual(Tag.objects.get(name="sunset").photo_count, 0)

    def test_a_tag_added_by_hand_survives_a_keyword_edit(self):
        tag = Tag.objects.create(name="favourite", owner=self.user)
        tag.photos.add(self.photo)

        self._patch_keywords(["beach"])

        self.assertEqual(
            sorted(self.photo.tags.values_list("name", flat=True)),
            ["beach", "favourite"],
        )

    def test_reverting_a_keyword_edit_reverts_the_tags(self):
        self._patch_keywords(["beach", "sunset"])
        self._patch_keywords(["beach"])
        edit = MetadataEdit.objects.filter(
            photo=self.photo, field_name="keywords"
        ).latest("created_at")

        response = self.client.post(
            f"/api/photos/{self.photo.id}/metadata/revert/{edit.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            sorted(self.photo.tags.values_list("name", flat=True)),
            ["beach", "sunset"],
        )

    def test_bulk_keyword_edits_reach_the_tags(self):
        other = create_test_photo(owner=self.user)

        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {
                "photo_ids": [str(self.photo.id), str(other.id)],
                "updates": {"keywords": ["beach"]},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Tag.objects.get(name="beach", owner=self.user).photo_count, 2)


class TagApiTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)

    def test_create_tag(self):
        response = self.client.post("/api/tags/", {"name": "beach"}, format="json")

        self.assertEqual(response.status_code, 201)
        tag = Tag.objects.get(name="beach")
        self.assertEqual(tag.owner, self.user)

    def test_create_tag_strips_whitespace(self):
        self.client.post("/api/tags/", {"name": "  beach  "}, format="json")

        self.assertTrue(Tag.objects.filter(name="beach", owner=self.user).exists())

    def test_create_duplicate_tag_returns_the_existing_one(self):
        existing = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post("/api/tags/", {"name": "beach"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], existing.id)
        self.assertEqual(Tag.objects.filter(name="beach").count(), 1)

    def test_create_does_not_hand_out_another_users_tag(self):
        Tag.objects.create(name="beach", owner=self.other_user)

        response = self.client.post("/api/tags/", {"name": "beach"}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Tag.objects.get(id=response.json()["id"]).owner, self.user)

    def test_list_only_returns_own_tags(self):
        mine = Tag.objects.create(name="beach", owner=self.user)
        theirs = Tag.objects.create(name="mountains", owner=self.other_user)

        ids = {row["id"] for row in _results(self.client.get("/api/tags/"))}

        self.assertIn(mine.id, ids)
        self.assertNotIn(theirs.id, ids)

    def test_list_can_be_filtered_by_photo(self):
        attached = Tag.objects.create(name="beach", owner=self.user)
        attached.photos.add(self.photos[0])
        Tag.objects.create(name="sunset", owner=self.user)

        rows = _results(self.client.get(f"/api/tags/?photo={self.photos[0].id}"))

        self.assertEqual([row["name"] for row in rows], ["beach"])

    def test_list_can_be_filtered_by_image_hash(self):
        attached = Tag.objects.create(name="beach", owner=self.user)
        attached.photos.add(self.photos[0])

        rows = _results(
            self.client.get(f"/api/tags/?photo={self.photos[0].image_hash}")
        )

        self.assertEqual([row["name"] for row in rows], ["beach"])

    def test_list_includes_cover_photos_and_count(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        tag.photos.add(*self.photos)

        row = _results(self.client.get("/api/tags/"))[0]

        self.assertEqual(row["photo_count"], 2)
        self.assertEqual(len(row["cover_photos"]), 2)

    def test_list_ignores_trashed_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        trashed = create_test_photo(owner=self.user, in_trashcan=True)
        tag.photos.add(self.photos[0], trashed)

        row = _results(self.client.get("/api/tags/"))[0]

        # The tile has to promise what the album behind it delivers.
        self.assertEqual(row["photo_count"], 1)
        self.assertEqual(
            [cover["image_hash"] for cover in row["cover_photos"]],
            [self.photos[0].image_hash],
        )

    def test_rename_tag(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.patch(
            f"/api/tags/{tag.id}/", {"name": "seaside"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        tag.refresh_from_db()
        self.assertEqual(tag.name, "seaside")

    def test_rename_to_an_existing_name_is_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        Tag.objects.create(name="seaside", owner=self.user)

        response = self.client.patch(
            f"/api/tags/{tag.id}/", {"name": "seaside"}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        tag.refresh_from_db()
        self.assertEqual(tag.name, "beach")

    def test_delete_tag(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        tag.photos.add(*self.photos)

        response = self.client.delete(f"/api/tags/{tag.id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Tag.objects.filter(id=tag.id).exists())
        # The photos themselves must survive.
        self.assertEqual(Photo.objects.filter(owner=self.user).count(), 2)

    def test_add_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post(
            f"/api/tags/{tag.id}/add/",
            {"photos": [str(photo.id) for photo in self.photos]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["photo_count"], 2)
        self.assertEqual(tag.photos.count(), 2)

    def test_add_photos_by_image_hash(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        self.client.post(
            f"/api/tags/{tag.id}/add/",
            {"photos": [self.photos[0].image_hash]},
            format="json",
        )

        self.assertEqual(list(tag.photos.all()), [self.photos[0]])

    def test_add_photos_without_a_payload_is_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post(f"/api/tags/{tag.id}/add/", {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_add_an_unknown_photo_is_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post(
            f"/api/tags/{tag.id}/add/",
            {"photos": [str(self.photos[0].id), "does-not-exist"]},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(tag.photos.count(), 0)

    def test_remove_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        tag.photos.add(*self.photos)

        response = self.client.post(
            f"/api/tags/{tag.id}/remove/",
            {"photos": [str(self.photos[0].id)]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["photo_count"], 1)
        self.assertEqual(list(tag.photos.all()), [self.photos[1]])

    def test_merge_moves_photos_and_deletes_the_source(self):
        target = Tag.objects.create(name="beach", owner=self.user)
        target.photos.add(self.photos[0])
        source = Tag.objects.create(name="seaside", owner=self.user)
        source.photos.add(self.photos[1])

        response = self.client.post(
            f"/api/tags/{target.id}/merge/", {"tag": source.id}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(Tag.objects.filter(id=source.id).exists())
        self.assertEqual(set(target.photos.all()), set(self.photos))
        target.refresh_from_db()
        self.assertEqual(target.photo_count, 2)

    def test_merge_of_overlapping_tags_does_not_duplicate_photos(self):
        target = Tag.objects.create(name="beach", owner=self.user)
        target.photos.add(*self.photos)
        source = Tag.objects.create(name="seaside", owner=self.user)
        source.photos.add(self.photos[0])

        self.client.post(
            f"/api/tags/{target.id}/merge/", {"tag": source.id}, format="json"
        )

        target.refresh_from_db()
        self.assertEqual(target.photos.count(), 2)
        self.assertEqual(target.photo_count, 2)

    def test_merge_into_itself_is_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post(
            f"/api/tags/{tag.id}/merge/", {"tag": tag.id}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(Tag.objects.filter(id=tag.id).exists())

    def test_merge_without_a_payload_is_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post(f"/api/tags/{tag.id}/merge/", {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_retrieve_returns_grouped_photos(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        tag.photos.add(*self.photos)

        response = self.client.get(f"/api/tags/{tag.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"]["name"], "beach")

    def test_anonymous_users_are_rejected(self):
        tag = Tag.objects.create(name="beach", owner=self.user)

        response = APIClient().get(f"/api/tags/{tag.id}/")

        self.assertIn(response.status_code, (401, 403))


class TagDetailQueryCountTest(TestCase):
    """The tag album renders through ``PhotoSummarySerializer`` like the thing
    album, so it needs the same prefetches or it pays the issue #619 N+1."""

    SMALL = 2
    LARGE = 12

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

    def _tag(self, number_of_photos):
        tag = Tag.objects.create(name=f"beach-{number_of_photos}", owner=self.user)
        tag.photos.add(
            *[
                create_test_photo(owner=self.user, video=False, exif_timestamp=self.now)
                for _ in range(number_of_photos)
            ]
        )
        return tag

    def _count_queries(self, url):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            # Force full rendering of the lazily-serialized payload.
            groups = response.json()["results"]["grouped_photos"]
        photos = sum(len(group["items"]) for group in groups)
        return len(ctx.captured_queries), photos

    def test_query_count_is_constant_in_the_tag_size(self):
        small = self._tag(self.SMALL)
        large = self._tag(self.LARGE)
        # Warm the endpoint: the first request of a fresh database also
        # materialises the django-constance defaults.
        self._count_queries(f"/api/tags/{small.id}/")

        small_queries, small_photos = self._count_queries(f"/api/tags/{small.id}/")
        large_queries, large_photos = self._count_queries(f"/api/tags/{large.id}/")

        # Sanity: the two responses really did render their photos, so the
        # query counts below compare like with like.
        self.assertEqual(small_photos, self.SMALL)
        self.assertEqual(large_photos, self.LARGE)

        per_photo = (large_queries - small_queries) / (self.LARGE - self.SMALL)
        self.assertEqual(
            large_queries,
            small_queries,
            f"/api/tags/ detail issues per-photo queries (N+1): {small_queries} "
            f"queries for {self.SMALL} photos vs {large_queries} for {self.LARGE} "
            f"(~{per_photo:.1f} extra queries per photo).",
        )


class TagIsolationTest(TestCase):
    """Cross-user isolation. This repo has had authz regressions before."""

    def setUp(self):
        self.owner = create_test_user()
        self.attacker = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.attacker)

        self.tag = Tag.objects.create(name="beach", owner=self.owner)
        self.photo = create_test_photo(owner=self.owner)
        self.tag.photos.add(self.photo)

    def test_cannot_retrieve_another_users_tag(self):
        response = self.client.get(f"/api/tags/{self.tag.id}/")

        self.assertEqual(response.status_code, 404)

    def test_cannot_rename_another_users_tag(self):
        response = self.client.patch(
            f"/api/tags/{self.tag.id}/", {"name": "hijacked"}, format="json"
        )

        self.assertEqual(response.status_code, 404)
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.name, "beach")

    def test_cannot_delete_another_users_tag(self):
        response = self.client.delete(f"/api/tags/{self.tag.id}/")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Tag.objects.filter(id=self.tag.id).exists())

    def test_cannot_add_photos_to_another_users_tag(self):
        response = self.client.post(
            f"/api/tags/{self.tag.id}/add/",
            {"photos": [str(self.photo.id)]},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_cannot_attach_another_users_photo_to_own_tag(self):
        own_tag = Tag.objects.create(name="mine", owner=self.attacker)

        response = self.client.post(
            f"/api/tags/{own_tag.id}/add/",
            {"photos": [str(self.photo.id)]},
            format="json",
        )

        # 404 rather than an empty 200: a success the caller cannot act on is
        # worse than an error.
        self.assertEqual(response.status_code, 404)
        self.assertEqual(own_tag.photos.count(), 0)

    def test_cannot_merge_another_users_tag_into_own_tag(self):
        own_tag = Tag.objects.create(name="mine", owner=self.attacker)

        response = self.client.post(
            f"/api/tags/{own_tag.id}/merge/", {"tag": self.tag.id}, format="json"
        )

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Tag.objects.filter(id=self.tag.id).exists())
        self.assertEqual(own_tag.photos.count(), 0)

    def test_cannot_see_another_users_tags_when_filtering_by_their_photo(self):
        rows = _results(self.client.get(f"/api/tags/?photo={self.photo.id}"))

        self.assertEqual(rows, [])


class TagPhotoFilterTest(TestCase):
    """The bulk-operation queryset builder understands the tag param."""

    def setUp(self):
        self.user = create_test_user()
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)
        self.tag = Tag.objects.create(name="beach", owner=self.user)
        self.tag.photos.add(self.photos[0])

    def test_filters_photos_by_tag(self):
        queryset = build_photo_queryset(self.user, {"tag": self.tag.id})

        self.assertEqual(list(queryset), [self.photos[0]])

    def test_without_a_tag_param_all_photos_are_returned(self):
        queryset = build_photo_queryset(self.user, {})

        self.assertEqual(queryset.count(), 2)

    def test_another_users_photos_are_never_returned(self):
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        self.tag.photos.add(other_photo)

        queryset = build_photo_queryset(self.user, {"tag": self.tag.id})

        self.assertEqual(list(queryset), [self.photos[0]])


class TagSearchTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=0)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.tagged = create_test_photo(owner=self.user, search_captions="")
        self.untagged = create_test_photo(owner=self.user, search_captions="")
        tag = Tag.objects.create(name="pinniped", owner=self.user)
        tag.photos.add(self.tagged)

    def test_photos_can_be_found_by_tag_name(self):
        response = self.client.get("/api/photos/?search=pinniped")

        hashes = {row["image_hash"] for row in _results(response)}
        self.assertIn(self.tagged.image_hash, hashes)
        self.assertNotIn(self.untagged.image_hash, hashes)


class Migration0129BackfillTest(TestCase):
    """Exercise the 0129 data migration functions against the live models."""

    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()

    def _run_forward(self):
        from django.apps import apps

        _migration.create_tags_from_keywords(apps, None)

    def _run_reverse(self):
        from django.apps import apps

        _migration.remove_tags_from_keywords(apps, None)

    def _set_keywords(self, photo, keywords):
        PhotoMetadata.objects.filter(photo=photo).delete()
        return PhotoMetadata.objects.create(photo=photo, keywords=keywords)

    def test_creates_tags_from_keywords(self):
        photo = create_test_photo(owner=self.user)
        self._set_keywords(photo, ["beach", "sunset"])
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(
            sorted(Tag.objects.filter(owner=self.user).values_list("name", flat=True)),
            ["beach", "sunset"],
        )
        self.assertEqual(
            sorted(photo.tags.values_list("name", flat=True)), ["beach", "sunset"]
        )

    def test_attributes_tags_to_the_photo_owner(self):
        mine = create_test_photo(owner=self.user)
        theirs = create_test_photo(owner=self.other_user)
        self._set_keywords(mine, ["beach"])
        self._set_keywords(theirs, ["beach"])
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(Tag.objects.filter(name="beach").count(), 2)
        self.assertEqual(
            list(Tag.objects.get(name="beach", owner=self.user).photos.all()), [mine]
        )

    def test_shared_keyword_collects_every_photo(self):
        first = create_test_photo(owner=self.user)
        second = create_test_photo(owner=self.user)
        self._set_keywords(first, ["beach"])
        self._set_keywords(second, ["beach"])
        Tag.objects.all().delete()

        self._run_forward()

        tag = Tag.objects.get(name="beach", owner=self.user)
        self.assertEqual(tag.photos.count(), 2)
        self.assertEqual(tag.photo_count, 2)

    def test_photo_count_ignores_hidden_photos(self):
        visible = create_test_photo(owner=self.user)
        hidden = create_test_photo(owner=self.user, hidden=True)
        self._set_keywords(visible, ["beach"])
        self._set_keywords(hidden, ["beach"])
        Tag.objects.all().delete()

        self._run_forward()

        tag = Tag.objects.get(name="beach", owner=self.user)
        self.assertEqual(tag.photos.count(), 2)
        self.assertEqual(tag.photo_count, 1)

    def test_photo_count_ignores_trashed_photos(self):
        visible = create_test_photo(owner=self.user)
        trashed = create_test_photo(owner=self.user, in_trashcan=True)
        self._set_keywords(visible, ["beach"])
        self._set_keywords(trashed, ["beach"])
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(Tag.objects.get(name="beach", owner=self.user).photo_count, 1)

    def test_clips_keywords_longer_than_a_tag_name(self):
        photo = create_test_photo(owner=self.user)
        self._set_keywords(photo, ["x" * (NAME_MAX_LENGTH + 100)])
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(
            list(Tag.objects.values_list("name", flat=True)), ["x" * NAME_MAX_LENGTH]
        )

    def test_ignores_empty_and_malformed_keywords(self):
        photo = create_test_photo(owner=self.user)
        self._set_keywords(photo, ["  ", "", None, 7, "beach"])
        other = create_test_photo(owner=self.user)
        self._set_keywords(other, "not-a-list")
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(
            list(Tag.objects.values_list("name", flat=True)),
            ["beach"],
        )

    def test_is_idempotent(self):
        photo = create_test_photo(owner=self.user)
        self._set_keywords(photo, ["beach"])
        Tag.objects.all().delete()

        self._run_forward()
        self._run_forward()

        self.assertEqual(Tag.objects.filter(name="beach").count(), 1)
        self.assertEqual(Tag.objects.get(name="beach").photos.count(), 1)

    def test_no_keywords_creates_no_tags(self):
        photo = create_test_photo(owner=self.user)
        self._set_keywords(photo, [])
        create_test_photo(owner=self.user)
        Tag.objects.all().delete()

        self._run_forward()

        self.assertEqual(Tag.objects.count(), 0)

    def test_reverse_removes_the_tags_but_keeps_the_keywords(self):
        photo = create_test_photo(owner=self.user)
        metadata = self._set_keywords(photo, ["beach"])
        Tag.objects.all().delete()
        self._run_forward()

        self._run_reverse()

        self.assertEqual(Tag.objects.count(), 0)
        metadata.refresh_from_db()
        self.assertEqual(metadata.keywords, ["beach"])
        self.assertTrue(Photo.objects.filter(id=photo.id).exists())
