"""Views that start jobs, edit photos and faces, and serve settings answer
what openapi.json declares.

The job triggers (``api/views/scan_triggers.py``, the face scan and training,
the Nextcloud scan), the photo edits (``api/views/photos.py``), the face
delete, the user setup views (``api/views/user.py``) and the Nextcloud folder
list build their answers as dicts, and their response serializers only
describe them. Each test calls a view through every branch of its answer and
validates the body against the committed schema
(``api/tests/openapi_responses.py``). Issue #485.
"""

import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest import mock
from unittest.mock import patch

from constance.test import override_config
from django.test import override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob, Photo, User
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.openapi_responses import SCHEMA_FILE
from api.tests.utils import (
    create_test_face,
    create_test_file,
    create_test_person,
    create_test_photo,
    create_test_user,
    patch_nextcloud_dns,
)


@contextmanager
def queue_stub() -> Iterator[None]:
    """Jobs start without a queue or ML models (the rows are written, nothing runs)."""
    with (
        patch("api.jobs.queue.AsyncTask"),
        patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
    ):
        yield


class JobStartResponsesTest(DeclaredResponseTestCase):
    """Every view that starts a job answers ``JobStartedResponse``."""

    JOB_VIEWS = (
        ("/api/scanphotos/", "post"),
        ("/api/scanphotos/", "get"),
        ("/api/fullscanphotos/", "post"),
        ("/api/fullscanphotos/", "get"),
        ("/api/scanuploadedphotos/", "post"),
        ("/api/deletemissingphotos/", "post"),
        ("/api/deletemissingphotos/", "get"),
        ("/api/classifymedia/", "post"),
        ("/api/generateocr/", "post"),
        ("/api/scanfaces/", "post"),
        ("/api/scanfaces/", "get"),
        ("/api/trainfaces/", "post"),
    )

    def setUp(self) -> None:
        self.scan_directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scan_directory, True)
        self.user = create_test_user(scan_directory=self.scan_directory)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def start(self, path: str, method: str, url: str | None = None) -> Any:
        data = {} if method == "post" else None
        with queue_stub():
            body = self.assert_declared(path, url or path, method=method, data=data)
        # Finished, so the next start of its kind is not refused as a duplicate.
        LongRunningJob.objects.update(finished=True)
        return body

    def test_every_job_trigger(self) -> None:
        for path, method in self.JOB_VIEWS:
            with self.subTest(path=path, method=method):
                body = self.start(path, method)
                self.assertEqual(body["job_ids"][-1], body["job_id"])
        trained = self.start("/api/trainfaces/", "post")
        self.assertEqual(2, len(trained["job_ids"]))

    def test_the_caption_job_says_whether_it_waits_for_the_model(self) -> None:
        path = "/api/generate-captions/"
        for missing in (False, True):
            with (
                self.subTest(model_missing=missing),
                patch(
                    "api.runtime.ml_models.captioning_model_exists",
                    return_value=not missing,
                ),
            ):
                body = self.start(path, "post")
                self.assertEqual(missing, body["downloads_model"])

    def test_the_rescans_of_chosen_photos_and_files(self) -> None:
        path = os.path.join(self.scan_directory, "a.jpg")
        file = create_test_file(path, self.user, b"rescan me")
        photo = create_test_photo(owner=self.user, main_file=file)
        data = {"photo_ids": [str(photo.pk)]}
        with queue_stub():
            body = self.assert_declared(
                "/api/photos/rescan/", "/api/photos/rescan/", method="post", data=data
            )
        self.assertEqual(1, body["file_count"])
        LongRunningJob.objects.update(finished=True)
        data = {"paths": [path, "/elsewhere.jpg"]}
        with queue_stub():
            body = self.assert_declared(
                "/api/scan-files/", "/api/scan-files/", method="post", data=data
            )
        self.assertEqual(["/elsewhere.jpg"], body["ignored_paths"])

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_the_nextcloud_scan(self) -> None:
        self.user.nextcloud_server_address = "https://cloud.example.com"
        self.user.save()
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        with patch("nextcloud.views.certificate_check"):
            for method in ("post", "get"):
                with self.subTest(method=method):
                    self.start("/api/nextcloud/scanphotos/", method)


class PhotoEditResponsesTest(DeclaredResponseTestCase):
    """The photo edits in ``api/views/photos.py``."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.other = create_test_photo(owner=self.user)

    def test_bulk_flag_edits_by_hash_and_by_query(self) -> None:
        path = "/api/photosedit/favorite/"
        hashes = self.assert_declared(
            path,
            path,
            method="post",
            data={"image_hashes": [self.photo.image_hash], "favorite": True},
        )
        query = self.assert_declared(
            path, path, method="post", data={"select_all": True, "favorite": False}
        )
        self.assertEqual([self.photo.image_hash], hashes["updated_hashes"])
        self.assertNotIn("updated_hashes", query)

    def test_share_and_unshare(self) -> None:
        path = "/api/photosedit/share/"
        friend = create_test_user()
        for shared in (True, False):
            with self.subTest(shared=shared):
                body = self.assert_declared(
                    path,
                    path,
                    method="post",
                    data={
                        "image_hashes": [self.photo.image_hash],
                        "val_shared": shared,
                        "target_user_id": friend.id,
                    },
                )
                self.assertEqual(1, body["count"])

    def test_generate_and_save_a_caption(self) -> None:
        with (
            patch("api.views.photos.feature_enabled", return_value=True),
            patch("api.views.photos.captioning_model_selected", return_value=True),
            patch("api.views.photos.captioning_model_exists", return_value=True),
            patch(
                "api.views.photos.captioning.generate_photo_caption",
                return_value=True,
            ),
        ):
            self.assert_declared(
                "/api/photosedit/generateim2txt/",
                "/api/photosedit/generateim2txt/",
                method="post",
                data={"image_hash": self.photo.image_hash},
            )
        self.assert_declared(
            "/api/photosedit/savecaption/",
            "/api/photosedit/savecaption/",
            method="post",
            data={"image_hash": self.photo.image_hash, "caption": "A dog"},
        )

    def test_delete_by_hash_and_by_query(self) -> None:
        path = "/api/photosedit/delete/"
        Photo.objects.filter(pk__in=[self.photo.pk, self.other.pk]).update(
            in_trashcan=True
        )
        hashes = self.assert_declared(
            path,
            path,
            method="delete",
            data={"image_hashes": [self.photo.image_hash, "0" * 32]},
        )
        query = self.assert_declared(
            path, path, method="delete", data={"select_all": True}
        )
        self.assertEqual(["0" * 32], hashes["not_deleted"])
        self.assertEqual((1, 0), (query["count"], query["failed_count"]))

    def test_set_the_main_file_and_download_a_variant(self) -> None:
        variant = create_test_file(None, self.user, on_disk=True)
        self.photo.files.add(variant)
        main_file = f"/api/photos/{self.photo.image_hash}/main-file/"
        self.assert_declared(
            "/api/photos/{image_hash}/main-file/",
            main_file,
            method="post",
            data={"file_hash": variant.hash},
        )

        response = self.client.get(
            f"/api/photos/{self.photo.image_hash}/file/{variant.hash}/"
        )
        self.assertEqual(200, response.status_code)
        self.assertIn("attachment", response["Content-Disposition"])
        # A file of any type, not a JSON body.
        with open(SCHEMA_FILE, encoding="utf-8") as schema_file:
            paths = json.load(schema_file)["paths"]
        download = paths["/api/photos/{image_hash}/file/{file_hash}/"]["get"]
        self.assertEqual(["*/*"], list(download["responses"]["200"]["content"]))

    def test_write_metadata_preview_and_start(self) -> None:
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        self.user.refresh_from_db()
        Photo.objects.filter(pk=self.photo.pk).update(rating=4)

        preview = self.assert_declared("/api/savemetadata/", "/api/savemetadata/")
        with queue_stub():
            started = self.assert_declared(
                "/api/savemetadata/",
                "/api/savemetadata/",
                status=202,
                method="post",
                data={"types": ["ratings"]},
            )
        self.assertEqual(1, preview["total"])
        self.assertEqual(["ratings"], started["types"])


class FaceDeleteResponseTest(DeclaredResponseTestCase):
    def test_delete_faces(self) -> None:
        user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        photo = create_test_photo(owner=user)
        person = create_test_person(cluster_owner=user)
        faces = [create_test_face(photo=photo, person=person), create_test_face(photo)]
        body = self.assert_declared(
            "/api/deletefaces/",
            "/api/deletefaces/",
            method="post",
            data={"face_ids": [face.id for face in faces]},
        )
        self.assertEqual(2, len(body["deleted"]))

    def test_restore_faces(self) -> None:
        user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        person = create_test_person(cluster_owner=user)
        face = create_test_face(
            photo=create_test_photo(owner=user), person=person, deleted=True
        )
        body = self.assert_declared(
            "/api/restore-faces/",
            "/api/restore-faces/",
            method="post",
            data={"face_ids": [face.id]},
        )
        self.assertEqual([face.id], body["restored_ids"])

    def test_restore_face_labels(self) -> None:
        user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        person = create_test_person(cluster_owner=user)
        face = create_test_face(photo=create_test_photo(owner=user))
        labels = {
            "id": face.id,
            "person": person.id,
            "cluster_person": None,
            "classification_person": None,
        }
        body = self.assert_declared(
            "/api/restore-face-labels/",
            "/api/restore-face-labels/",
            method="post",
            data={"faces": [labels]},
        )
        self.assertEqual([face.id], body["restored_ids"])


class UserSetupResponsesTest(DeclaredResponseTestCase):
    """The setup views of ``api/views/user.py`` and the Nextcloud folder list."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_first_time_setup_before_and_after_the_admin(self) -> None:
        path = "/api/firsttimesetup/"
        self.assertTrue(self.assert_declared(path, path)["isFirstTimeSetup"])
        create_test_user(is_admin=True)
        self.assertFalse(self.assert_declared(path, path)["isFirstTimeSetup"])

    def test_the_rule_lists(self) -> None:
        self.client.force_authenticate(user=create_test_user())
        for path in (
            "/api/defaultrules/",
            "/api/predefinedrules/",
            "/api/defaultburstrules/",
            "/api/predefinedburstrules/",
        ):
            with self.subTest(path=path):
                rules = json.loads(self.assert_declared(path, path))
                self.assertTrue(rules)

    def test_the_directory_tree(self) -> None:
        root = tempfile.mkdtemp(prefix="librephotos-dirtree-")
        self.addCleanup(shutil.rmtree, root, True)
        os.makedirs(os.path.join(root, "a", "b", "c"))
        os.makedirs(os.path.join(root, "d"))
        self.client.force_authenticate(user=create_test_user(is_admin=True))
        with override_settings(DATA_ROOT=root):
            tree = self.assert_declared("/api/dirtree/", "/api/dirtree/")
        self.assertEqual(["a", "d"], [child["title"] for child in tree[0]["children"]])

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_the_nextcloud_folders(self) -> None:
        user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
        )
        self.client.force_authenticate(user=user)
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        folder = mock.MagicMock(path="/Photos/")
        folder.is_dir.return_value = True
        client = mock.MagicMock()
        client.list.return_value = [folder]
        path = "/api/nextcloud/listdir/"
        with patch("nextcloud.server_address.GuardedClient", return_value=client):
            listed = self.assert_declared(path, f"{path}?fpath=/")
        self.assertEqual("Photos", listed[0]["title"])
        self.assertEqual([], self.assert_declared(path, path))
