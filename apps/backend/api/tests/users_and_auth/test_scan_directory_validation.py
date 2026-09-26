import os
import shutil
import unittest
from unittest import mock

from django.conf import settings
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.models import User
from api.serializers.user import directories_overlap
from api.tests.utils import create_password


class SetupDirectoryTestCase(TestCase):
    userid = 0

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "test_admin", "test_admin@test.com", create_password()
        )

    def test_setup_directory(self):
        # UserSerializer.update accepts a scan directory only if it is inside
        # settings.DATA_ROOT *and* exists on disk. DATA_ROOT is
        # os.path.join(BASE_DATA, "data"), so "/data" is only correct inside the
        # container; use the configured root and make sure it is really there.
        os.makedirs(settings.DATA_ROOT, exist_ok=True)
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            f"/api/manage/user/{self.admin.id}/",
            {"scan_directory": settings.DATA_ROOT},
        )
        self.assertEqual(response.status_code, 200)

    def test_setup_not_existing_directory(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            f"/api/manage/user/{self.admin.id}/",
            {"scan_directory": "/non-existent-directory"},
        )
        self.assertEqual(response.status_code, 400)
        # Check for the error message in the new format
        data = response.json()
        self.assertIn("errors", data)
        self.assertGreater(len(data["errors"]), 0)
        self.assertEqual(
            data["errors"][0]["message"], "Scan directory must be inside the data root."
        )


class CreateUserScanDirectoryTestCase(TestCase):
    """Creating a user must validate scan_directory the same way updating does.

    Before the fix for #492, ``UserSerializer.create`` stored whatever an admin
    sent, so a user could be created with a scan directory outside DATA_ROOT or
    pointing at a directory that does not exist -- with no error at all.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "create_admin", "create_admin@test.com", create_password()
        )
        self.client.force_authenticate(user=self.admin)
        os.makedirs(settings.DATA_ROOT, exist_ok=True)

    def _create(self, username, scan_directory):
        return self.client.post(
            "/api/user/",
            {
                "username": username,
                "password": create_password(),
                "email": f"{username}@test.com",
                "scan_directory": scan_directory,
            },
        )

    def test_create_with_missing_scan_directory_is_rejected(self):
        missing = os.path.join(settings.DATA_ROOT, "does-not-exist")
        response = self._create("missingdir", missing)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["message"], "Scan directory does not exist"
        )
        self.assertFalse(User.objects.filter(username="missingdir").exists())

    def test_create_with_scan_directory_outside_data_root_is_rejected(self):
        outside = os.path.abspath(os.path.join(settings.DATA_ROOT, "..", "elsewhere"))
        response = self._create("outsidedir", outside)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["message"],
            "Scan directory must be inside the data root.",
        )
        self.assertFalse(User.objects.filter(username="outsidedir").exists())

    def test_create_with_valid_scan_directory_is_accepted_and_normalized(self):
        response = self._create("gooddir", settings.DATA_ROOT + os.sep)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="gooddir").scan_directory,
            os.path.abspath(settings.DATA_ROOT),
        )

    def test_create_with_initial_sentinel_still_works(self):
        response = self._create("initialdir", "initial")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username="initialdir").scan_directory, "")

    def test_per_field_validation_error_is_a_clean_sentence(self):
        """The custom exception handler used to ``str()`` the whole ErrorDetail
        list, so the response carried its Python repr. Now that the frontend
        shows these messages, they have to be readable."""
        User.objects.create_user("taken", "taken@test.com", create_password())
        response = self._create("taken", settings.DATA_ROOT)
        self.assertEqual(response.status_code, 400)
        errors = response.json()["errors"]
        self.assertEqual(errors[0]["field"], "username")
        self.assertEqual(
            errors[0]["message"], "A user with that username already exists."
        )


class OverlappingScanDirectoryTestCase(TestCase):
    """A directory another user already scans must be rejected (#2034).

    Two users could be PATCHed to the same path and both got 200. Every photo
    has exactly one owner, so whichever scan runs second either skips the files
    the first already owns or takes them over -- the outcome depends on scan
    order rather than on anything the admin chose.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "overlap_admin", "overlap_admin@test.com", create_password()
        )
        self.client.force_authenticate(user=self.admin)

        self.owner = User.objects.create_user(
            "overlap_owner", "overlap_owner@test.com", create_password()
        )
        self.other = User.objects.create_user(
            "overlap_other", "overlap_other@test.com", create_password()
        )

        # abspath, because that is the form the serializer stores.
        self.taken = os.path.abspath(os.path.join(settings.DATA_ROOT, "overlap-taken"))
        self.child = os.path.join(self.taken, "inner")
        self.free = os.path.abspath(os.path.join(settings.DATA_ROOT, "overlap-free"))
        for path in (self.child, self.free):
            os.makedirs(path, exist_ok=True)
        # DATA_ROOT is a real directory shared by the whole run; don't leave
        # these behind for the next test class to trip over.
        for name in (
            "overlap-taken",
            "overlap-free",
            "overlap-taken-2",
            "overlap-link",
        ):
            self.addCleanup(self._remove, os.path.join(settings.DATA_ROOT, name))

        self.owner.scan_directory = self.taken
        self.owner.save()

    @staticmethod
    def _remove(path):
        if os.path.islink(path):
            os.unlink(path)
        else:
            shutil.rmtree(path, ignore_errors=True)

    def _patch(self, user, scan_directory):
        return self.client.patch(
            f"/api/manage/user/{user.id}/", {"scan_directory": scan_directory}
        )

    def _message(self, response):
        return response.json()["errors"][0]["message"]

    def test_the_same_directory_is_rejected(self):
        response = self._patch(self.other, self.taken)
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))
        self.other.refresh_from_db()
        self.assertEqual(self.other.scan_directory, "")

    def test_a_child_of_another_users_directory_is_rejected(self):
        response = self._patch(self.other, self.child)
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))

    def test_a_parent_of_another_users_directory_is_rejected(self):
        # DATA_ROOT itself contains the owner's library.
        response = self._patch(self.other, settings.DATA_ROOT)
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))

    def test_a_sibling_directory_is_accepted(self):
        # The guard must reject overlap, not merely a shared prefix.
        response = self._patch(self.other, self.free)
        self.assertEqual(response.status_code, 200)
        self.other.refresh_from_db()
        self.assertEqual(self.other.scan_directory, os.path.abspath(self.free))

    def test_a_prefix_sibling_is_not_treated_as_a_child(self):
        # "overlap-taken-2" starts with "overlap-taken" but is not inside it.
        sibling = os.path.join(settings.DATA_ROOT, "overlap-taken-2")
        os.makedirs(sibling, exist_ok=True)
        response = self._patch(self.other, sibling)
        self.assertEqual(response.status_code, 200)

    def test_a_user_can_keep_its_own_directory(self):
        # Re-sending the value already stored is not a conflict with itself.
        response = self._patch(self.owner, self.taken)
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.scan_directory, self.taken)

    def test_a_stored_directory_with_a_trailing_separator_is_still_unchanged(self):
        # A value stored before this check may not be canonical. Comparing the
        # raw strings would call that a change and refuse the user's own path.
        self.owner.scan_directory = self.taken + os.sep
        self.owner.save()
        response = self._patch(self.owner, self.taken)
        self.assertEqual(response.status_code, 200)

    def test_an_existing_overlap_does_not_lock_the_user_out(self):
        # Installs that predate this check already overlap. Editing another
        # field, or re-sending the same directory, must still work -- only a
        # change to a conflicting directory is refused.
        self.other.scan_directory = self.taken
        self.other.save()

        response = self.client.patch(
            f"/api/manage/user/{self.other.id}/", {"first_name": "Still"}
        )
        self.assertEqual(response.status_code, 200)

        response = self._patch(self.other, self.taken)
        self.assertEqual(response.status_code, 200)

    def test_creating_a_user_on_a_taken_directory_is_rejected(self):
        response = self.client.post(
            "/api/user/",
            {
                "username": "overlap_new",
                "password": create_password(),
                "email": "overlap_new@test.com",
                "scan_directory": self.child,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))
        self.assertFalse(User.objects.filter(username="overlap_new").exists())

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths are a Windows thing")
    def test_a_differently_cased_spelling_is_rejected_on_windows(self):
        # NTFS is case-insensitive: C:\Data\alice and c:\data\alice are
        # one directory, so the second spelling must not slip past the check.
        # Only the last component changes case: DATA_ROOT is still spelled as
        # configured, so the path passes the "inside the data root" check.
        shouted = os.path.join(settings.DATA_ROOT, "OVERLAP-TAKEN")
        response = self._patch(self.other, shouted)
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))

    def test_a_symlink_into_another_users_directory_is_rejected(self):
        link = os.path.join(settings.DATA_ROOT, "overlap-link")
        try:
            os.symlink(self.child, link, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("cannot create symlinks here")
        response = self._patch(self.other, link)
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlap_owner", self._message(response))


class DirectoriesOverlapTestCase(SimpleTestCase):
    """The overlap test compares paths the way the filesystem does.

    ``os.path.normcase`` lower-cases on Windows and is the identity on POSIX,
    so patching it in stands in for a case-insensitive filesystem on any OS.
    """

    root = os.path.abspath(os.sep)

    def _path(self, *parts):
        return os.path.join(self.root, *parts)

    def test_case_differences_overlap_when_the_filesystem_folds_case(self):
        with mock.patch("os.path.normcase", lambda path: path.lower()):
            self.assertTrue(
                directories_overlap(
                    self._path("Data", "Alice"), self._path("data", "alice")
                )
            )
            self.assertTrue(
                directories_overlap(
                    self._path("data", "alice", "2020"), self._path("DATA", "ALICE")
                )
            )
            self.assertFalse(
                directories_overlap(
                    self._path("Data", "Alice"), self._path("data", "bob")
                )
            )

    def test_case_differences_do_not_overlap_when_the_filesystem_keeps_case(self):
        with mock.patch("os.path.normcase", lambda path: path):
            self.assertFalse(
                directories_overlap(
                    self._path("Data", "Alice"), self._path("data", "alice")
                )
            )

    @unittest.skipUnless(os.name == "nt", "Windows drive letters and separators")
    def test_windows_spellings_of_one_directory_overlap(self):
        self.assertTrue(directories_overlap(r"C:\Data\alice", "c:/data/alice/2020"))
        self.assertFalse(directories_overlap(r"C:\Data\alice", r"C:\Data\alice2"))
