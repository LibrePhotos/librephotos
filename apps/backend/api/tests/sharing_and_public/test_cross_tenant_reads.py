"""No read endpoint shows one user's private rows to another; shares still show.

The read-side companion of test_cross_tenant_writes.py, written to pin the
behaviour of every view that scopes rows to their owner before those views
moved from inline ``owner=`` filters to the manager scopes in
``api/models/scopes.py`` (issue #2343). Three properties:

* signed in as someone else, no list or detail endpoint carries a marker of
  the victim's private photos, albums, people, tags, stacks, duplicate groups
  or jobs, even when asked for them by id;
* the owner does see each of those markers, so a scope cannot have narrowed
  to nothing;
* rows shared to a user (an album, a photo, an auto/thing/place album) and
  public album links still reach the people they are meant for.
"""

import datetime
import json
import os
import shutil
import tempfile
from unittest.mock import patch
from urllib.parse import urlencode

import pyvips
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.directory_watcher.file_handlers import (
    create_file_record,
    group_files_into_photo,
)
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_collection,
    create_test_album_date,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_duplicate,
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_person_group,
    create_test_photo,
    create_test_stack,
    create_test_tag,
    create_test_user,
)

THING_TYPE = "openclip_vitb32_tag"


class CrossTenantReadTest(TestCase):
    def setUp(self):
        self.victim = create_test_user()
        self.attacker = create_test_user()

        year_ago = timezone.now() - datetime.timedelta(days=365)
        self.v_photo = create_test_photo(
            owner=self.victim,
            public=False,
            exif_timestamp=year_ago,
            camera="VictimCameraModel",
        )
        self.v_photo2 = create_test_photo(
            owner=self.victim,
            public=False,
            exif_timestamp=year_ago,
            exif_gps_lat=41.1,
            exif_gps_lon=-8.6,
        )
        self.year_ago = year_ago
        self.v_photos = [self.v_photo, self.v_photo2]

        self.v_person = create_test_person(
            name="VictimFriendName", cluster_owner=self.victim
        )
        self.v_face = create_test_face(photo=self.v_photo, person=self.v_person)
        create_test_face(photo=self.v_photo2, person=self.v_person)
        # Unlabelled: listed by the clustering view of /api/faces/.
        create_test_face(photo=self.v_photo2)
        self.v_group = create_test_person_group(
            name="VictimGroupName", owner=self.victim, persons=[self.v_person]
        )
        self.v_tag = create_test_tag(name="victim-tag-name", owner=self.victim)
        self.v_tag.photos.add(*self.v_photos)

        self.v_album = create_test_album_user(
            title="VictimTripTitle", owner=self.victim
        )
        self.v_album.photos.add(*self.v_photos)
        self.v_collection = create_test_album_collection(
            name="VictimCollectionName", owner=self.victim, albums=[self.v_album]
        )
        self.v_auto = create_test_album_auto(
            title="VictimEventTitle", owner=self.victim, timestamp=year_ago
        )
        self.v_auto.photos.add(*self.v_photos)
        self.v_thing = create_test_album_thing(
            title="victimthingtitle", thing_type=THING_TYPE, owner=self.victim
        )
        self.v_thing.photos.add(*self.v_photos)
        self.v_thing.cover_photos.add(self.v_photo)
        self.v_place = create_test_album_place(
            title="VictimPlaceTitle", geolocation_level=1, owner=self.victim
        )
        self.v_place.photos.add(*self.v_photos)
        self.v_date = create_test_album_date(date=year_ago.date(), owner=self.victim)
        self.v_date.photos.add(*self.v_photos)

        self.v_stack = create_test_stack(
            owner=self.victim, stack_type="manual", primary_photo=self.v_photo
        )
        self.v_stack.photos.add(*self.v_photos)
        self.v_dup = create_test_duplicate(owner=self.victim)
        self.v_dup.photos.add(*self.v_photos)
        self.v_job = create_test_job(started_by=self.victim)

        # The attacker's own library, so each list has something to return.
        self.a_photo = create_test_photo(owner=self.attacker)
        create_test_tag(name="attacker-tag", owner=self.attacker)
        create_test_album_user(title="AttackerAlbum", owner=self.attacker)

        self.victim_markers = {
            *(str(p.pk) for p in self.v_photos),
            *(p.image_hash for p in self.v_photos),
            "VictimFriendName",
            "VictimGroupName",
            "VictimCameraModel",
            "victim-tag-name",
            "VictimTripTitle",
            "VictimCollectionName",
            "VictimEventTitle",
            "victimthingtitle",
            "VictimPlaceTitle",
            str(self.v_stack.pk),
            str(self.v_dup.pk),
            self.v_job.job_id,
        }

    def client_for(self, user):
        client = APIClient()
        client.raise_request_exception = True
        if user is not None:
            client.force_authenticate(user=user)
        return client

    def cases(self):
        """(url, a marker the owner's own response must carry, or None)."""
        v = self
        return [
            ("/api/albums/user/list/", "VictimTripTitle"),
            (f"/api/albums/user/{v.v_album.pk}/", "VictimTripTitle"),
            ("/api/albums/collections/", "VictimCollectionName"),
            (
                f"/api/albums/user/list/?collection={v.v_collection.pk}",
                "VictimTripTitle",
            ),
            ("/api/albums/user/shared/fromme/", None),
            ("/api/albums/user/shared/tome/", None),
            ("/api/albums/auto/list/", "VictimEventTitle"),
            (f"/api/albums/auto/{v.v_auto.pk}/", "VictimEventTitle"),
            ("/api/albums/thing/list/", "victimthingtitle"),
            (f"/api/albums/thing/{v.v_thing.pk}/", "victimthingtitle"),
            ("/api/albums/place/list/", "VictimPlaceTitle"),
            (f"/api/albums/place/{v.v_place.pk}/", "VictimPlaceTitle"),
            ("/api/albums/date/list/", str(v.v_date.pk)),
            (f"/api/albums/date/{v.v_date.pk}/", v.v_photo.image_hash),
            (
                f"/api/albums/date/list/?last_modified={_ago()}",
                str(v.v_date.pk),
            ),
            (
                f"/api/albums/date/{v.v_date.pk}/?last_modified={_ago()}",
                v.v_photo.image_hash,
            ),
            (
                f"/api/albums/date/list/?public=true&username={v.victim.username}",
                None,
            ),
            ("/api/persons/", "VictimFriendName"),
            (f"/api/persons/{v.v_person.pk}/", "VictimFriendName"),
            ("/api/person-groups/", "VictimGroupName"),
            (f"/api/persons/?group={v.v_group.pk}", "VictimFriendName"),
            (f"/api/faces/incomplete/?group={v.v_group.pk}", "VictimFriendName"),
            (
                f"/api/faces/?person={v.v_person.pk}&inferred=false",
                v.v_photo.image_hash,
            ),
            ("/api/faces/", v.v_photo2.image_hash),
            ("/api/faces/incomplete/", "VictimFriendName"),
            (
                "/api/faces/incomplete/?inferred=true&analysis_method=classification",
                None,
            ),
            (
                "/api/faces/incomplete/?inferred=true&analysis_method=clustering",
                None,
            ),
            ("/api/photos/shared/tome/", None),
            ("/api/photos/shared/fromme/", None),
            ("/api/photos/nolocation/", v.v_photo.image_hash),
            ("/api/search/metadata-values/?field=camera", "VictimCameraModel"),
            (
                f"/api/photos/searchlist/?person={v.v_person.pk}",
                v.v_photo.image_hash,
            ),
            (
                "/api/photos/located-nearby-in-time/?"
                + urlencode(
                    {
                        "from": (v.year_ago - datetime.timedelta(days=1)).isoformat(),
                        "to": (v.year_ago + datetime.timedelta(days=1)).isoformat(),
                    }
                ),
                v.v_photo2.image_hash,
            ),
            # The victim's photos are all in their album, so the owner sees none.
            ("/api/photos/no-album/", None),
            # The victim's photos are private: the owner's public list is empty.
            ("/api/photos/public/", None),
            # The folders a move can go to: the requester's own library (#352).
            ("/api/photos/move/folders/", None),
            (f"/api/photos/{v.v_photo.pk}/albums/", "VictimTripTitle"),
            # The file is not on disk here, so the owner's read is a 404 too;
            # api/tests/metadata/test_raw_metadata.py reads real files.
            (f"/api/photos/{v.v_photo.pk}/metadata/raw/", None),
            ("/api/tags/", "victim-tag-name"),
            (f"/api/tags/{v.v_tag.pk}/", "victim-tag-name"),
            ("/api/stacks/", str(v.v_stack.pk)),
            (f"/api/stacks/{v.v_stack.pk}/", str(v.v_stack.pk)),
            ("/api/stacks/stats/", None),
            ("/api/duplicates/", str(v.v_dup.pk)),
            (f"/api/duplicates/{v.v_dup.pk}/", str(v.v_dup.pk)),
            ("/api/duplicates/stats/", None),
            ("/api/jobs/", v.v_job.job_id),
            (f"/api/jobs/{v.v_job.pk}/", v.v_job.job_id),
            (f"/api/photos/download?job_id={v.v_job.job_id}", None),
            ("/api/memories/?fallback=true&window=30", v.v_photo.image_hash),
            ("/api/sync/photos/", str(v.v_photo.pk)),
            ("/api/sync/persons/", "VictimFriendName"),
            ("/api/sync/albums/user/", "VictimTripTitle"),
            ("/api/sync/albums/auto/", "VictimEventTitle"),
            ("/api/sync/albums/thing/", "victimthingtitle"),
            ("/api/sync/albums/place/", "VictimPlaceTitle"),
            ("/api/sync/albums/tag/", "victim-tag-name"),
            ("/api/sync/sharing/", None),
            ("/api/sync/counts/", None),
        ]

    def test_another_user_sees_none_of_the_victims_rows(self):
        client = self.client_for(self.attacker)
        for url, _ in self.cases():
            with self.subTest(url=url):
                response = client.get(url)
                self.assertLess(response.status_code, 500, url)
                body = response.content.decode("utf-8", "replace")
                # Echoing an id from the URL back is not a leak.
                leaked = sorted(
                    m for m in self.victim_markers if m in body and m not in url
                )
                self.assertEqual(leaked, [], f"{response.status_code}: {body[:300]}")

    def test_the_owner_sees_their_own_rows(self):
        client = self.client_for(self.victim)
        for url, marker in self.cases():
            if marker is None:
                continue
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200, response.content[:300])
                self.assertIn(marker, response.content.decode())

    def test_the_owners_counts_include_their_rows(self):
        counts = self.client_for(self.victim).get("/api/sync/counts/").json()
        self.assertEqual(counts["photos"], 2)
        self.assertEqual(counts["persons"], 1)
        self.assertEqual(counts["user_albums"], 1)
        self.assertEqual(counts["auto_albums"], 1)
        self.assertEqual(counts["thing_albums"], 1)
        self.assertEqual(counts["place_albums"], 1)
        self.assertEqual(counts["tags"], 1)
        stats = self.client_for(self.victim).get("/api/duplicates/stats/").json()
        self.assertEqual(stats["total_duplicates"], 1)

    def test_an_anonymous_caller_sees_none_of_the_victims_rows(self):
        client = self.client_for(None)
        for url, _ in self.cases():
            with self.subTest(url=url):
                response = client.get(url)
                self.assertLess(response.status_code, 500, url)
                body = response.content.decode("utf-8", "replace")
                leaked = sorted(
                    m for m in self.victim_markers if m in body and m not in url
                )
                self.assertEqual(leaked, [], f"{response.status_code}: {body[:300]}")


def _ago() -> str:
    return (
        (timezone.now() - datetime.timedelta(days=400)).isoformat().replace("+", "%2B")
    )


class SharedReadTest(TestCase):
    """What a share hands to its recipient, read through each scoped view."""

    def setUp(self):
        self.sharer = create_test_user()
        self.recipient = create_test_user()
        self.stranger = create_test_user()

        self.photo = create_test_photo(owner=self.sharer, public=False)
        self.photo.shared_to.add(self.recipient)
        self.album_photo = create_test_photo(owner=self.sharer, public=False)
        self.album = create_test_album_user(title="SharedTripTitle", owner=self.sharer)
        self.album.photos.add(self.album_photo)
        self.album.shared_to.add(self.recipient)
        self.auto = create_test_album_auto(title="SharedEventTitle", owner=self.sharer)
        self.auto.shared_to.add(self.recipient)
        self.thing = create_test_album_thing(
            title="sharedthingtitle", thing_type=THING_TYPE, owner=self.sharer
        )
        self.thing.shared_to.add(self.recipient)
        self.place = create_test_album_place(
            title="SharedPlaceTitle", geolocation_level=1, owner=self.sharer
        )
        self.place.shared_to.add(self.recipient)

    def get(self, user, url):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        response = client.get(url)
        return response.status_code, response.content.decode()

    def test_the_recipient_reads_what_was_shared(self):
        for url, marker in [
            ("/api/albums/user/shared/tome/", "SharedTripTitle"),
            (f"/api/albums/user/{self.album.pk}/", "SharedTripTitle"),
            ("/api/photos/shared/tome/", self.photo.image_hash),
            (f"/api/photos/{self.album_photo.pk}/albums/", "SharedTripTitle"),
            ("/api/sync/photos/", str(self.photo.pk)),
            ("/api/sync/albums/user/", "SharedTripTitle"),
            ("/api/sync/albums/auto/", "SharedEventTitle"),
            ("/api/sync/albums/thing/", "sharedthingtitle"),
            ("/api/sync/albums/place/", "SharedPlaceTitle"),
            ("/api/sync/sharing/", self.sharer.username),
        ]:
            with self.subTest(url=url):
                status, body = self.get(self.recipient, url)
                self.assertEqual(status, 200, body[:300])
                self.assertIn(marker, body)
                status, body = self.get(self.stranger, url)
                self.assertNotIn(marker, body)

    def test_the_recipients_counts_include_the_shares(self):
        _, body = self.get(self.recipient, "/api/sync/counts/")
        counts = json.loads(body)
        self.assertEqual(counts["photos"], 1)
        self.assertEqual(counts["user_albums"], 1)
        self.assertEqual(counts["auto_albums"], 1)
        self.assertEqual(counts["thing_albums"], 1)
        self.assertEqual(counts["place_albums"], 1)

    def test_the_sharer_sees_what_they_shared(self):
        for url, marker in [
            ("/api/albums/user/shared/fromme/", "SharedTripTitle"),
            ("/api/photos/shared/fromme/", self.photo.image_hash),
            ("/api/sync/sharing/", self.recipient.username),
        ]:
            with self.subTest(url=url):
                status, body = self.get(self.sharer, url)
                self.assertEqual(status, 200, body[:300])
                self.assertIn(marker, body)

    def test_a_share_does_not_hand_over_the_album_for_writing(self):
        client = APIClient()
        client.force_authenticate(user=self.recipient)
        response = client.patch(
            f"/api/albums/user/{self.album.pk}/", {"title": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        response = client.patch(
            f"/api/albums/user/edit/{self.album.pk}/", {"title": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_a_public_album_link_still_opens_anonymously(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        status, body = self.get(
            None,
            f"/api/albums/user/{self.album.pk}/?public=true"
            f"&username={self.sharer.username}",
        )
        self.assertEqual(status, 200, body[:300])
        self.assertIn("SharedTripTitle", body)


class SharedScanFolderMediaTest(TestCase):
    """Two users with the same folder in scan scope share its File rows, not
    their photos (#1957): each one's media hash resolves to their own row."""

    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        tmpdir = tempfile.mkdtemp(prefix="lp-1957-media-")
        self.addCleanup(shutil.rmtree, tmpdir, True)
        path = os.path.join(tmpdir, "family.png")
        pyvips.Image.black(23, 8).write_to_file(path)
        with patch(
            "api.directory_watcher.file_handlers.has_embedded_motion_video",
            return_value=False,
        ):
            self.alices, self.bobs = (
                group_files_into_photo(user, [create_file_record(user, path)], "j")
                for user in (self.alice, self.bob)
            )

    def get(self, user, url):
        # The media view reads the raw jwt cookie.
        client = APIClient()
        client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
        return client.get(url)

    def test_each_user_reaches_only_their_own_photo(self):
        self.assertNotEqual(self.alices.image_hash, self.bobs.image_hash)
        for user, own, other in (
            (self.alice, self.alices, self.bobs),
            (self.bob, self.bobs, self.alices),
        ):
            with self.subTest(user=user.pk):
                response = self.get(user, f"/media/thumbnails_big/{own.image_hash}")
                self.assertEqual(200, response.status_code)
                self.assertIn(own.image_hash, response["X-Accel-Redirect"])
                response = self.get(user, f"/media/thumbnails_big/{other.image_hash}")
                self.assertEqual(404, response.status_code)
