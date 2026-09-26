"""Per-user scoping of the zip download routes and of hash-keyed photo lookups.

* the zip job status route only answers for the requester's own jobs;
* the zip delete route only removes the requester's own archive, and only
  from inside ``MEDIA_ROOT/zip``;
* the upload ``exists`` check only looks at the requester's own photos;
* permanent delete acts on the requester's row when another user's row
  carries the same ``image_hash``;
* the photo summary and ``similar_photos`` only return what the requester may
  see.
"""

import os
import shutil
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.all_tasks import delete_zip_file
from api.models import Photo
from api.models.long_running_job import LongRunningJob
from api.serializers.photos import PhotoSerializer
from api.tests.utils import create_test_photo, create_test_user


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    # The zip routes historically read the ``jwt`` cookie; carry it too so the
    # tests exercise the same user whichever credential the view looks at.
    client.cookies["jwt"] = str(AccessToken.for_user(user))
    return client


class ZipJobStatusScopeTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.other = create_test_user()
        self.job = LongRunningJob.objects.create(
            started_by=self.owner,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_DOWNLOAD_PHOTOS,
        )

    def test_missing_job_id_is_a_bad_request(self):
        response = _client_for(self.owner).get("/api/photos/download")
        self.assertEqual(response.status_code, 400)

    def test_owner_reads_their_own_job(self):
        response = _client_for(self.owner).get(
            "/api/photos/download", {"job_id": self.job.job_id}
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["status"], "PENDING")

    def test_other_user_cannot_read_the_job(self):
        self.job.finished = True
        self.job.save()
        response = _client_for(self.other).get(
            "/api/photos/download", {"job_id": self.job.job_id}
        )
        self.assertEqual(response.status_code, 404)

    def test_unknown_job_is_not_found(self):
        response = _client_for(self.owner).get(
            "/api/photos/download", {"job_id": str(uuid.uuid4())}
        )
        self.assertEqual(response.status_code, 404)


class DeleteZipScopeTest(TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.media_root = os.path.join(self.tmp, "media")
        self.zip_dir = os.path.join(self.media_root, "zip")
        os.makedirs(self.zip_dir)
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = create_test_user()

    def _touch(self, path):
        with open(path, "wb") as fh:
            fh.write(b"zip")
        return path

    def test_owner_deletes_their_own_zip(self):
        file_uuid = str(uuid.uuid4())
        path = self._touch(os.path.join(self.zip_dir, f"{file_uuid}{self.user.id}.zip"))

        response = _client_for(self.user).delete(f"/api/delete/zip/{file_uuid}")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(path))

    def test_traversal_fname_is_rejected(self):
        # A file one level above MEDIA_ROOT that a traversing name would reach.
        target = self._touch(os.path.join(self.tmp, f"secret{self.user.id}.zip"))

        for fname in ("../../secret", "..%2F..%2Fsecret", "..\\..\\secret"):
            with self.subTest(fname=fname):
                response = _client_for(self.user).delete(f"/api/delete/zip/{fname}")
                self.assertEqual(response.status_code, 404)
                self.assertTrue(os.path.exists(target))

    def test_cannot_delete_another_users_zip_by_extending_the_name(self):
        # Filenames are ``<uuid><user id>.zip``. A requester whose id is a
        # suffix of the owner's id must not reach the owner's file by moving
        # the extra digits into ``fname``.
        attacker = create_test_user()
        victim_id_prefix = "9"
        victim_path = self._touch(
            os.path.join(
                self.zip_dir, f"{uuid.uuid4()}{victim_id_prefix}{attacker.id}.zip"
            )
        )
        victim_uuid = os.path.basename(victim_path)[:36]

        response = _client_for(attacker).delete(
            f"/api/delete/zip/{victim_uuid}{victim_id_prefix}"
        )

        self.assertEqual(response.status_code, 404)
        self.assertTrue(os.path.exists(victim_path))

    def test_delete_zip_file_refuses_paths_outside_the_zip_dir(self):
        target = self._touch(os.path.join(self.tmp, "outside.zip"))
        delete_zip_file(os.path.join("..", "..", "outside.zip"))
        self.assertTrue(os.path.exists(target))


class UploadExistsScopeTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()

    def test_own_hash_exists(self):
        photo = create_test_photo(owner=self.user)
        response = _client_for(self.user).get(f"/api/exists/{photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"exists": True})

    def test_other_users_hash_is_not_revealed(self):
        photo = create_test_photo(owner=self.other)
        response = _client_for(self.user).get(f"/api/exists/{photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"exists": False})


class DeletePhotosHashCollisionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()

    def test_deletes_own_photo_when_another_user_has_the_same_hash(self):
        own = create_test_photo(owner=self.user, in_trashcan=True)
        # Created second, so an unscoped hash -> row dict would keep this one.
        theirs = create_test_photo(owner=self.other, in_trashcan=True)
        Photo.objects.filter(pk=theirs.pk).update(image_hash=own.image_hash)

        response = _client_for(self.user).delete(
            "/api/photosedit/delete/",
            {"image_hashes": [own.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], [own.image_hash])
        own.refresh_from_db()
        theirs.refresh_from_db()
        self.assertTrue(own.removed)
        self.assertFalse(theirs.removed)
        self.assertIsNotNone(theirs.main_file_id)

    def test_foreign_and_unknown_hashes_are_reported_alike(self):
        theirs = create_test_photo(owner=self.other, in_trashcan=True)
        unknown = "0" * 32 + str(self.other.id)

        response = _client_for(self.user).delete(
            "/api/photosedit/delete/",
            {"image_hashes": [theirs.image_hash, unknown]},
            format="json",
        )

        self.assertEqual(response.json()["deleted"], [])
        self.assertEqual(response.json()["not_deleted"], [theirs.image_hash, unknown])
        theirs.refresh_from_db()
        self.assertFalse(theirs.removed)


class PhotoSummaryScopeTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.viewer = create_test_user()
        self.stranger = create_test_user()

    def test_owner_reads_summary_of_photo_shared_to_several_users(self):
        photo = create_test_photo(owner=self.owner)
        photo.shared_to.add(self.viewer, self.stranger)

        response = _client_for(self.owner).get(f"/api/photos/{photo.pk}/summary/")

        self.assertEqual(response.status_code, 200)

    def test_shared_viewer_reads_summary(self):
        photo = create_test_photo(owner=self.owner)
        photo.shared_to.add(self.viewer)

        response = _client_for(self.viewer).get(f"/api/photos/{photo.pk}/summary/")

        self.assertEqual(response.status_code, 200)

    def test_stranger_gets_404_for_private_photo(self):
        photo = create_test_photo(owner=self.owner)

        response = _client_for(self.stranger).get(f"/api/photos/{photo.pk}/summary/")

        self.assertEqual(response.status_code, 404)


class SimilarPhotosScopeTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.viewer = create_test_user()
        self.other = create_test_user()

    def _similar(self, photo, hashes, user=None):
        request = None
        if user is not None:
            request = type("Req", (), {"user": user})()
        with patch(
            "api.serializers.photos.search_similar_image",
            return_value={"result": hashes},
        ):
            serializer = PhotoSerializer(photo, context={"request": request})
            return {row["image_hash"] for row in serializer.get_similar_photos(photo)}

    def test_only_the_owners_photos_are_listed(self):
        photo = create_test_photo(owner=self.owner)
        mine = create_test_photo(owner=self.owner)
        foreign = create_test_photo(owner=self.other, public=True)

        similar = self._similar(
            photo, [mine.image_hash, foreign.image_hash], user=self.owner
        )

        self.assertEqual(similar, {mine.image_hash})

    def test_shared_viewer_only_sees_what_is_visible_to_them(self):
        photo = create_test_photo(owner=self.owner)
        photo.shared_to.add(self.viewer)
        private = create_test_photo(owner=self.owner)
        shared = create_test_photo(owner=self.owner)
        shared.shared_to.add(self.viewer)

        similar = self._similar(
            photo, [private.image_hash, shared.image_hash], user=self.viewer
        )

        self.assertEqual(similar, {shared.image_hash})

    def test_without_a_request_falls_back_to_the_owner(self):
        photo = create_test_photo(owner=self.owner)
        mine = create_test_photo(owner=self.owner)

        self.assertEqual(self._similar(photo, [mine.image_hash]), {mine.image_hash})
