"""A library share hands over the photos and nothing else (#2731).

The cross-tenant suites run again with the victim sharing their whole
library with the attacker:

* reads (``CrossTenantReadTest``), every switch off: the victim's photo ids
  and hashes may now appear, since those photos are shared; their people,
  camera, places, albums, tags, stacks, duplicates and jobs still must not,
  on any endpoint, plus the library endpoints themselves;
* writes (``CrossTenantWriteTest``), every switch on and the library in the
  attacker's timeline: no write endpoint changes a victim row;
* anonymous callers get nothing more than before.
"""

# The modules, not the classes: a class imported here would run here twice.
from api.tests.sharing_and_public import test_cross_tenant_reads as reads
from api.tests.sharing_and_public import test_cross_tenant_writes as writes
from api.tests.utils import create_test_library_share


class LibraryRecipientReadTest(reads.CrossTenantReadTest):
    def setUp(self):
        super().setUp()
        self.share = create_test_library_share(
            owner=self.victim, recipient=self.attacker, show_in_timeline=True
        )
        self.photo_markers = {
            *(str(p.pk) for p in self.v_photos),
            *(p.image_hash for p in self.v_photos),
        }

    def cases(self):
        v = self
        victim = v.victim.pk
        return [
            *super().cases(),
            ("/api/library-shares/", None),
            (f"/api/albums/date/list/?library={victim}", None),
            (f"/api/albums/date/{v.v_date.pk}/?library={victim}", None),
            ("/api/albums/date/list/?libraries=true", None),
            (f"/api/albums/date/{v.v_date.pk}/?libraries=true", None),
            (f"/api/albums/date/list/?libraries=true&person={v.v_person.pk}", None),
            (f"/api/albums/date/list/?library={victim}&search=VictimFriendName", None),
            (f"/api/photos/{v.v_photo.pk}/", None),
            (f"/api/photos/{v.v_photo2.pk}/", None),
            (f"/api/photos/{v.v_photo.pk}/summary/", None),
            (f"/api/photos/{v.v_photo.pk}/albums/", None),
            ("/api/photos/searchlist/?search=VictimFriendName", None),
            ("/api/photos/searchlist/?search=VictimCameraModel", None),
            ("/api/photos/searchlist/?search=VictimPlaceTitle", None),
            ("/api/photos/searchlist/?search=victim-tag-name", None),
            ("/api/photos/searchlist/?search=victimthingtitle", None),
        ]

    def test_another_user_sees_none_of_the_victims_rows(self):
        """The attacker is the recipient: the photos show, nothing else."""
        client = self.client_for(self.attacker)
        markers = self.victim_markers - self.photo_markers
        for url, _ in self.cases():
            with self.subTest(url=url):
                response = client.get(url)
                self.assertLess(response.status_code, 500, url)
                body = response.content.decode("utf-8", "replace")
                leaked = sorted(m for m in markers if m in body and m not in url)
                self.assertEqual(leaked, [], f"{response.status_code}: {body[:300]}")

    def test_the_recipient_does_reach_the_photos(self):
        client = self.client_for(self.attacker)
        for url in (
            f"/api/photos/{self.v_photo.pk}/",
            f"/api/albums/date/{self.v_date.pk}/?library={self.victim.pk}",
        ):
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn(self.v_photo.image_hash, response.content.decode())

    def test_a_revoked_share_reaches_nothing(self):
        self.share.delete()
        super().test_another_user_sees_none_of_the_victims_rows()

    # The owner-side checks are CrossTenantReadTest's; they do not change.
    test_the_owner_sees_their_own_rows = None
    test_the_owners_counts_include_their_rows = None


class LibraryRecipientWriteTest(writes.CrossTenantWriteTest):
    def setUp(self):
        super().setUp()
        create_test_library_share(
            owner=self.victim,
            recipient=self.attacker,
            show_in_timeline=True,
            share_location=True,
            share_faces=True,
            share_camera_info=True,
            share_captions=True,
            share_originals=True,
        )

    # Route coverage is CrossTenantWriteTest's; only the writes run again.
    test_every_mutating_api_route_is_covered_or_exempted = None
    test_every_exemption_names_a_live_route = None
    test_the_fixture_actually_gives_the_victim_every_kind_of_row = None
