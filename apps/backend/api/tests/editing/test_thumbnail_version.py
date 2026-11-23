"""The grid's ``thumbnail_version``: it moves on every save and revert, and once
more when the rendition turns ready under the same version, because the
thumbnails are made again from it then (a tight crop saved a smaller render)
and the browser keeps a versioned thumbnail for a year."""

from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIRequestFactory

from api.models import Photo, PhotoEdit
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.tests.utils import create_test_photo, create_test_photo_edit, create_test_user


class ThumbnailVersionTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def version(self) -> int:
        request = APIRequestFactory().get("/")
        request.user = self.user
        row = PhotoSummarySerializer(
            with_photo_summary_relations(Photo.objects.filter(pk=self.photo.pk)),
            many=True,
            context={"request": request},
        ).data[0]
        return row["thumbnail_version"]

    def set_edit(self, version: int, rendition: str) -> None:
        PhotoEdit.objects.filter(photo=self.photo).update(
            version=version, rendition=rendition
        )

    def test_zero_without_an_edit(self):
        self.assertEqual(self.version(), 0)

    def test_moves_when_the_rendition_turns_ready_under_the_same_version(self):
        create_test_photo_edit(
            self.photo, version=3, rendition=PhotoEdit.Rendition.PENDING
        )
        pending = self.version()
        self.set_edit(3, PhotoEdit.Rendition.READY)
        ready = self.version()
        self.assertGreater(ready, pending)

    def test_never_goes_back_through_saves_reverts_and_failures(self):
        create_test_photo_edit(
            self.photo, version=1, rendition=PhotoEdit.Rendition.PENDING
        )
        seen = [self.version()]
        for version, rendition in [
            (1, PhotoEdit.Rendition.READY),
            # A save: a new version, its rendition queued again.
            (2, PhotoEdit.Rendition.PENDING),
            (2, PhotoEdit.Rendition.FAILED),
            # A revert raises the version and shows the original.
            (3, PhotoEdit.Rendition.NONE),
            (4, PhotoEdit.Rendition.PENDING),
            (4, PhotoEdit.Rendition.READY),
        ]:
            self.set_edit(version, rendition)
            seen.append(self.version())
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(
            len(set(seen)), len(seen) - 1
        )  # a failure keeps the pending thumbnails
        self.assertEqual(seen, [2, 3, 4, 4, 6, 8, 9])
