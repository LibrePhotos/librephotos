"""``POST /api/photosedit/rotate/`` against what a viewer makes of the file.

``Photo.local_orientation`` numbers its turns like EXIF Orientation but draws
6 and 8 the other way round (#2595), so every value that leaves LibrePhotos
for the file has to be converted, never copied. These tests rotate through
the API, both ways, in both write modes, from an upright photo and from one
shot in portrait (EXIF 6), and compare LibrePhotos' regenerated thumbnail
with libvips' ``autorot()`` of the original under the orientation a viewer
reads: the sidecar's ``XMP-tiff:Orientation`` when there is one, the file's
own EXIF Orientation otherwise. They also check the size the photo is shown
at (#2568), and where a face labelled on the turned photo is written and
read back (#2606).

A HEIC is shown under its HEIF irot/imir, not its EXIF Orientation, which
can disagree with them (#2615). Its sidecar orientation is still relative to
the stored pixels, as Apple's EXIF tag and digiKam (which decodes HEIF
without the transformations and applies the orientation it reads, the
sidecar's first) take it: the turn libheif shows, with the user's rotation
on top.
"""

import numpy as np
import pyvips
from rest_framework.test import APIClient

from api.faces.extractor import extract_from_exif
from api.metadata.photo_writer import write_photo_metadata
from api.metadata.tags import Tags
from api.models.person import Person
from api.models.photo import Photo
from api.models.photo_metadata import PhotoMetadata
from api.models.user import User
from api.tests.metadata.exiftool_harness import (
    QUADRANTS,
    RealExifToolTestCase,
    autorotated,
    layout,
    load,
    quadrants,
    shown_layout,
    stored_pixels,
)
from api.tests.utils import create_test_face, create_test_person, create_test_user
from api.thumbnails.render import regenerate_thumbnails

SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE

# A positive angle turns the photo counter-clockwise as shown, a negative one
# clockwise (#2595).
LEFT, RIGHT = 90, -90

# (orientation libheif shows a HEIC under, from irot/imir; its EXIF
# Orientation). The EXIF tag agrees, disagrees or is missing.
HEIC_CASES = [(6, 6), (1, 1), (6, 1), (6, None), (1, 6), (8, 3), (5, 1)]


def _turned(shown, angle):
    """``shown`` (a pyvips image) turned ``angle`` degrees counter-clockwise."""
    return shown.rot270() if angle == LEFT else shown.rot90()


def _colour_at(image, fx, fy):
    pixel = image.getpoint(int(image.width * fx), int(image.height * fy))[:3]
    return min(
        QUADRANTS,
        key=lambda name: sum((a - b) ** 2 for a, b in zip(QUADRANTS[name], pixel)),
    )


class RotateEndpointRoundTripTest(RealExifToolTestCase):
    def _photo(self, mode, start, name, heic=None):
        if heic is None:
            path = self.make_image(".jpg", name)
            if start is not None:
                self.tag(path, f"-EXIF:Orientation#={start}")
        else:
            path = self.make_heic(name, *heic)
        user = create_test_user(save_metadata_to_disk=mode, save_face_tags_to_disk=True)
        photo = self.photo_for(path, user, thumbnails=True)
        # The size the photo is shown at, as the scan stores it (#2568).
        thumbnail = load(photo.thumbnail.thumbnail_big.path)
        PhotoMetadata.objects.update_or_create(
            photo=photo,
            defaults={"width": thumbnail.width, "height": thumbnail.height},
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return photo, path, client

    def _rotate(self, client, photo, angle):
        response = client.post(
            "/api/photosedit/rotate/",
            {"image_hash": photo.image_hash, "angle": angle},
            format="json",
        )
        self.assertEqual(200, response.status_code, response.content)
        self.assertIsNone(response.json()["write_error"])

    def _thumbnail(self, photo):
        photo = Photo.objects.get(pk=photo.pk)
        return load(photo.thumbnail.thumbnail_big.path)

    def _viewer_orientation(self, path, mode):
        if mode == SIDECAR:
            sidecar = self.sidecar_of(path)
            return self.read_tags(sidecar, Tags.ORIENTATION_XMP)[Tags.ORIENTATION_XMP]
        return self.read_tags(path, Tags.ORIENTATION)[Tags.ORIENTATION] or 1

    def test_every_turn_in_every_mode_shows_what_the_thumbnail_shows(self):
        for mode in (SIDECAR, MEDIA_FILE):
            for start in (None, 6):
                for angle in (LEFT, RIGHT):
                    with self.subTest(mode=mode, start=start, angle=angle):
                        photo, path, client = self._photo(
                            mode, start, f"{mode}-{start}-{angle}"
                        )
                        shown = self._thumbnail(photo)
                        self.assertEqual(
                            layout(autorotated(stored_pixels(path), start or 1)),
                            layout(shown),
                        )

                        for _ in range(2):
                            expected = layout(_turned(shown, angle))
                            self._rotate(client, photo, angle)

                            shown = self._thumbnail(photo)
                            self.assertEqual(expected, layout(shown))
                            viewer = self._viewer_orientation(path, mode)
                            self.assertEqual(
                                layout(shown),
                                shown_layout(path, viewer),
                                f"the file turns the other way (orientation {viewer})",
                            )
                            metadata = Photo.objects.get(pk=photo.pk).metadata
                            self.assertEqual(
                                (shown.width, shown.height),
                                (metadata.width, metadata.height),
                            )

    def test_a_face_labelled_on_a_turned_photo_is_written_where_it_is(self):
        """The region in the sidecar covers, in the stored image, the same
        quadrant the face box covers in the thumbnail LibrePhotos shows."""
        for start in (None, 6):
            for angle in (LEFT, RIGHT):
                with self.subTest(start=start, angle=angle):
                    photo, path, client = self._photo(
                        SIDECAR, start, f"face-{start}-{angle}"
                    )
                    self._rotate(client, photo, angle)
                    photo = Photo.objects.get(pk=photo.pk)
                    shown = self._thumbnail(photo)
                    # A face in the top-left quadrant of the turned thumbnail.
                    width, height = shown.width, shown.height
                    person = create_test_person(
                        name="Alice", kind=Person.KIND_USER, cluster_owner=photo.owner
                    )
                    create_test_face(
                        photo=photo,
                        person=person,
                        location_top=height // 8,
                        location_right=width * 3 // 8,
                        location_bottom=height * 3 // 8,
                        location_left=width // 8,
                    )

                    write_photo_metadata(
                        photo, use_sidecar=True, metadata_types=["face_tags"]
                    )

                    sidecar = self.sidecar_of(path)
                    region = self.read_tags(sidecar, Tags.REGION_INFO)[Tags.REGION_INFO]
                    area = region["RegionList"][0]["Area"]
                    self.assertEqual(
                        _colour_at(shown, 0.25, 0.25),
                        _colour_at(stored_pixels(path), area["X"], area["Y"]),
                        f"region {area} is not on the face",
                    )
                    # And the scan reads it back onto the same box.
                    ((*box, name),) = extract_from_exif(
                        path,
                        photo.thumbnail.thumbnail_big.path,
                        local_orientation=photo.local_orientation,
                    )
                    self.assertEqual("Alice", name)
                    expected = (
                        height // 8,
                        width * 3 // 8,
                        height * 3 // 8,
                        width // 8,
                    )
                    for read, written in zip(box, expected):
                        self.assertAlmostEqual(read, written, delta=1)

    def test_a_turned_heic_sidecar_shows_what_the_thumbnail_shows(self):
        """The sidecar's orientation shows the stored pixels the way the
        thumbnail does, whatever the HEIC's own EXIF Orientation says, and a
        rebuild of the thumbnails (a rescan) leaves them as they are."""
        stored = pyvips.Image.new_from_array(np.asarray(quadrants()))
        for decoder, exif in HEIC_CASES:
            for angle in (LEFT, RIGHT):
                with self.subTest(decoder=decoder, exif=exif, angle=angle):
                    photo, path, client = self._photo(
                        SIDECAR, None, f"heic-{decoder}-{exif}-{angle}", (decoder, exif)
                    )
                    shown = self._thumbnail(photo)
                    self.assertEqual(
                        layout(autorotated(stored, decoder)),
                        layout(shown),
                        "the fixture does not render as the test assumes",
                    )

                    for _ in range(2):
                        self._rotate(client, photo, angle)

                        shown = self._thumbnail(photo)
                        viewer = self._viewer_orientation(path, SIDECAR)
                        self.assertEqual(
                            layout(shown),
                            layout(autorotated(stored, viewer)),
                            f"the sidecar shows it otherwise (orientation {viewer})",
                        )
                    regenerate_thumbnails(Photo.objects.get(pk=photo.pk).thumbnail)
                    self.assertEqual(layout(shown), layout(self._thumbnail(photo)))
