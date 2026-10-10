"""Semantic search on OpenCLIP, the one image-text model.

It runs in the tags sidecar, the tags job stores the embedding of its own run,
embeddings record their model, and those of earlier models are re-embedded in
place (and re-tagged from the same run), never dropped.
"""

from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api import semantic_search
from api.batch_jobs import store_clip_embeddings
from api.directory_watcher import utils as watcher_utils
from api.image_similarity import search_similar_image
from api.models import LongRunningJob, Photo
from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.tests.utils import create_test_photo, create_test_user

OPENCLIP = semantic_search.OPENCLIP
EARLIER_MODEL = "an-earlier-model"


def _reply(body):
    response = MagicMock()
    response.status_code = 200
    response.raise_for_status.return_value = None
    response.json.return_value = body
    return response


class RoutingAndThresholdsTest(TestCase):
    @patch("api.sidecars.http.post")
    def test_queries_run_in_the_tags_sidecar(self, post):
        post.return_value = _reply({"emb": [1.0], "magnitude": 1.0})

        semantic_search.calculate_query_embeddings("a dog")

        self.assertIn(":8011/query-embeddings", post.call_args.args[0])  # tags
        self.assertEqual(post.call_args.kwargs["json"], {"query": "a dog"})

    @patch("api.sidecars.http.post")
    def test_images_run_in_the_tags_sidecar(self, post):
        post.return_value = _reply(
            {"imgs_emb": [[1.0], None], "magnitudes": [1.0, None]}
        )

        embeddings, magnitudes, tags = semantic_search.create_clip_embeddings(
            ["/a.webp", "/b.webp"]
        )

        self.assertIn(":8011/clip-embeddings", post.call_args.args[0])
        self.assertEqual(
            post.call_args.kwargs["json"], {"imgs": ["/a.webp", "/b.webp"]}
        )
        self.assertEqual(embeddings[0].tolist(), [1.0])
        self.assertIsNone(embeddings[1])
        self.assertEqual(magnitudes, [1.0, None])
        self.assertIsNone(tags)

    @patch("api.sidecars.http.post")
    def test_images_with_the_tags_of_the_same_run(self, post):
        post.return_value = _reply(
            {"imgs_emb": [[1.0]], "magnitudes": [1.0], "tags": [["cat"]]}
        )

        _, _, tags = semantic_search.create_clip_embeddings(["/a.webp"], with_tags=True)

        self.assertTrue(post.call_args.kwargs["json"]["with_tags"])
        self.assertEqual(tags, [["cat"]])

    def test_thresholds_are_openclips(self):
        self.assertEqual(semantic_search.SEARCH_THRESHOLD, 31.3)
        self.assertEqual(semantic_search.SIMILAR_THRESHOLD, 138.9)

    def test_only_openclip_rows_are_current(self):
        user = create_test_user()
        legacy = create_test_photo(owner=user)
        legacy.clip_embeddings = [1.0]
        legacy.save()  # NULL: CLIP ViT-B/32
        earlier = create_test_photo(owner=user)
        earlier.clip_embeddings = [1.0]
        earlier.clip_embeddings_model = EARLIER_MODEL
        earlier.save()
        current = create_test_photo(owner=user)
        current.clip_embeddings = [1.0]
        current.clip_embeddings_model = OPENCLIP
        current.save()

        self.assertEqual(
            list(Photo.objects.filter(semantic_search.produced_by_openclip())),
            [current],
        )
        self.assertEqual(
            {
                p.pk
                for p in Photo.objects.exclude(semantic_search.produced_by_openclip())
            },
            {legacy.pk, earlier.pk},
        )
        self.assertEqual(
            [
                semantic_search.is_current_embedding(p)
                for p in (legacy, earlier, current)
            ],
            [False, False, True],
        )


class SimilarPhotosTest(TestCase):
    @patch("api.sidecars.http.post")
    def test_a_photo_of_an_earlier_model_has_none_yet(self, post):
        photo = create_test_photo(owner=create_test_user())
        photo.clip_embeddings = [0.5] * 4  # CLIP ViT-B/32, not converted
        photo.save()

        self.assertEqual(search_similar_image(photo.owner, photo), [])
        post.assert_not_called()

    @patch("api.sidecars.http.post")
    def test_openclips_threshold_is_sent(self, post):
        photo = create_test_photo(owner=create_test_user())
        photo.clip_embeddings = [0.5] * 4
        photo.clip_embeddings_model = OPENCLIP
        photo.save()
        post.return_value = _reply({"status": True, "result": []})

        search_similar_image(photo.owner, photo)

        self.assertEqual(post.call_args.kwargs["json"]["threshold"], 138.9)


@override_settings(FEATURE_SCENE_CLASSIFICATION=True)
class TagsStoreTheEmbeddingTest(TestCase):
    def setUp(self):
        self.photo = create_test_photo(owner=create_test_user())
        self.caption, _ = PhotoCaption.objects.get_or_create(photo=self.photo)
        self.caption.captions_json = None
        self.caption.save()

    def _tag(self, body):
        with patch("api.models.photo_caption.sidecars.post") as post:
            post.return_value = _reply(body)
            self.caption.generate_tag_captions(commit=True)
        return post

    def test_one_run_gives_the_tags_and_the_search_embedding(self):
        post = self._tag({"tags": {"tags": ["beach"], "embedding": [3.0, 4.0]}})

        sent = post.call_args.kwargs["json"]
        self.assertTrue(sent["with_embedding"])
        self.assertEqual(sent["tagging_model"], OPENCLIP)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.clip_embeddings, [3.0, 4.0])
        self.assertEqual(self.photo.clip_embeddings_magnitude, 5.0)
        self.assertEqual(self.photo.clip_embeddings_model, OPENCLIP)
        caption = PhotoCaption.objects.get(photo=self.photo)
        # The vector is not kept with the tags.
        self.assertEqual(caption.captions_json[OPENCLIP], {"tags": ["beach"]})
        self.assertEqual(
            list(
                AlbumThing.objects.filter(photos=self.photo).values_list(
                    "title", "thing_type"
                )
            ),
            [("beach", semantic_search.TAG_THING_TYPE)],
        )

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_tagging_off_tags_nothing(self):
        with patch("api.models.photo_caption.sidecars.post") as post:
            self.caption.generate_tag_captions(commit=True)
        post.assert_not_called()


@override_settings(FEATURE_SCENE_CLASSIFICATION=True)
class EmbeddingsAfterTagsTest(TestCase):
    def _finish_tags_job(self):
        user = create_test_user()
        job = LongRunningJob.objects.create(
            started_by=user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            progress_current=1,
            progress_target=1,
        )
        with patch("django_q.tasks.AsyncTask") as task:
            watcher_utils.finish_job_if_complete(job.job_id)
        return user, task

    def test_the_tags_job_queues_the_embedding_job(self):
        from api.batch_jobs import batch_calculate_clip_embedding

        user, task = self._finish_tags_job()

        task.assert_called_once_with(batch_calculate_clip_embedding, user)
        task.return_value.run.assert_called_once()

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_nothing_to_do_without_tagging(self):
        _, task = self._finish_tags_job()

        task.assert_not_called()


class ConversionTest(TestCase):
    def setUp(self):
        self.legacy_user = create_test_user()
        photo = create_test_photo(owner=self.legacy_user)
        photo.clip_embeddings = [1.0]
        photo.save()  # NULL: CLIP ViT-B/32
        self.earlier_user = create_test_user()
        photo = create_test_photo(owner=self.earlier_user)
        photo.clip_embeddings = [1.0]
        photo.clip_embeddings_model = EARLIER_MODEL
        photo.save()
        self.current_user = create_test_user()
        photo = create_test_photo(owner=self.current_user)
        photo.clip_embeddings = [1.0]
        photo.clip_embeddings_model = OPENCLIP
        photo.save()

    def test_startup_re_embeds_only_libraries_of_earlier_models(self):
        from api.batch_jobs import batch_calculate_clip_embedding
        from api.image_similarity import build_image_similarity_index

        with (
            patch("django_q.tasks.AsyncTask") as task,
            patch(
                "api.management.commands.build_similarity_index.AsyncTask"
            ) as index_task,
        ):
            call_command("build_similarity_index")

        self.assertEqual(
            {call.args for call in task.call_args_list},
            {
                (batch_calculate_clip_embedding, self.legacy_user),
                (batch_calculate_clip_embedding, self.earlier_user),
            },
        )
        indexed = {call.args[1] for call in index_task.call_args_list}
        self.assertIn(self.current_user, indexed)
        self.assertNotIn(self.legacy_user, indexed)
        self.assertNotIn(self.earlier_user, indexed)
        for call in index_task.call_args_list:
            self.assertIs(call.args[0], build_image_similarity_index)


class ConversionReTagsTest(TestCase):
    """Re-embedding a photo files the tags of the same image-tower run."""

    def setUp(self):
        self.user = create_test_user()
        self.untagged = create_test_photo(owner=self.user)
        self.tagged = create_test_photo(owner=self.user)
        PhotoCaption.objects.update_or_create(
            photo=self.tagged, defaults={"captions_json": {OPENCLIP: {"tags": ["dog"]}}}
        )
        for photo in (self.untagged, self.tagged):
            photo.clip_embeddings = [1.0]
            photo.clip_embeddings_model = EARLIER_MODEL
            photo.save()

    def _store(self, tags):
        reply = {
            "imgs_emb": [[3.0, 4.0], [0.0, 1.0]],
            "magnitudes": [5.0, 1.0],
            "tags": tags,
        }
        objs = [
            Photo.objects.select_related("thumbnail").get(pk=p.pk)
            for p in (self.untagged, self.tagged)
        ]
        with patch("api.sidecars.http.post") as post:
            post.return_value = _reply(reply)
            store_clip_embeddings(objs, with_tags=True)
        return post

    def test_untagged_photos_get_the_tags_and_tagged_ones_keep_theirs(self):
        post = self._store([["cat", "sofa"], ["bird"]])

        self.assertTrue(post.call_args.kwargs["json"]["with_tags"])
        for photo in (self.untagged, self.tagged):
            photo.refresh_from_db()
            self.assertEqual(photo.clip_embeddings_model, OPENCLIP)
        self.assertEqual(self.untagged.clip_embeddings, [3.0, 4.0])
        self.assertEqual(
            PhotoCaption.objects.get(photo=self.untagged).captions_json[OPENCLIP],
            {"tags": ["cat", "sofa"]},
        )
        self.assertEqual(
            PhotoCaption.objects.get(photo=self.tagged).captions_json[OPENCLIP],
            {"tags": ["dog"]},
        )
        self.assertEqual(
            set(
                AlbumThing.objects.filter(
                    thing_type=semantic_search.TAG_THING_TYPE, photos=self.untagged
                ).values_list("title", flat=True)
            ),
            {"cat", "sofa"},
        )
        self.assertIn("cat", self.untagged.search_instance.search_captions.split())

    def test_a_photo_without_tags_in_the_reply_is_left_untagged(self):
        self._store([None, None])

        self.assertFalse(
            PhotoCaption.objects.filter(
                photo=self.untagged, captions_json__has_key=OPENCLIP
            ).exists()
        )


class SiteSettingsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(create_test_user(is_admin=True))

    def test_the_tagging_model_is_reported_read_only(self):
        response = self.client.get("/api/sitesettings")

        self.assertEqual(response.data["tagging_model"], OPENCLIP)
        self.assertNotIn("semantic_search_model", response.data)

    def test_the_model_cannot_be_chosen(self):
        for key in ("tagging_model", "semantic_search_model"):
            with self.subTest(key=key), self.assertRaises(Exception):
                self.client.post("/api/sitesettings", {key: OPENCLIP}, format="json")
