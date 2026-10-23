"""A public gallery (#434) with owners of every kind, for its tests.

* Anna takes part and shares everything: two photos on 16 August 2025 in
  Munich, with coordinates, an address, a camera and a person she named Mia.
* Ben takes part with every switch off: a photo in Lisbon on the same day,
  with coordinates, and a person he also named Mia.
* Cleo has public photos but does not take part.
* Every one of Anna's photos the gallery must not show: private, hidden,
  archived, in the trash, a stack's second photo, a cluster's face.
"""

from __future__ import annotations

import datetime

from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo, PhotoStack, User
from api.models.user import get_default_public_sharing_settings
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_user,
    create_test_user_place,
)

TAKEN = datetime.datetime(2025, 8, 16, 18, 42, tzinfo=datetime.UTC)
DAY_ID = 20250816
UNDATED_DAY_ID = 1
MUNICH = {"places": ["Marienplatz", "Munich", "Germany"]}
LISBON = {"places": ["Alfama", "Lisbon", "Portugal"]}
STREET = "Marienplatz 1, 80331 Munich, Germany"
SECRET_PATH = "/data/photos/anna/secret-folder/IMG_0001.jpg"
ALL_ON = dict.fromkeys(get_default_public_sharing_settings(), True)
ALL_OFF = get_default_public_sharing_settings()


def gallery(stage: str = "everyone", indexable: bool = False) -> override_config:
    """The admin's gallery setting for a test."""
    return override_config(PUBLIC_GALLERY=stage, PUBLIC_GALLERY_INDEXABLE=indexable)


class GalleryFixture(TestCase):
    def setUp(self) -> None:
        self.anna = create_test_user(
            in_public_gallery=True, public_sharing_defaults=ALL_ON
        )
        self.ben = create_test_user(
            in_public_gallery=True, public_sharing_defaults=ALL_OFF
        )
        self.cleo = create_test_user(public_sharing=True)
        self.stranger = create_test_user()
        self.admin = create_test_user(is_admin=True)

        self.anna_1 = self.public_photo(self.anna, MUNICH, camera="X-T5")
        self.anna_2 = self.public_photo(
            self.anna, MUNICH, exif_timestamp=TAKEN + datetime.timedelta(hours=1)
        )
        self.ben_1 = self.public_photo(self.ben, LISBON)
        self.cleo_1 = self.public_photo(self.cleo, MUNICH)
        self.hidden_away = [
            self.public_photo(self.anna, MUNICH, public=False),
            self.public_photo(self.anna, MUNICH, hidden=True),
            self.public_photo(self.anna, MUNICH, archived=True),
            self.public_photo(self.anna, MUNICH, in_trashcan=True),
            self.second_in_stack(),
        ]
        self.anna_mia = create_test_person(name="Mia", cluster_owner=self.anna)
        self.ben_mia = create_test_person(name="Mia", cluster_owner=self.ben)
        create_test_face(photo=self.anna_1, person=self.anna_mia)
        create_test_face(photo=self.ben_1, person=self.ben_mia)
        self.cluster = create_test_person(
            name="Unknown 012", kind="CLUSTER", cluster_owner=self.anna
        )
        create_test_face(photo=self.anna_2, person=self.cluster)
        # A place Anna named: private, never in any public answer.
        create_test_user_place(self.anna, "Anna's Home")

        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(self.stranger)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(self.admin)

    def public_photo(
        self, owner: User, place: dict[str, list[str]], **fields: object
    ) -> Photo:
        fields.setdefault("exif_timestamp", TAKEN)
        fields.setdefault("public", True)
        return create_test_photo(
            owner=owner,
            geolocation_json=place,
            exif_gps_lat=48.137,
            exif_gps_lon=11.575,
            search_location=STREET,
            search_captions=SECRET_PATH,
            **fields,
        )

    def second_in_stack(self) -> Photo:
        primary = self.public_photo(self.anna, MUNICH)
        second = self.public_photo(self.anna, MUNICH)
        stack = create_test_stack(
            owner=self.anna,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=primary,
        )
        stack.photos.add(primary, second)
        # The primary is a gallery photo too: count it with Anna's.
        self.anna_primary = primary
        return second

    def switches(self, owner: User, **switches: bool) -> None:
        settings = get_default_public_sharing_settings()
        settings.update({f"share_{name}": on for name, on in switches.items()})
        owner.public_sharing_defaults = settings
        owner.save()

    def readers(self) -> dict[str, APIClient]:
        return {"anonymous": self.anonymous, "signed in": self.signed_in}

    def get(self, client: APIClient, url: str, **params: object) -> dict:
        response = client.get(url, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def ids(self, payload: dict) -> set[str]:
        return {photo["id"] for photo in payload["results"]}

    def day_photo_ids(self, client: APIClient, day: int, **params: object) -> set[str]:
        return self.ids(self.get(client, "/api/gallery/photos/", day=day, **params))
