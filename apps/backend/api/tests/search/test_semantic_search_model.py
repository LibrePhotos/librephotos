"""The semantic search model (site setting SEMANTIC_SEARCH_MODEL).

MobileCLIP-S2 by default, in the tags sidecar, with the tags job storing the
embedding of its own run; CLIP ViT-B/32 in the clip_embeddings sidecar on
request. Embeddings record their model, and the other model's are re-embedded
in place, never dropped.
"""

from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api import semantic_search
from api.directory_watcher import utils as watcher_utils
from api.image_similarity import search_similar_image
from api.models import LongRunningJob, Photo
from api.models.photo_caption import PhotoCaption
from api.tests.utils import create_test_photo, create_test_user


def _reply(body):
    response = MagicMock()
    response.status_code = 200
    response.raise_for_status.return_value = None
    response.json.return_value = body
    return response


class RoutingAndThresholdsTest(TestCase):
    @patch("api.sidecars.http.post")
    def test_mobileclip_runs_in_the_tags_sidecar(self, post):
        post.return_value = _reply({"emb": [1.0], "magnitude": 1.0})

        semantic_search.calculate_query_embeddings("a dog")

        url = post.call_args.args[0]
        self.assertIn(":8011/query-embeddings", url)  # tags
        self.assertEqual(post.call_args.kwargs["json"], {"query": "a dog"})

    @override_config(SEMANTIC_SEARCH_MODEL="clip_vit_b32")
    @patch("api.sidecars.http.post")
    def test_clip_vit_b32_runs_in_its_own_sidecar(self, post):
        post.return_value = _reply({"imgs_emb": [[1.0]], "magnitudes": [1.0]})

        semantic_search.create_clip_embeddings(["/a.webp"])

        self.assertIn(":8006/clip-embeddings", post.call_args.args[0])
        self.assertEqual(
            post.call_args.kwargs["json"]["model"],
            semantic_search.dir_clip_ViT_B_32_model,
        )

    def test_thresholds_follow_the_model(self):
        self.assertEqual(semantic_search.search_threshold(), 1.84)
        self.assertEqual(semantic_search.similar_threshold(), 0.71)
        self.assertEqual(semantic_search.search_threshold("clip_vit_b32"), 27.0)
        self.assertEqual(semantic_search.similar_threshold("clip_vit_b32"), 90.0)

    @override_config(SEMANTIC_SEARCH_MODEL="something else")
    def test_an_unknown_value_is_the_default(self):
        self.assertEqual(semantic_search.semantic_search_model(), "mobileclip_s2")

    def test_null_means_clip_vit_b32(self):
        user = create_test_user()
        legacy = create_test_photo(owner=user)
        legacy.clip_embeddings = [1.0]
        legacy.save()
        converted = create_test_photo(owner=user)
        converted.clip_embeddings = [1.0]
        converted.clip_embeddings_model = "mobileclip_s2"
        converted.save()

        for model, expected in (("clip_vit_b32", legacy), ("mobileclip_s2", converted)):
            with self.subTest(model=model):
                self.assertEqual(
                    list(Photo.objects.filter(semantic_search.produced_by(model))),
                    [expected],
                )


class SimilarPhotosTest(TestCase):
    @patch("api.sidecars.http.post")
    def test_a_photo_of_the_other_model_has_none_yet(self, post):
        photo = create_test_photo(owner=create_test_user())
        photo.clip_embeddings = [0.5] * 4  # CLIP ViT-B/32, not converted
        photo.save()

        self.assertEqual(search_similar_image(photo.owner, photo), [])
        post.assert_not_called()

    @patch("api.sidecars.http.post")
    def test_the_selected_models_threshold_is_sent(self, post):
        photo = create_test_photo(owner=create_test_user())
        photo.clip_embeddings = [0.5] * 4
        photo.clip_embeddings_model = "mobileclip_s2"
        photo.save()
        post.return_value = _reply({"status": True, "result": []})

        search_similar_image(photo.owner, photo)

        self.assertEqual(post.call_args.kwargs["json"]["threshold"], 0.71)


@override_settings(FEATURE_SCENE_CLASSIFICATION=True)
@override_config(TAGGING_MODEL="mobileclip_s2", SEMANTIC_SEARCH_MODEL="mobileclip_s2")
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

        self.assertTrue(post.call_args.kwargs["json"]["with_embedding"])
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.clip_embeddings, [3.0, 4.0])
        self.assertEqual(self.photo.clip_embeddings_magnitude, 5.0)
        self.assertEqual(self.photo.clip_embeddings_model, "mobileclip_s2")
        caption = PhotoCaption.objects.get(photo=self.photo)
        # The vector is not kept with the tags.
        self.assertEqual(caption.captions_json["mobileclip_s2"], {"tags": ["beach"]})

    @override_config(SEMANTIC_SEARCH_MODEL="clip_vit_b32")
    def test_not_asked_for_when_another_model_searches(self):
        post = self._tag({"tags": {"tags": ["beach"]}})

        self.assertNotIn("with_embedding", post.call_args.kwargs["json"])
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.clip_embeddings_model)


@override_settings(FEATURE_SCENE_CLASSIFICATION=True)
@override_config(TAGGING_MODEL="mobileclip_s2", SEMANTIC_SEARCH_MODEL="mobileclip_s2")
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

    def test_the_tags_job_queues_the_embedding_job_when_it_shares_the_model(self):
        from api.batch_jobs import batch_calculate_clip_embedding

        user, task = self._finish_tags_job()

        task.assert_called_once_with(batch_calculate_clip_embedding, user)
        task.return_value.run.assert_called_once()

    @override_config(SEMANTIC_SEARCH_MODEL="clip_vit_b32")
    def test_nothing_to_do_otherwise(self):
        _, task = self._finish_tags_job()

        task.assert_not_called()


class ConversionTest(TestCase):
    def setUp(self):
        self.legacy_user = create_test_user()
        photo = create_test_photo(owner=self.legacy_user)
        photo.clip_embeddings = [1.0]
        photo.save()  # CLIP ViT-B/32
        self.current_user = create_test_user()
        photo = create_test_photo(owner=self.current_user)
        photo.clip_embeddings = [1.0]
        photo.clip_embeddings_model = "mobileclip_s2"
        photo.save()

    def test_startup_re_embeds_only_libraries_of_the_other_model(self):
        from api.batch_jobs import batch_calculate_clip_embedding
        from api.image_similarity import build_image_similarity_index

        with (
            patch("django_q.tasks.AsyncTask") as task,
            patch(
                "api.management.commands.build_similarity_index.AsyncTask"
            ) as index_task,
        ):
            call_command("build_similarity_index")

        task.assert_called_once_with(batch_calculate_clip_embedding, self.legacy_user)
        indexed = {call.args[1] for call in index_task.call_args_list}
        self.assertIn(self.current_user, indexed)
        self.assertNotIn(self.legacy_user, indexed)
        for call in index_task.call_args_list:
            self.assertIs(call.args[0], build_image_similarity_index)

    def test_switching_the_model_converts_every_library(self):
        admin = create_test_user(is_admin=True)
        client = APIClient()
        client.force_authenticate(admin)

        with (
            patch("api.views.site_settings.do_all_models_exist", return_value=True),
            patch("api.views.site_settings.queue_semantic_search_conversion") as queue,
        ):
            response = client.post(
                "/api/sitesettings",
                {"semantic_search_model": "clip_vit_b32"},
                format="json",
            )
            # The same value again: nothing new to do.
            client.post(
                "/api/sitesettings",
                {"semantic_search_model": "clip_vit_b32"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["semantic_search_model"], "clip_vit_b32")
        queue.assert_called_once_with()

    def test_an_unknown_model_is_refused(self):
        admin = create_test_user(is_admin=True)
        client = APIClient()
        client.force_authenticate(admin)

        with self.assertRaises(Exception):
            client.post(
                "/api/sitesettings",
                {"semantic_search_model": "resnet"},
                format="json",
            )
