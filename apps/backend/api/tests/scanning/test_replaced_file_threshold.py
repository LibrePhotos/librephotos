"""Near-identical content is not a new picture, and a re-keyed file is still known (#2051)."""

from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from api.directory_watcher import file_handlers
from api.directory_watcher.file_handlers import (
    NEW_PICTURE,
    SAME_PICTURE,
    SIMILAR_PICTURE,
    SIMILAR_PICTURE_DISTANCE,
    UNCOMPARABLE,
    _compare_renders,
)
from api.models import Photo
from api.models.photo_caption import PhotoCaption
from api.photos.media_files import calculate_hash
from api.tests.scanning.test_replaced_file_rescan import (
    ReplacedFileTestCase,
    _write_image,
)
from api.tests.utils import (
    create_test_face,
    create_test_photo,
    create_test_user,
)
from api.views.upload import UploadPhotosChunkedComplete

STORED = "c3a5b2f0e1d49687"


def _flip(hash_value, bits):
    """``hash_value`` with its ``bits`` lowest bits flipped."""
    return format(int(hash_value, 16) ^ ((1 << bits) - 1), "016x")


class CompareRendersTest(SimpleTestCase):
    def test_a_few_bits_apart_is_a_similar_picture(self):
        for bits in (1, SIMILAR_PICTURE_DISTANCE):
            with self.subTest(bits=bits):
                self.assertEqual(
                    SIMILAR_PICTURE,
                    _compare_renders(STORED, _flip(STORED, bits), "0000000000000000"),
                )

    def test_more_bits_apart_is_a_new_picture(self):
        far = _flip(STORED, SIMILAR_PICTURE_DISTANCE + 1)
        self.assertEqual(NEW_PICTURE, _compare_renders(STORED, far, far))

    def test_the_legacy_render_matching_is_the_same_picture(self):
        self.assertEqual(
            SAME_PICTURE, _compare_renders(STORED, _flip(STORED, 2), STORED)
        )

    def test_a_legacy_render_a_few_bits_apart_is_a_similar_picture(self):
        self.assertEqual(
            SIMILAR_PICTURE, _compare_renders(STORED, None, _flip(STORED, 3))
        )

    def test_a_failed_render_and_a_far_one_cannot_decide(self):
        far = _flip(STORED, 30)
        self.assertEqual(UNCOMPARABLE, _compare_renders(STORED, None, far))
        self.assertEqual(UNCOMPARABLE, _compare_renders(STORED, far, None))


class SimilarPictureRescanTest(ReplacedFileTestCase):
    """A re-encode keeps the labels and rebuilds the thumbnails in place."""

    def test_a_re_encoded_picture_keeps_its_faces_and_things(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        create_test_face(photo=photo)
        caption, _ = PhotoCaption.objects.get_or_create(photo=photo)
        caption.store_tags(["lighthouse"])
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()
        nearly = _flip(Photo.objects.get(pk=photo.pk).perceptual_hash, 2)

        _write_image(self.path, 2)
        with (
            patch.object(
                file_handlers, "_rendered_perceptual_hash", return_value=nearly
            ),
            patch("api.video.transcode_cache.discard") as discard,
        ):
            rescanned = self._scan()

        rescanned = Photo.objects.get(pk=rescanned.pk)
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertEqual(1, rescanned.faces.count())
        self.assertIn(
            "openclip_vitb32", PhotoCaption.objects.get(photo=rescanned).captions_json
        )
        discard.assert_called_once_with(image_hash)
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)


class RekeyedFileUploadTest(ReplacedFileTestCase):
    """After a same-picture re-key the photo's image hash and its file's hash
    differ; uploading that file again must still be a duplicate."""

    def setUp(self):
        super().setUp()
        _write_image(self.path, 1)
        self.photo = self._index()
        # A metadata write by another tool: new bytes, same picture.
        with open(self.path, "ab") as f:
            f.write(b"\x00")
        self._scan()
        self.file_hash = calculate_hash(self.user, self.path)
        self.photo.refresh_from_db()
        self.assertNotEqual(self.file_hash, self.photo.image_hash)

    def test_uploading_the_rekeyed_file_again_is_a_duplicate(self):
        target = UploadPhotosChunkedComplete().target_path(
            self.user, "web", "IMG_0001.png", self.file_hash
        )

        self.assertEqual("", target)

    def test_the_exists_check_finds_the_photo_by_its_files_hash(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get(f"/api/exists/{self.file_hash}/")

        self.assertEqual(
            {"exists": True, "photo_id": str(self.photo.pk)}, response.json()
        )

    def test_another_users_file_hash_stays_unknown(self):
        client = APIClient()
        client.force_authenticate(user=create_test_user())

        response = client.get(f"/api/exists/{self.file_hash}/")

        self.assertEqual({"exists": False, "photo_id": None}, response.json())

    def test_the_duplicate_answers_the_photo_it_is_a_copy_of(self):
        # The upload answers its photo_id and files it into the upload album (#612).
        found = UploadPhotosChunkedComplete().existing_photo(self.user, self.file_hash)

        self.assertEqual(self.photo.pk, found.pk)

    def test_a_photo_is_found_once_when_both_hashes_match(self):
        photo = create_test_photo(owner=self.user)

        found = Photo.objects.owned_by(self.user).holding_content(photo.image_hash)

        self.assertEqual([photo.pk], list(found.values_list("pk", flat=True)))
