"""Several library folders per user (#123).

The scan directory stays the main folder; an admin adds further folders
(``LibraryFolder``). Every "is this in the library" check accepts each of
them and nothing else, and no folder of one user overlaps a folder of
another (#2034) or of the same library.
"""

import os
import shutil
import tempfile

from django.test import TestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from api.accounts.directories import (
    MAX_LIBRARY_FOLDERS,
    normalize_library_folder,
    normalize_scan_directory,
)
from api.directory_watcher.content_check import FolderError, resolve_folder
from api.models import LibraryFolder
from api.photos.library_files import in_library, scannable_files
from api.photos.library_folders import add_library_folder, library_folder_entries
from api.photos.paths import library_of, library_roots
from api.tests.utils import (
    api_error,
    create_test_file,
    create_test_library_folder,
    create_test_photo,
    create_test_user,
)


class LibraryFoldersTestBase(TestCase):
    def setUp(self):
        self.root = os.path.normpath(tempfile.mkdtemp(prefix="lp-libfolders-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        settings_ctx = override_settings(DATA_ROOT=self.root)
        settings_ctx.enable()
        self.addCleanup(settings_ctx.disable)
        self.main = self.folder("anna", "photos")
        self.shared = self.folder("shared", "family")
        self.user = create_test_user(scan_directory=self.main)

    def folder(self, *parts):
        path = os.path.join(self.root, *parts)
        os.makedirs(path, exist_ok=True)
        return path

    def photo_at(self, owner, *parts):
        path = os.path.join(*parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(os.urandom(16))
        file = create_test_file(path, owner)
        photo = create_test_photo(owner=owner, main_file=file)
        photo.files.add(file)
        return photo


class LibraryRootsTest(LibraryFoldersTestBase):
    def test_the_further_folders_follow_the_scan_directory(self):
        create_test_library_folder(self.user, self.shared)
        self.assertEqual(library_roots(self.user), [self.main, self.shared])

    def test_an_upload_folder_inside_a_further_folder_is_no_extra_root(self):
        create_test_library_folder(self.user, self.shared)
        self.user.upload_directory = os.path.join(self.shared, "uploads")
        self.assertEqual(library_roots(self.user), [self.main, self.shared])

    def test_an_upload_folder_outside_every_folder_comes_last(self):
        create_test_library_folder(self.user, self.shared)
        uploads = self.folder("uploads")
        self.user.upload_directory = uploads
        self.assertEqual(library_roots(self.user), [self.main, self.shared, uploads])

    def test_another_users_folders_are_not_in_the_library(self):
        other = create_test_user(scan_directory=self.folder("ben"))
        create_test_library_folder(other, self.shared)
        self.assertEqual(library_roots(self.user), [self.main])

    def test_a_user_without_a_scan_directory_has_no_library(self):
        user = create_test_user(scan_directory="")
        self.assertEqual(library_roots(user), [])
        self.assertFalse(in_library(user, self.main))

    def test_an_unsaved_user_has_no_further_folders(self):
        user = create_test_user(scan_directory=self.main)
        user.pk = None
        self.assertEqual(library_roots(user), [self.main])

    def test_every_check_accepts_any_folder_and_nothing_else(self):
        create_test_library_folder(self.user, self.shared)
        library = library_of(self.user)
        inside = os.path.join(self.shared, "2024", "a.jpg")
        self.assertTrue(library.contains(inside))
        self.assertEqual(library.root_of(inside), self.shared)
        self.assertTrue(in_library(self.user, inside))
        self.assertFalse(library.contains(self.shared + "2"))
        self.assertFalse(library.contains(os.path.join(self.shared, "..", "x.jpg")))
        self.assertIsNone(library.root_of(self.root))

    def test_a_scan_of_chosen_files_reads_files_of_any_folder(self):
        create_test_library_folder(self.user, self.shared)
        photo = self.photo_at(self.user, self.shared, "a.jpg")
        outside = self.photo_at(self.user, self.root, "elsewhere", "b.jpg")
        kept, ignored = scannable_files(
            self.user, [photo.main_file.path, outside.main_file.path]
        )
        self.assertEqual(kept, [photo.main_file.path])
        self.assertEqual(ignored, [outside.main_file.path])


class AddLibraryFolderTest(LibraryFoldersTestBase):
    def message(self, error):
        return str(error.exception.detail["path"])

    def test_adds_a_normalised_folder(self):
        folder = add_library_folder(self.user, self.shared + os.sep + ".")
        self.assertEqual(folder.path, self.shared)
        self.assertEqual(folder.owner, self.user)

    def test_needs_a_scan_directory_first(self):
        user = create_test_user(scan_directory="")
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(self.shared, user)
        self.assertIn("scan directory first", self.message(error))

    def test_refuses_a_folder_outside_the_data_root(self):
        outside = tempfile.mkdtemp(prefix="lp-outside-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(outside, self.user)
        self.assertIn("inside the data root", self.message(error))

    def test_refuses_a_missing_folder(self):
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(os.path.join(self.root, "nope"), self.user)
        self.assertIn("does not exist", self.message(error))

    def test_refuses_the_scan_directory_its_parent_and_children(self):
        for path in (
            self.main,
            self.folder("anna"),
            self.folder("anna", "photos", "x"),
        ):
            with self.subTest(path=path), self.assertRaises(ValidationError) as error:
                normalize_library_folder(path, self.user)
            self.assertIn("scan directory of this user", self.message(error))

    def test_refuses_the_upload_folder(self):
        uploads = self.folder("uploads", "anna")
        self.user.upload_directory = uploads
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(self.folder("uploads", "anna", "phone"), self.user)
        self.assertIn("upload folder of this user", self.message(error))

    def test_refuses_a_folder_overlapping_another_further_folder(self):
        create_test_library_folder(self.user, self.shared)
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(self.folder("shared"), self.user)
        self.assertIn("library folder", self.message(error))

    def test_refuses_another_users_folders_of_every_kind(self):
        ben_main = self.folder("ben")
        ben_uploads = self.folder("uploads", "ben")
        ben_extra = self.folder("archive", "ben")
        ben = create_test_user(scan_directory=ben_main, upload_directory=ben_uploads)
        create_test_library_folder(ben, ben_extra)
        for path in (ben_main, ben_uploads, os.path.join(ben_extra, "2001")):
            os.makedirs(path, exist_ok=True)
            with self.subTest(path=path), self.assertRaises(ValidationError) as error:
                normalize_library_folder(path, self.user)
            self.assertIn(ben.username, self.message(error))

    def test_refuses_more_than_the_limit(self):
        for index in range(MAX_LIBRARY_FOLDERS):
            create_test_library_folder(self.user, self.folder("many", str(index)))
        with self.assertRaises(ValidationError) as error:
            normalize_library_folder(self.shared, self.user)
        self.assertIn("at most", self.message(error))

    def test_a_scan_directory_may_not_take_another_users_further_folder(self):
        ben = create_test_user(scan_directory=self.folder("ben"))
        create_test_library_folder(ben, self.shared)
        with self.assertRaises(ValidationError) as error:
            normalize_scan_directory(self.shared, self.user)
        self.assertIn("library folder of user", str(error.exception.detail))

    def test_a_scan_directory_may_not_swallow_an_own_further_folder(self):
        create_test_library_folder(self.user, self.shared)
        with self.assertRaises(ValidationError) as error:
            normalize_scan_directory(self.folder("shared"), self.user)
        self.assertIn("Remove that folder", str(error.exception.detail))

    def test_an_upload_folder_may_lie_in_an_own_further_folder(self):
        create_test_library_folder(self.user, self.shared)
        uploads = self.folder("shared", "family", "uploads")
        self.assertEqual(
            normalize_scan_directory(
                uploads, self.user, "Upload folder", "upload_directory"
            ),
            uploads,
        )


class LibraryFolderEntriesTest(LibraryFoldersTestBase):
    def test_lists_each_folder_with_its_photos_and_state(self):
        extra = create_test_library_folder(self.user, self.shared)
        gone = create_test_library_folder(self.user, os.path.join(self.root, "usb"))
        self.photo_at(self.user, self.main, "a.jpg")
        self.photo_at(self.user, self.shared, "b.jpg")
        trashed = self.photo_at(self.user, self.shared, "c.jpg")
        trashed.in_trashcan = True
        trashed.save(update_fields=["in_trashcan"])

        entries = library_folder_entries(self.user)

        self.assertEqual(
            [(e["id"], e["kind"], e["photo_count"], e["available"]) for e in entries],
            [
                (None, "main", 1, True),
                (extra.pk, "folder", 1, True),
                (gone.pk, "folder", 0, False),
            ],
        )

    def test_an_upload_folder_outside_is_listed_last(self):
        self.user.upload_directory = self.folder("uploads")
        self.user.save(update_fields=["upload_directory"])
        kinds = [entry["kind"] for entry in library_folder_entries(self.user)]
        self.assertEqual(kinds, ["main", "upload"])

    def test_counts_by_the_spelling_the_scan_recorded(self):
        """A prefix query only matches the stored spelling, not a normalised one."""
        # Like C:/data\anna on Windows: no normalised prefix of it matches.
        spelled = os.path.join(self.folder("other"), "..", "anna", "photos")
        self.user.scan_directory = spelled
        self.user.save(update_fields=["scan_directory"])
        self.photo_at(self.user, spelled, "a.jpg")

        entries = library_folder_entries(self.user)

        self.assertEqual(
            [(e["path"], e["photo_count"]) for e in entries], [(spelled, 1)]
        )

    def test_nothing_without_a_scan_directory(self):
        self.assertEqual(library_folder_entries(create_test_user()), [])


class LibraryFolderViewsTest(LibraryFoldersTestBase):
    def setUp(self):
        super().setUp()
        self.admin = create_test_user(is_admin=True)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def manage_url(self, user, folder_id=None):
        url = f"/api/manage/user/{user.pk}/library-folders/"
        return url if folder_id is None else f"{url}{folder_id}/"

    def test_a_user_reads_their_own_folders(self):
        create_test_library_folder(self.user, self.shared)
        response = self.client_for(self.user).get("/api/library-folders/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [entry["path"] for entry in response.json()["folders"]],
            [self.main, self.shared],
        )

    def test_an_admin_adds_lists_and_removes_a_folder(self):
        client = self.client_for(self.admin)
        response = client.post(
            self.manage_url(self.user), {"path": self.shared}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        folder = LibraryFolder.objects.owned_by(self.user).get()
        self.assertEqual(response.json()["folders"][1]["id"], folder.pk)

        listed = client.get(self.manage_url(self.user)).json()["folders"]
        self.assertEqual([entry["kind"] for entry in listed], ["main", "folder"])

        response = client.delete(self.manage_url(self.user, folder.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["folders"]), 1)
        self.assertFalse(LibraryFolder.objects.exists())

    def test_a_refused_folder_is_a_400_naming_path(self):
        response = self.client_for(self.admin).post(
            self.manage_url(self.user), {"path": self.main}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "path")

    def test_only_admins_manage_folders(self):
        client = self.client_for(self.user)
        self.assertEqual(client.get(self.manage_url(self.user)).status_code, 403)
        response = client.post(
            self.manage_url(self.user), {"path": self.shared}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(LibraryFolder.objects.exists())

    def test_another_users_folder_is_not_found(self):
        ben = create_test_user(scan_directory=self.folder("ben"))
        theirs = create_test_library_folder(ben, self.shared)
        response = self.client_for(self.admin).delete(
            self.manage_url(self.user, theirs.pk)
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(LibraryFolder.objects.filter(pk=theirs.pk).exists())

    def test_an_unknown_user_is_not_found(self):
        response = self.client_for(self.admin).get(
            "/api/manage/user/987654/library-folders/"
        )
        self.assertEqual(response.status_code, 404)


class FolderChecksTest(LibraryFoldersTestBase):
    """The other places that ask whether a path is in the library."""

    def test_check_file_contents_takes_a_folder_of_any_library_folder(self):
        create_test_library_folder(self.user, self.shared)
        inside = self.folder("shared", "family", "2001")
        self.assertEqual(resolve_folder(self.user, inside), inside)
        below_main = self.folder("anna", "photos", "x")
        self.assertEqual(resolve_folder(self.user, "x"), below_main)
        with self.assertRaises(FolderError):
            resolve_folder(self.user, self.folder("shared", "other"))

    def test_the_folders_page_lists_every_library_folder_at_the_top(self):
        create_test_library_folder(self.user, self.shared)
        self.photo_at(self.user, self.main, "a.jpg")
        self.photo_at(self.user, self.shared, "b.jpg")
        client = APIClient()
        client.force_authenticate(user=self.user)

        top = client.get("/api/folders/subfolders/").json()

        self.assertIsNone(top["current_path"])
        self.assertEqual(
            [entry["path"] for entry in top["results"]], [self.main, self.shared]
        )
        inside = client.get("/api/folders/subfolders/", {"path": self.shared})
        self.assertEqual(inside.status_code, 200)
        self.assertIsNone(inside.json()["parent_path"])
        outside = client.get(
            "/api/folders/subfolders/", {"path": self.folder("shared")}
        )
        self.assertEqual(outside.status_code, 403)
