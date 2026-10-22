"""Which photos are 360° photo spheres (#483), and what the API says about it."""

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata.projection import (
    EQUIRECTANGULAR,
    UNTAGGED_SPHERE_MIN_WIDTH,
    projection_type_of,
)
from api.tests.utils import create_test_album_auto, create_test_photo, create_test_user


def values(**given: object) -> dict[str, object]:
    """The values the scan reads, with the projection tags and size unset."""
    return {
        "projection_type": None,
        "use_panorama_viewer": None,
        "width": 4000,
        "height": 3000,
        **given,
    }


class ProjectionTypeOfTest(SimpleTestCase):
    def test_gpano_equirectangular_is_a_sphere(self) -> None:
        self.assertEqual(
            EQUIRECTANGULAR,
            projection_type_of(values(projection_type="equirectangular"), False),
        )

    def test_the_projection_is_compared_without_case_or_blanks(self) -> None:
        self.assertEqual(
            EQUIRECTANGULAR,
            projection_type_of(values(projection_type=" Equirectangular "), False),
        )

    def test_use_panorama_viewer_false_keeps_it_flat(self) -> None:
        for flag in (False, "False", "false"):
            with self.subTest(flag=flag):
                self.assertIsNone(
                    projection_type_of(
                        values(
                            projection_type="equirectangular", use_panorama_viewer=flag
                        ),
                        False,
                    )
                )

    def test_use_panorama_viewer_true_is_still_a_sphere(self) -> None:
        for flag in (True, "True"):
            with self.subTest(flag=flag):
                self.assertEqual(
                    EQUIRECTANGULAR,
                    projection_type_of(
                        values(
                            projection_type="equirectangular", use_panorama_viewer=flag
                        ),
                        False,
                    ),
                )

    def test_other_projections_are_flat(self) -> None:
        # A cylindrical phone panorama is 2:1 here on purpose: its GPano type
        # decides, not its shape.
        for projection in ("cylindrical", "cubemap"):
            with self.subTest(projection=projection):
                self.assertIsNone(
                    projection_type_of(
                        values(projection_type=projection, width=8000, height=4000),
                        False,
                    )
                )

    def test_a_video_is_never_a_sphere(self) -> None:
        self.assertIsNone(
            projection_type_of(values(projection_type="equirectangular"), True)
        )

    def test_a_large_untagged_two_to_one_image_is_a_sphere(self) -> None:
        width = UNTAGGED_SPHERE_MIN_WIDTH
        self.assertEqual(
            EQUIRECTANGULAR,
            projection_type_of(values(width=width, height=width // 2), False),
        )

    def test_untagged_images_that_are_not_large_two_to_one_are_flat(self) -> None:
        for width, height in (
            # A phone's 18:9 photo.
            (4160, 2080),
            (8000, 4001),
            (6000, 4000),
            (None, None),
            ("6000", "3000"),
            (True, True),
        ):
            with self.subTest(width=width, height=height):
                self.assertIsNone(
                    projection_type_of(values(width=width, height=height), False)
                )

    def test_a_blank_projection_falls_back_to_the_shape(self) -> None:
        self.assertEqual(
            EQUIRECTANGULAR,
            projection_type_of(
                values(projection_type=" ", width=8000, height=4000), False
            ),
        )


class ProjectionTypeApiTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.sphere = create_test_photo(
            owner=self.user, projection_type=EQUIRECTANGULAR
        )

    def test_details_say_it_is_a_sphere(self) -> None:
        response = self.client.get(f"/api/photos/{self.sphere.id}/")

        self.assertEqual(200, response.status_code)
        self.assertEqual(EQUIRECTANGULAR, response.json()["projection_type"])

    def test_a_flat_photo_has_none(self) -> None:
        flat = create_test_photo(owner=self.user)

        response = self.client.get(f"/api/photos/{flat.id}/")

        self.assertIsNone(response.json()["projection_type"])

    def test_the_projection_cannot_be_written(self) -> None:
        response = self.client.patch(
            f"/api/photos/{self.sphere.id}/",
            {"projection_type": None},
            format="json",
        )

        self.assertEqual(200, response.status_code)
        self.sphere.refresh_from_db()
        self.assertEqual(EQUIRECTANGULAR, self.sphere.projection_type)

    def test_event_album_photos_carry_it(self) -> None:
        album = create_test_album_auto(owner=self.user)
        album.photos.add(self.sphere)

        response = self.client.get(f"/api/albums/auto/{album.id}/")

        self.assertEqual(200, response.status_code)
        (photo,) = response.json()["photos"]
        self.assertEqual(EQUIRECTANGULAR, photo["projection_type"])
