"""A photo's width and height are the size it is shown at (#2568).

A camera that shoots upright usually stores the pixels landscape and tags
them with an EXIF ``Orientation`` of 5-8; the thumbnails, their aspect ratio
and the face boxes are all of the turned image. The scan stores the turned
size too, as it does for a rotated video (#2268). The big thumbnail, rendered
first, decides when its shape says so; otherwise the tags do, with the user's
own rotation (``local_orientation``) on top.

These run the scan's metadata step against real ExifTool.
"""

import datetime
import uuid

from api.directory_watcher.file_handlers import _read_metadata
from api.models.photo import Photo
from api.models.thumbnail import Thumbnail
from api.serializers.photos import PhotoSerializer
from api.tests.metadata.exiftool_harness import HEIGHT, WIDTH, RealExifToolTestCase
from api.tests.utils import create_test_user
from api.thumbnails import render


class ScanReadsPhotoShownSizeTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def scan(
        self,
        orientation: int,
        local_orientation: int = 1,
        thumbnail_aspect_ratio: float = 1,
    ) -> Photo:
        """Scan a file tagged ``orientation``; the thumbnail's aspect ratio of
        1 (the factory's) says nothing about the photo's shape."""
        path = self.make_image(name=f"o{orientation}_l{local_orientation}")
        self.tag(path, f"-Orientation#={orientation}")
        photo = self.photo_for(path, self.user, local_orientation=local_orientation)
        Thumbnail.objects.filter(photo=photo).update(
            aspect_ratio=thumbnail_aspect_ratio
        )
        _read_metadata(photo, path, str(uuid.uuid4()), datetime.datetime.now())
        return Photo.objects.select_related("main_file", "metadata").get(pk=photo.pk)

    def size(self, photo: Photo) -> tuple[int | None, int | None]:
        assert photo.metadata is not None
        return photo.metadata.width, photo.metadata.height

    def test_a_photo_turned_by_its_orientation_stores_its_shown_size(self) -> None:
        for orientation in (5, 6, 7, 8):
            with self.subTest(orientation=orientation):
                photo = self.scan(orientation)

                self.assertEqual((HEIGHT, WIDTH), self.size(photo))
                self.assertEqual(orientation, photo.metadata.orientation)

    def test_an_upright_or_upside_down_photo_keeps_its_size(self) -> None:
        for orientation in (1, 2, 3, 4):
            with self.subTest(orientation=orientation):
                photo = self.scan(orientation)

                self.assertEqual((WIDTH, HEIGHT), self.size(photo))

    def test_the_api_reports_the_shown_size(self) -> None:
        photo = self.scan(6)

        data = PhotoSerializer(photo).data

        self.assertEqual((HEIGHT, WIDTH), (data["width"], data["height"]))

    def test_the_users_rotation_counts_on_top(self) -> None:
        # Turned a quarter by the user: an upright file is shown sideways...
        self.assertEqual((HEIGHT, WIDTH), self.size(self.scan(1, local_orientation=6)))
        # ...and a sideways one upright again.
        self.assertEqual((WIDTH, HEIGHT), self.size(self.scan(6, local_orientation=8)))

    def test_the_thumbnail_decides_where_the_tags_say_nothing(self) -> None:
        # As a HEIC turned by its own rotation (irot), which is no EXIF tag.
        photo = self.scan(1, thumbnail_aspect_ratio=0.67)

        self.assertEqual((HEIGHT, WIDTH), self.size(photo))

    def test_the_thumbnail_wins_over_a_tag_the_renderer_ignores(self) -> None:
        # As a HEIC whose EXIF orientation libheif does not apply.
        photo = self.scan(6, thumbnail_aspect_ratio=1.5)

        self.assertEqual((WIDTH, HEIGHT), self.size(photo))

    def test_the_size_has_the_shape_of_the_rendered_thumbnail(self) -> None:
        path = self.make_image(name="rendered")
        self.tag(path, "-Orientation#=6")
        photo = self.photo_for(path, self.user, thumbnails=True)
        render.calculate_aspect_ratio(photo.thumbnail)

        _read_metadata(photo, path, str(uuid.uuid4()), datetime.datetime.now())

        photo = Photo.objects.select_related("metadata", "thumbnail").get(pk=photo.pk)
        width, height = self.size(photo)
        assert width is not None and height is not None
        self.assertLess(photo.thumbnail.aspect_ratio, 1)
        self.assertAlmostEqual(photo.thumbnail.aspect_ratio, width / height, places=1)
