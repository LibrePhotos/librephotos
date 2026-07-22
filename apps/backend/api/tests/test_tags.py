"""Tests for the Tag entity: the API, the EXIF keyword import and migration 0129."""

from importlib import import_module

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo, Tag
from api.models.photo_metadata import PhotoMetadata
from api.models.tag import link_tags_from_keywords
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


class TagFromMetadataUpdateTest(TestCase):
    """Editing keywords through the metadata endpoint projects them into tags."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.filter(photo=self.photo).delete()

    def test_saving_keywords_creates_tags(self):
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"keywords": ["beach", "sunset"]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            sorted(self.photo.tags.values_list("name", flat=True)),
            ["beach", "sunset"],
        )


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

    def test_create_duplicate_tag_is_rejected(self):
        Tag.objects.create(name="beach", owner=self.user)

        response = self.client.post("/api/tags/", {"name": "beach"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Tag.objects.filter(name="beach").count(), 1)

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

        self.assertEqual(response.status_code, 200)
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
