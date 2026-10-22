"""A replaced picture loses what the machine learned about the old one (#2041).

The things, the generated caption, the search embedding and the text found in
the picture are made by jobs that pick photos without them, so a replacement
has to clear them; what the user entered stays.
"""

import datetime
from unittest.mock import patch

from constance.test import override_config
from django.utils import timezone

from api.directory_watcher.processing_jobs import (
    generate_ocr,
    photos_to_caption,
    photos_to_tag,
)
from api.models import Photo
from api.models.album_thing import AlbumThing
from api.models.long_running_job import LongRunningJob
from api.models.photo_caption import PhotoCaption
from api.models.photo_ocr import PhotoOcr
from api.models.photo_search import PhotoSearch
from api.search.embedding_jobs import photos_missing_clip_embeddings
from api.search.semantic import OPENCLIP, TAG_THING_TYPE
from api.tests.scanning.test_replaced_file_rescan import (
    ReplacedFileTestCase,
    _write_image,
)
from api.tests.utils import (
    create_test_album_user,
    create_test_job,
    create_test_photo_ocr,
    create_test_tag,
    create_test_user,
)

OCR_ENGINE = "ppocrv6_small"


class GeneratedContentFixture(ReplacedFileTestCase):
    def _generate(self, photo):
        """Give ``photo`` what the tag, caption, embedding and OCR jobs store."""
        caption, _ = PhotoCaption.objects.get_or_create(photo=photo)
        caption.apply_user_caption("our holiday")
        caption.captions_json["imported_description"] = "from the camera"
        caption.store_generated_caption(
            caption.captions_json, "a lighthouse by the sea", commit=True
        )
        caption.store_tags(["lighthouse"])
        caption.store_search_embedding([0.6, 0.8])
        create_test_photo_ocr(photo, text="harbour", engine=OCR_ENGINE)
        return Photo.objects.get(pk=photo.pk)

    def _things_of(self, photo):
        return list(
            AlbumThing.objects.filter(
                photos=photo, thing_type=TAG_THING_TYPE
            ).values_list("title", flat=True)
        )

    def _search_text(self, photo):
        return PhotoSearch.objects.get(photo=photo).search_captions


class ReplacedPictureGeneratedContentTest(GeneratedContentFixture):
    def test_a_new_picture_loses_its_generated_content(self):
        _write_image(self.path, 1)
        photo = self._generate(self._index())
        self.assertEqual(["lighthouse"], self._things_of(photo))
        self.assertIn("lighthouse", self._search_text(photo))

        _write_image(self.path, 2)
        rescanned = Photo.objects.get(pk=self._scan().pk)

        captions = PhotoCaption.objects.get(photo=rescanned).captions_json
        self.assertNotIn("im2txt", captions)
        self.assertNotIn(OPENCLIP, captions)
        self.assertEqual([], self._things_of(rescanned))
        self.assertIsNone(rescanned.clip_embeddings)
        self.assertIsNone(rescanned.clip_embeddings_magnitude)
        self.assertIsNone(rescanned.clip_embeddings_model)
        self.assertFalse(PhotoOcr.objects.filter(photo=rescanned).exists())
        search_text = self._search_text(rescanned)
        self.assertNotIn("lighthouse", search_text)
        self.assertIn("our holiday", search_text)

    def test_what_the_user_entered_stays(self):
        _write_image(self.path, 1)
        photo = self._generate(self._index())
        tag = create_test_tag(self.user)
        tag.photos.add(photo)
        album = create_test_album_user(self.user)
        album.photos.add(photo)
        Photo.objects.filter(pk=photo.pk).update(rating=4)

        _write_image(self.path, 2)
        rescanned = Photo.objects.get(pk=self._scan().pk)

        captions = PhotoCaption.objects.get(photo=rescanned).captions_json
        self.assertEqual("our holiday", captions["user_caption"])
        self.assertEqual("from the camera", captions["imported_description"])
        self.assertEqual(4, rescanned.rating)
        self.assertTrue(tag.photos.filter(pk=rescanned.pk).exists())
        self.assertTrue(album.photos.filter(pk=rescanned.pk).exists())

    def test_a_metadata_write_keeps_the_generated_content(self):
        _write_image(self.path, 1)
        photo = self._generate(self._index())

        with open(self.path, "ab") as f:
            f.write(b"\x00")
        rescanned = Photo.objects.get(pk=self._scan().pk)

        self.assertEqual(photo.image_hash, rescanned.image_hash)
        self.assertEqual(["lighthouse"], self._things_of(rescanned))
        self.assertIsNotNone(rescanned.clip_embeddings)
        self.assertTrue(PhotoOcr.objects.filter(photo=rescanned).exists())

    def test_an_uncomparable_change_keeps_the_generated_content(self):
        _write_image(self.path, 1)
        self._generate(self._index())

        _write_image(self.path, 2)
        with patch("api.directory_watcher.file_handlers.is_video", return_value=True):
            rescanned = Photo.objects.get(pk=self._scan().pk)

        captions = PhotoCaption.objects.get(photo=rescanned).captions_json
        self.assertEqual("a lighthouse by the sea", captions["im2txt"])
        self.assertIsNotNone(rescanned.clip_embeddings)
        self.assertTrue(PhotoOcr.objects.filter(photo=rescanned).exists())

    def test_every_users_photo_of_a_shared_file_is_cleared(self):
        _write_image(self.path, 1)
        photo = self._generate(self._index())
        other_user = create_test_user()
        other_photo = self._scan(user=other_user)
        self._derive(other_photo)
        other_photo = self._generate(other_photo)

        _write_image(self.path, 2)
        self._scan()

        for cleared in Photo.objects.filter(pk__in=[photo.pk, other_photo.pk]):
            self.assertIsNone(cleared.clip_embeddings)
            self.assertFalse(PhotoOcr.objects.filter(photo=cleared).exists())
            self.assertEqual([], self._things_of(cleared))


class ClearedPhotoIsSelectedAgainTest(GeneratedContentFixture):
    """The incremental runs of every job pick the cleared photo up."""

    def setUp(self):
        super().setUp()
        _write_image(self.path, 1)
        self.photo = self._generate(self._index())
        # Earlier runs of the jobs covered the photo as it was.
        self.assertFalse(photos_to_tag(self.user, False).exists())
        self.assertFalse(photos_to_caption(self.user, False).exists())
        self.assertFalse(photos_missing_clip_embeddings(self.user).exists())
        _write_image(self.path, 2)
        self._scan()

    def test_the_things_job_selects_it(self):
        self.assertTrue(photos_to_tag(self.user, False).filter(pk=self.photo.pk))

    def test_the_caption_job_selects_it(self):
        self.assertTrue(photos_to_caption(self.user, False).filter(pk=self.photo.pk))

    def test_the_embedding_job_selects_it(self):
        self.assertTrue(
            photos_missing_clip_embeddings(self.user).filter(pk=self.photo.pk)
        )

    @override_config(OCR_MODEL=OCR_ENGINE)
    def test_the_ocr_job_selects_it(self):
        # A finished run before the replacement is the incremental baseline.
        create_test_job(
            self.user,
            job_type=LongRunningJob.JOB_GENERATE_OCR,
            started_at=timezone.now() - datetime.timedelta(hours=1),
            finished=True,
            progress_target=1,
            progress_current=1,
        )
        selected = []

        def begin(lrj, photos):
            selected.extend(photos.values_list("pk", flat=True))
            return False

        with patch(
            "api.directory_watcher.processing_jobs._begin_photo_scan",
            side_effect=begin,
        ):
            generate_ocr(self.user, None)

        self.assertEqual([self.photo.pk], selected)
