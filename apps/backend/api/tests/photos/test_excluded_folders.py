"""Leaving subfolders out of a library (#791).

Scans skip a left-out folder, no "is this in the library" check accepts a
path below it, moves refuse it, and the photos already imported from it
count as outside the library until the user moves them to the trash.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from api.directory_watcher.utils import walk_directory, walk_files
from api.models import LongRunningJob
from api.photos.excluded_folders import (
    MAX_EXCLUDED_FOLDERS,
    library_subfolders,
    normalize_excluded_folders,
    set_excluded_folders,
)
from api.photos.library_files import in_library, scannable_files
from api.photos.moves import InvalidTargetError, library_folders, resolve_target
from api.photos.outside_library import (
    photos_outside_library,
    trash_photos_outside_library_job,
)
from api.photos.paths import library_of
from api.tests.utils import (
    api_error,
    create_test_file,
    create_test_library_folder,
    create_test_photo,
    create_test_user,
)


class ExcludedFoldersTestBase(TestCase):
    def setUp(self):
        self.root = os.path.normpath(tempfile.mkdtemp(prefix="lp-excluded-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        settings_ctx = override_settings(DATA_ROOT=self.root)
        settings_ctx.enable()
        self.addCleanup(settings_ctx.disable)
        self.main = self.folder("anna")
        self.shared = self.folder("family")
        self.trip = self.folder("family", "Uncle Tom's trip")
        self.folder("family", "Uncle Tom's trip", "day 1")
        self.folder("family", "Christmas")
        self.user = create_test_user(scan_directory=self.main)
        create_test_library_folder(self.user, self.shared)

    def folder(self, *parts):
        path = os.path.join(self.root, *parts)
        os.makedirs(path, exist_ok=True)
        return path

    def write(self, *parts):
        path = os.path.join(*parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(os.urandom(16))
        return path

    def photo_at(self, *parts):
        file = create_test_file(self.write(*parts), self.user)
        photo = create_test_photo(owner=self.user, main_file=file)
        photo.files.add(file)
        return photo

    def leave_out(self, *paths):
        set_excluded_folders(self.user, paths)
        self.user.refresh_from_db()


class NormalizeTest(ExcludedFoldersTestBase):
    def message(self, error):
        return str(error.exception.detail["excluded_folders"])

    def test_keeps_folders_inside_any_library_folder(self):
        inside_main = self.folder("anna", "screenshots")
        self.assertEqual(
            normalize_excluded_folders(self.user, [self.trip, inside_main]),
            sorted([self.trip, inside_main]),
        )

    def test_a_folder_inside_another_left_out_one_is_dropped(self):
        day = os.path.join(self.trip, "day 1")
        self.assertEqual(
            normalize_excluded_folders(self.user, [day, self.trip, self.trip]),
            [self.trip],
        )

    def test_spells_a_folder_from_its_library_folder(self):
        given = os.path.join(self.shared, "x", "..", "Uncle Tom's trip")
        self.assertEqual(normalize_excluded_folders(self.user, [given]), [self.trip])

    def test_refuses_what_is_not_strictly_inside_the_library(self):
        for path, reason in (
            ("relative/path", "absolute"),
            (self.folder("elsewhere"), "not in your library"),
            (self.shared, "library folder"),
            (self.root, "not in your library"),
        ):
            with self.subTest(path=path), self.assertRaises(ValidationError) as error:
                normalize_excluded_folders(self.user, [path])
            self.assertIn(reason, self.message(error))

    def test_refuses_a_folder_holding_the_upload_folder(self):
        with self.assertRaises(ValidationError) as error:
            normalize_excluded_folders(self.user, [os.path.join(self.main, "uploads")])
        self.assertIn("upload folder", self.message(error))

    def test_refuses_too_many(self):
        paths = [os.path.join(self.shared, str(i)) for i in range(501)]
        with self.assertRaises(ValidationError) as error:
            normalize_excluded_folders(self.user, paths)
        self.assertIn(str(MAX_EXCLUDED_FOLDERS), self.message(error))

    def test_a_user_without_a_library_can_only_clear_the_list(self):
        user = create_test_user(scan_directory="")
        self.assertEqual(normalize_excluded_folders(user, []), [])
        with self.assertRaises(ValidationError):
            normalize_excluded_folders(user, [self.trip])


class LibraryChecksTest(ExcludedFoldersTestBase):
    def setUp(self):
        super().setUp()
        self.leave_out(self.trip)
        self.inside_trip = self.write(self.trip, "day 1", "a.jpg")
        self.kept = self.write(self.shared, "Christmas", "b.jpg")

    def test_no_check_accepts_a_left_out_path(self):
        library = library_of(self.user)
        self.assertFalse(library.contains(self.inside_trip))
        self.assertFalse(in_library(self.user, self.trip))
        self.assertTrue(library.contains(self.kept))
        # The folder is still found in its library folder, for labels.
        self.assertEqual(library.root_of(self.inside_trip), self.shared)
        kept, ignored = scannable_files(self.user, [self.inside_trip, self.kept])
        self.assertEqual((kept, ignored), ([self.kept], [self.inside_trip]))

    def test_the_walk_skips_a_left_out_folder(self):
        found: list[str] = []
        walk_directory(self.shared, found, excluded=[self.trip])
        self.assertEqual(found, [self.kept])

    def test_a_scan_of_chosen_paths_skips_it_too(self):
        found: list[str] = []
        walk_files(
            [self.trip, self.inside_trip, self.kept], found, excluded=[self.trip]
        )
        self.assertEqual(found, [self.kept])

    def test_its_photos_count_as_outside_the_library(self):
        left_out = self.photo_at(self.trip, "c.jpg")
        kept = self.photo_at(self.shared, "d.jpg")
        outside = set(photos_outside_library(self.user).values_list("pk", flat=True))
        self.assertIn(left_out.pk, outside)
        self.assertNotIn(kept.pk, outside)

    def test_moves_refuse_it_and_the_picker_hides_it(self):
        with self.assertRaises(InvalidTargetError) as error:
            resolve_target(self.user, os.path.join(self.trip, "new"))
        self.assertEqual(error.exception.code, "excluded_folder")
        names = [
            folder.name for folder in library_folders(self.user, self.shared).folders
        ]
        self.assertEqual(names, ["Christmas"])


class SubfoldersTest(ExcludedFoldersTestBase):
    def test_lists_the_subfolders_with_what_is_left_out(self):
        self.leave_out(self.trip)
        self.photo_at(self.trip, "a.jpg")

        listing = library_subfolders(self.user, self.shared)

        self.assertEqual(
            [
                (f["name"], f["excluded"], f["has_subfolders"], f["photo_count"])
                for f in listing["subfolders"]
            ],
            [("Christmas", False, False, 0), ("Uncle Tom's trip", True, True, 1)],
        )
        self.assertFalse(listing["truncated"])

    def test_nothing_outside_the_library_or_inside_a_left_out_folder(self):
        self.leave_out(self.trip)
        for path in (
            self.root,
            self.folder("elsewhere"),
            os.path.join(self.trip, "day 1"),
        ):
            with self.subTest(path=path), self.assertRaises(NotFound):
                library_subfolders(self.user, path)


class ExcludedFoldersViewsTest(ExcludedFoldersTestBase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_leaves_folders_out_and_says_how_many_photos_are_outside(self):
        self.photo_at(self.trip, "a.jpg")

        response = self.client.put(
            "/api/library-folders/excluded/",
            {"excluded_folders": [self.trip]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["excluded_folders"], [self.trip])
        self.assertEqual(body["outside_count"], 1)
        self.assertEqual(len(body["folders"]), 2)
        self.user.refresh_from_db()
        self.assertEqual(self.user.excluded_folders, [self.trip])
        listed = self.client.get("/api/library-folders/").json()
        self.assertEqual(listed["excluded_folders"], [self.trip])

    def test_a_refused_folder_is_a_400_and_changes_nothing(self):
        response = self.client.put(
            "/api/library-folders/excluded/",
            {"excluded_folders": [self.folder("elsewhere")]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "excluded_folders")
        self.user.refresh_from_db()
        self.assertEqual(self.user.excluded_folders, [])

    def test_another_users_folder_cannot_be_listed(self):
        ben = create_test_user(scan_directory=self.folder("ben"))
        self.folder("ben", "private")
        response = self.client.get(
            "/api/library-folders/subfolders/", {"path": ben.scan_directory}
        )
        self.assertEqual(response.status_code, 404)
        own = self.client.get("/api/library-folders/subfolders/", {"path": self.shared})
        self.assertEqual(own.status_code, 200)

    def test_moves_the_own_photos_outside_the_library_to_the_trash(self):
        with patch("api.jobs.queue.AsyncTask") as task:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post("/api/library-folders/trash-outside/")

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.started_by, self.user)
        self.assertEqual(job.job_type, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY)
        self.assertIs(task.call_args.args[0], trash_photos_outside_library_job)
        self.assertEqual(task.call_args.args[1], self.user)
