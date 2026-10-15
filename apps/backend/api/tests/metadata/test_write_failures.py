"""A metadata write ExifTool could not make is reported, not passed off as done (#2294).

``write_metadata`` used to drop ExifTool's answer, and PyExifTool sends its
stderr to /dev/null, so a read-only library, a damaged file, a misspelt tag
or a tag the target cannot hold all looked like success. Real ExifTool, no
mocks.
"""

import os
import pickle
import shutil
import stat
import tempfile
import unittest
from unittest.mock import patch

import PIL.Image
from django.test import TestCase
from rest_framework.test import APIClient

from api.metadata import library_write
from api.metadata.jobs import write_photo_ratings
from api.metadata.library_write import write_library_metadata
from api.metadata.tags import Tags
from api.metadata.writer import (
    MetadataWriteError,
    add_to,
    one_exiftool_process,
    remove_from,
    write_metadata,
)
from api.models import LongRunningJob
from api.models.face import Face
from api.models.person import Person
from api.models.user import User
from api.photos.media_files import get_or_create_file
from api.runtime import binaries
from api.tests.metadata.exiftool_harness import EXIFTOOL, RealExifToolTestCase
from api.tests.utils import (
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_user,
)

SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE


def _damage(path: str) -> None:
    """Make ``path`` a file ExifTool cannot write: not an image any more."""
    with open(path, "wb") as handle:
        handle.write(b"this is not a JPEG")


class WriteMetadataReportsFailuresTest(RealExifToolTestCase):
    def test_a_rating_write_reports_one_file_updated(self):
        path = self.make_image(".jpg")

        result = write_metadata(path, {Tags.RATING: 4}, use_sidecar=False)

        self.assertEqual(1, result.updated)
        self.assertEqual({Tags.RATING: 4}, self.read_tags(path, Tags.RATING))

    def test_a_read_only_file_raises(self):
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.skipTest("root writes read-only files")
        path = self.make_image(".jpg")
        # Windows refuses to replace a read-only file; POSIX needs the folder
        # read-only too, as on a read-only mount.
        os.chmod(path, stat.S_IREAD)
        os.chmod(self.directory, stat.S_IREAD | stat.S_IEXEC)

        def writable() -> None:
            os.chmod(self.directory, stat.S_IRWXU)
            os.chmod(path, stat.S_IREAD | stat.S_IWRITE)

        self.addCleanup(writable)

        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.RATING: 5}, use_sidecar=False)

    def test_a_damaged_file_raises(self):
        path = self.make_image(".jpg")
        _damage(path)

        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.RATING: 5}, use_sidecar=False)

    def test_an_unknown_tag_raises_even_next_to_a_valid_one(self):
        # ExifTool writes the Rating, warns about the other tag and exits 0.
        path = self.make_image(".jpg")

        with self.assertRaises(MetadataWriteError) as raised:
            write_metadata(path, {"EXIF:Bogus": 1, Tags.RATING: 2}, use_sidecar=False)

        self.assertIn("EXIF:Bogus", str(raised.exception))

    def test_exif_orientation_into_an_existing_sidecar_raises(self):
        # "0 image files updated, 1 image files unchanged", exit code 0 (#2297).
        path = self.make_image(".jpg")
        write_metadata(path, {Tags.RATING: 2}, use_sidecar=True)

        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.ORIENTATION: 6}, use_sidecar=True)

    def test_exif_orientation_without_a_sidecar_raises(self):
        # "Nothing to write", exit code 1: no sidecar is created.
        path = self.make_image(".jpg")

        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.ORIENTATION: 6}, use_sidecar=True)

    def test_removing_a_tag_the_sidecar_lacks_is_no_failure(self):
        # Clearing face regions of a photo whose sidecar has none: "1 image
        # files unchanged" is the right answer here.
        path = self.make_image(".jpg")
        write_metadata(path, {Tags.RATING: 2}, use_sidecar=True)

        result = write_metadata(path, {Tags.REGION_INFO_WRITE: ""}, use_sidecar=True)

        self.assertEqual((0, 1), (result.updated, result.unchanged))

    def test_removing_a_keyword_the_sidecar_lacks_is_no_failure(self):
        path = self.make_image(".jpg")
        write_metadata(path, {Tags.SUBJECT: ["Holiday"]}, use_sidecar=True)

        removal = {remove_from(Tags.SUBJECT): ["Alice"]}
        self.assertEqual(0, write_metadata(path, removal, use_sidecar=True).updated)
        added = {add_to(Tags.SUBJECT): ["Bob"]}
        self.assertEqual(1, write_metadata(path, added, use_sidecar=True).updated)

        subject = self.read_tags(self.sidecar_of(path), "XMP-dc:Subject")
        self.assertEqual(["Holiday", "Bob"], subject["XMP-dc:Subject"])

    def test_the_error_survives_pickling(self):
        # django-q and the parallel test runner pickle exceptions.
        error = MetadataWriteError(
            "/library/a.jpg", "Error: Not a valid JPG - /library/a.jpg"
        )

        copy = pickle.loads(pickle.dumps(error))

        self.assertEqual(
            ("/library/a.jpg", "Error: Not a valid JPG - the file"),
            (copy.path, str(copy)),
        )


class FailedWritesReachTheCallerTest(RealExifToolTestCase):
    def test_a_rating_job_writes_the_others_and_counts_the_failure(self):
        user = create_test_user(save_metadata_to_disk=MEDIA_FILE)
        paths = [self.make_image(".jpg", f"rated-{index}") for index in range(3)]
        for index, path in enumerate(paths):
            # Distinct bytes: identical files would share one File row.
            self.tag(path, f"-XMP:Title=photo {index}")
        photos = [self.photo_for(path, user, rating=4) for path in paths]
        _damage(paths[1])

        failures = write_photo_ratings(
            [photo.id for photo in photos], use_sidecar=False
        )

        self.assertEqual(1, failures)
        for path in (paths[0], paths[2]):
            self.assertEqual({Tags.RATING: 4}, self.read_tags(path, Tags.RATING))

    def _face_photo(self, mode, damaged=False):
        user = create_test_user(save_metadata_to_disk=mode, save_face_tags_to_disk=True)
        path = self.make_image(".jpg")
        photo = self.photo_for(path, user, thumbnails=True)
        if damaged:
            # The thumbnails come from the good image; Windows will not let
            # the file be rewritten while libvips still has it mapped, so the
            # photo moves to a damaged one.
            path = self.make_image(".jpg", "damaged")
            _damage(path)
            photo.main_file = get_or_create_file(path, user)
            photo.save()
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=user
        )
        face = create_test_face(
            photo=photo,
            person=person,
            location_top=10,
            location_right=40,
            location_bottom=30,
            location_left=16,
        )
        return photo, face, path

    def test_labelling_a_face_keeps_the_label_and_reports_the_failed_write(self):
        photo, face, _ = self._face_photo(MEDIA_FILE, damaged=True)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        response = client.post(
            "/api/labelfaces",
            {"face_ids": [face.id], "person_name": "Bob"},
            format="json",
        )

        self.assertEqual(200, response.status_code, response.content)
        self.assertTrue(response.json()["write_error"])
        self.assertEqual("Bob", Face.objects.get(pk=face.pk).person.name)

    def test_labelling_a_face_reports_no_error_when_the_write_lands(self):
        photo, face, _ = self._face_photo(SIDECAR)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        response = client.post(
            "/api/labelfaces",
            {"face_ids": [face.id], "person_name": "Bob"},
            format="json",
        )

        self.assertEqual(200, response.status_code, response.content)
        self.assertIsNone(response.json()["write_error"])

    def test_the_write_metadata_job_counts_the_failure(self):
        photo, _, path = self._face_photo(MEDIA_FILE, damaged=True)
        job = create_test_job(photo.owner, LongRunningJob.JOB_WRITE_METADATA)

        with patch.object(
            library_write, "enqueue_task", side_effect=lambda f, *a: f(*a)
        ):
            write_library_metadata(photo.owner, ["face_tags"], job_id=job.job_id)

        job.refresh_from_db()
        self.assertEqual(0, job.result["written"])
        self.assertEqual(1, job.result["error_count"])
        self.assertTrue(job.result["errors"][0].startswith(f"{path}: face_tags: "))

    def _rotate(self, photo, angle=90):
        client = APIClient()
        client.force_authenticate(user=photo.owner)
        return client.post(
            "/api/photosedit/rotate",
            {"image_hash": photo.image_hash, "angle": angle},
            format="json",
        )

    def test_a_rotation_reaches_the_sidecar(self):
        # #2297: as XMP-tiff:Orientation; EXIF:Orientation cannot live there.
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        path = self.make_image(".jpg")
        photo = self.photo_for(path, user, thumbnails=True)

        response = self._rotate(photo)

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(6, response.json()["local_orientation"])
        self.assertIsNone(response.json()["write_error"])
        sidecar = self.sidecar_of(path)
        self.assertEqual(
            {Tags.ORIENTATION_XMP: 8}, self.read_tags(sidecar, Tags.ORIENTATION_XMP)
        )

    @patch("api.thumbnails.render.regenerate_thumbnails")
    def test_a_rotation_that_cannot_be_written_is_reported(self, regenerate):
        # The rotation is kept in the database and the response says the file
        # was not written.
        photo, _, _ = self._face_photo(MEDIA_FILE, damaged=True)

        response = self._rotate(photo)

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(6, response.json()["local_orientation"])
        self.assertTrue(response.json()["write_error"])


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class OneExifToolProcessPerJobTest(TestCase):
    def test_a_hundred_rating_writes_start_one_exiftool(self):
        directory = tempfile.mkdtemp(prefix="librephotos-one-exiftool-")
        self.addCleanup(shutil.rmtree, directory, True)
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        photo_ids = []
        for index in range(100):
            path = os.path.join(directory, f"photo-{index}.png")
            # Distinct pixels: identical files would share one File row.
            PIL.Image.new("RGB", (8, 8), (index, 0, 0)).save(path)
            photo = create_test_photo(owner=user, rating=3)
            photo.main_file = get_or_create_file(path, user)
            photo.save()
            photo_ids.append(photo.id)

        with patch(
            "api.metadata.writer.binaries.start_tool", wraps=binaries.start_tool
        ) as start_tool:
            failures = write_photo_ratings(photo_ids, use_sidecar=True)

        self.assertEqual(0, failures)
        self.assertEqual(1, start_tool.call_count)
        sidecars = [name for name in os.listdir(directory) if name.endswith(".xmp")]
        self.assertEqual(100, len(sidecars))

    def test_an_exiftool_that_died_is_replaced_for_the_next_write(self):
        directory = tempfile.mkdtemp(prefix="librephotos-one-exiftool-")
        self.addCleanup(shutil.rmtree, directory, True)
        paths = []
        for index in range(2):
            paths.append(os.path.join(directory, f"photo-{index}.png"))
            PIL.Image.new("RGB", (8, 8)).save(paths[-1])

        started = []
        real_start_tool = binaries.start_tool

        def start_tool(*args, **kwargs):
            started.append(real_start_tool(*args, **kwargs))
            return started[-1]

        with (
            patch("api.metadata.writer.binaries.start_tool", start_tool),
            one_exiftool_process(),
        ):
            write_metadata(paths[0], {Tags.RATING: 1}, use_sidecar=False)
            binaries.kill(started[0])  # crashed, or killed by the OOM killer
            result = write_metadata(paths[1], {Tags.RATING: 2}, use_sidecar=False)

        self.assertEqual(1, result.updated)
        self.assertEqual(2, len(started))
