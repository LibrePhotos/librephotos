"""A Nextcloud scan follows what changed on the server (#2258).

The scan downloaded each remote file once and never looked at it again: a file
or XMP sidecar edited on the server never arrived, a file deleted there stayed,
and the local copy's mtime was the download time, so a "File modified time"
date rule dated every undated photo on the import day. Edits written back
landed in the local copy only. The WebDAV client is mocked: no server is
contacted.
"""

import datetime
import json
import os
import shutil
import tempfile
import uuid
from email.utils import format_datetime
from unittest import mock

import pyvips
from django.test import TestCase, override_settings
from owncloud import FileInfo

from api.metadata.datetime_rules import OTHER_RULES_PARAMS
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_writer import write_photo_metadata
from api.models import File, LongRunningJob, Photo, User
from api.tests.utils import create_test_photo, create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher

JAN_2019 = datetime.datetime(2019, 1, 15, 12, 0, tzinfo=datetime.timezone.utc)
MAR_2020 = datetime.datetime(2020, 3, 1, 9, 30, tzinfo=datetime.timezone.utc)
XMP = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="{}"/>'
    "</rdf:RDF></x:xmpmeta>"
)


def _png(width: int) -> bytes:
    return pyvips.Image.black(width, 8).write_to_buffer(".png")


class NextcloudRemoteChangesTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        self.data_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.data_root, ignore_errors=True)
        settings_override = override_settings(DATA_ROOT=self.data_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.root = os.path.join(self.data_root, "nextcloud_media", self.user.username)
        # The server: remote path -> (content, last modified).
        self.server: dict[str, tuple[bytes, datetime.datetime]] = {}
        self.nc = mock.MagicMock()
        self.nc.list.side_effect = self._list
        self.nc.get_file.side_effect = self._get_file
        self._patch("nextcloud.server_address.GuardedClient", return_value=self.nc)
        self._patch("nextcloud.directory_watcher.build_image_similarity_index")
        self.process = self._patch("api.directory_watcher.file_handlers._process_photo")

    def _patch(self, target, **kwargs):
        patcher = mock.patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def _list(self, path):
        return [
            FileInfo(
                remote_path,
                "file",
                {
                    "{DAV:}getcontenttype": (
                        "application/octet-stream"
                        if remote_path.endswith(".xmp")
                        else "image/png"
                    ),
                    "{DAV:}getcontentlength": str(len(content)),
                    "{DAV:}getlastmodified": format_datetime(modified, usegmt=True),
                },
            )
            for remote_path, (content, modified) in sorted(self.server.items())
            if remote_path.startswith(path.rstrip("/") + "/")
        ]

    def _get_file(self, remote_path, local_path):
        with open(local_path, "wb") as f:
            f.write(self.server[remote_path][0])
        return True

    def _scan(self):
        job_id = uuid.uuid4()
        result = directory_watcher.scan_photos(self.user, job_id)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(result["status"], job.result)

    def _local(self, name):
        return os.path.join(self.root, "Photos", name)

    def _downloaded(self):
        return sorted(
            os.path.basename(c.args[0]) for c in self.nc.get_file.call_args_list
        )

    def _processed(self):
        return sorted(os.path.basename(c.args[1]) for c in self.process.call_args_list)

    def _forget_calls(self):
        self.nc.get_file.reset_mock()
        self.process.reset_mock()

    def test_an_unchanged_file_is_not_downloaded_again(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self._scan()
        self._forget_calls()

        self._scan()

        self.assertEqual([], self._downloaded())
        self.assertEqual([], self._processed())

    def test_the_local_copy_takes_the_remote_modification_time(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)

        self._scan()

        self.assertEqual(JAN_2019.timestamp(), os.path.getmtime(self._local("a.png")))

    def test_a_file_changed_on_the_server_is_downloaded_and_processed_again(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self._scan()
        self._forget_calls()
        self.server["/Photos/a.png"] = (_png(11), MAR_2020)

        with mock.patch(
            "api.directory_watcher.file_handlers._picture_verdict",
            return_value="same picture",
        ):
            self._scan()

        self.assertEqual(["a.png"], self._downloaded())
        self.assertEqual(["a.png"], self._processed())
        with open(self._local("a.png"), "rb") as f:
            self.assertEqual(_png(11), f.read())
        self.assertEqual(1, Photo.objects.owned_by(self.user).count())

    def test_a_sidecar_changed_on_the_server_has_its_photo_processed_again(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self.server["/Photos/a.xmp"] = (XMP.format(2).encode(), JAN_2019)
        self._scan()
        photo = Photo.objects.owned_by(self.user).get()
        self.assertTrue(photo.files.filter(path=self._local("a.xmp")).exists())
        self._forget_calls()
        self.server["/Photos/a.xmp"] = (XMP.format(5).encode(), MAR_2020)

        self._scan()

        self.assertEqual(["a.xmp"], self._downloaded())
        self.assertEqual(["a.png"], self._processed())
        self.assertEqual(photo.pk, self.process.call_args.args[0].pk)

    def test_a_copy_downloaded_before_gets_the_remote_time_and_is_redated(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self._scan()
        # As an older version left it: the download time as its mtime.
        os.utime(self._local("a.png"))
        self._forget_calls()

        self._scan()

        self.assertEqual([], self._downloaded())
        self.assertEqual(JAN_2019.timestamp(), os.path.getmtime(self._local("a.png")))
        self.assertEqual(["a.png"], self._processed())
        self._forget_calls()

        self._scan()

        self.assertEqual([], self._processed())

    def test_a_file_deleted_on_the_server_is_flagged_missing_and_kept(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self.server["/Photos/b.png"] = (_png(13), JAN_2019)
        self._scan()
        del self.server["/Photos/b.png"]

        self._scan()

        gone = File.objects.get(path=self._local("b.png"))
        self.assertTrue(gone.missing)
        self.assertFalse(File.objects.get(path=self._local("a.png")).missing)
        photo = Photo.objects.owned_by(self.user).get(main_file=gone)
        self.assertFalse(photo.files.exists())
        self.assertTrue(os.path.exists(self._local("b.png")))

    def test_a_file_back_on_the_server_is_attached_again(self):
        self.server["/Photos/b.png"] = (_png(13), JAN_2019)
        self._scan()
        removed = self.server.pop("/Photos/b.png")
        self._scan()
        self.server["/Photos/b.png"] = removed

        self._scan()

        back = File.objects.get(path=self._local("b.png"))
        self.assertFalse(back.missing)
        photo = Photo.objects.owned_by(self.user).get()
        self.assertEqual([back.pk], list(photo.files.values_list("pk", flat=True)))

    def test_files_outside_the_scan_directory_are_not_flagged(self):
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self._scan()
        self.user.nextcloud_scan_directory = "/Elsewhere"
        self.user.save()

        self._scan()

        self.assertFalse(File.objects.get(path=self._local("a.png")).missing)

    def test_a_file_modified_time_rule_dates_an_undated_photo_by_the_server(self):
        rule = next(r for r in OTHER_RULES_PARAMS if r["id"] == 7)
        self.user.datetime_rules = json.dumps([rule])
        self.user.default_timezone = "UTC"
        self.user.save()
        self.server["/Photos/a.png"] = (_png(9), JAN_2019)
        self._scan()
        photo = Photo.objects.owned_by(self.user).get()

        # The rule reads no tag; the empty tag query never reaches ExifTool.
        with mock.patch("api.metadata.photo_datetime.get_metadata", return_value=[]):
            extract_date_time(photo, commit=True)

        self.assertEqual(JAN_2019, photo.exif_timestamp)


class NextcloudWriteBackTest(TestCase):
    """Edits are not written into a local copy of a Nextcloud file (#2258)."""

    def setUp(self):
        self.data_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.data_root, ignore_errors=True)
        settings_override = override_settings(DATA_ROOT=self.data_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )

    def _photo_at(self, path):
        photo = create_test_photo(owner=self.user, rating=4)
        File.objects.filter(pk=photo.main_file.pk).update(path=path)
        photo.refresh_from_db()
        return photo

    def test_no_write_into_a_nextcloud_copy(self):
        path = os.path.join(
            self.data_root, "nextcloud_media", self.user.username, "a.jpg"
        )
        photo = self._photo_at(path)

        with mock.patch("api.metadata.photo_writer.write_metadata") as write:
            write_photo_metadata(photo, ["rating"])

        write.assert_not_called()

    def test_other_files_are_still_written(self):
        photo = self._photo_at(os.path.join(self.data_root, "photos", "a.jpg"))

        with mock.patch("api.metadata.photo_writer.write_metadata") as write:
            write_photo_metadata(photo, ["rating"])

        write.assert_called_once()
