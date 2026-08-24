"""Diagnosing why nginx could not read an original (issue #714).

A video that will not play is almost never a broken video: the backend serves
originals by handing nginx an ``X-Accel-Redirect``, nginx's worker runs as a
different and much less privileged user, and when it cannot open the file it
answers with its own 403. The browser shows "could not be loaded" and says
nothing about which of the three possible failures just happened.

These tests pin down the two properties that make the diagnosis trustworthy:
mode bits are evaluated the way the kernel evaluates them (no falling through
from owner to group to other), and the suggested remedy follows the filesystem
rather than assuming everybody is on local ext4 -- ``chmod`` is a silent no-op
on a CIFS share or an NTFS drive.
"""

import os
import shutil
import stat
import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.serving_permissions import (
    CAUSE_MISSING,
    CAUSE_MODE_BITS,
    CAUSE_NOT_MODE_BITS,
    REMEDY_CHMOD,
    REMEDY_LABELS,
    REMEDY_MOUNT_DEEPER,
    REMEDY_MOUNT_OPTIONS,
    REMEDY_NETWORK_FS,
    REMEDY_READ_ONLY,
    describe_mount,
    diagnose_media_path,
)
from api.tests.utils import create_test_photo, create_test_user
from api.views.views import UnifiedMediaAccessView

# Neither of these can match the uid running the suite, so the "other" bits are
# what decide -- which is exactly the situation in a real install, where nginx
# is uid 101 and the library belongs to a human.
FAKE_WEBSERVER_UID = 65531
FAKE_WEBSERVER_GID = 65532


def _mounts_file(directory, entries):
    """Write a /proc/mounts lookalike so mount detection can be exercised.

    The real file cannot be arranged to contain a CIFS share on demand, and the
    remedy the diagnostic offers hinges entirely on what it finds there.
    """
    path = os.path.join(directory, "fake_mounts")
    with open(path, "w") as handle:
        for source, point, fstype, options in entries:
            handle.write(f"{source} {point} {fstype} {options} 0 0\n")
    return path


class _TreeMixin:
    """Build a library tree whose every ancestor is deliberately traversable.

    Without this the walk up to ``/`` can trip over an unrelated private
    directory -- ``/tmp/pytest-of-<user>`` is commonly mode 700 -- and the test
    would then assert against the wrong blocking path.
    """

    def make_tree(self, *, depth=2):
        root = tempfile.mkdtemp(prefix="librephotos-media-perms-")
        self.addCleanup(self._cleanup, root)
        os.chmod(root, 0o755)
        current = root
        dirs = []
        for level in range(depth):
            current = os.path.join(current, f"level{level}")
            os.mkdir(current, 0o755)
            os.chmod(current, 0o755)
            dirs.append(current)
        video = os.path.join(current, "clip.mp4")
        with open(video, "wb") as handle:
            handle.write(b"not really an mp4")
        os.chmod(video, 0o644)
        return root, dirs, video

    def _cleanup(self, root):
        for dirpath, dirnames, filenames in os.walk(root):
            os.chmod(dirpath, 0o755)
            for name in dirnames:
                os.chmod(os.path.join(dirpath, name), 0o755)
        for dirpath, dirnames, filenames in os.walk(root, topdown=False):
            for name in filenames:
                os.remove(os.path.join(dirpath, name))
            for name in dirnames:
                os.rmdir(os.path.join(dirpath, name))
        os.rmdir(root)


@override_settings(WEBSERVER_UID=FAKE_WEBSERVER_UID, WEBSERVER_GID=FAKE_WEBSERVER_GID)
class DiagnoseMediaPathTest(_TreeMixin, SimpleTestCase):
    def test_fully_readable_file_reports_permissions_are_not_the_problem(self):
        """The most useful answer this can give is "stop looking at permissions".

        We are only ever called after a request already came back 403, so mode
        bits that permit the read rule out the whole family of chmod-shaped
        fixes and point at SELinux, AppArmor or a remapped runtime instead.
        """
        _root, _dirs, video = self.make_tree()

        result = diagnose_media_path(video)

        self.assertTrue(result["readable_by_webserver"])
        self.assertEqual(result["cause"], CAUSE_NOT_MODE_BITS)
        self.assertIsNone(result["blocking"])
        self.assertEqual(result["remedies"], [REMEDY_LABELS])

    def test_unreadable_file_is_named_with_its_mode(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = diagnose_media_path(video)

        self.assertFalse(result["readable_by_webserver"])
        self.assertEqual(result["cause"], CAUSE_MODE_BITS)
        self.assertEqual(result["blocking"]["path"], video)
        self.assertEqual(result["blocking"]["kind"], "file")
        self.assertEqual(result["blocking"]["mode"], "0640")

    def test_untraversable_directory_is_reported_instead_of_the_file(self):
        """The real-world failure is a closed directory above the photos."""
        _root, dirs, video = self.make_tree(depth=3)
        os.chmod(dirs[0], 0o750)

        result = diagnose_media_path(video)

        self.assertEqual(result["cause"], CAUSE_MODE_BITS)
        self.assertEqual(result["blocking"]["path"], dirs[0])
        self.assertEqual(result["blocking"]["kind"], "directory")
        self.assertEqual(result["blocking"]["mode"], "0750")

    def test_the_outermost_blocker_is_the_one_reported(self):
        """Naming the innermost would send the admin to fix the wrong level."""
        _root, dirs, video = self.make_tree(depth=3)
        os.chmod(dirs[0], 0o750)
        os.chmod(dirs[2], 0o750)

        result = diagnose_media_path(video)

        self.assertEqual(result["blocking"]["path"], dirs[0])

    def test_owner_class_does_not_fall_through_to_other(self):
        """A file owned by the web server is judged by its *owner* bits alone.

        Mode 0077 looks generous and grants the owner nothing. Treating this as
        readable would let the diagnostic call a broken library healthy, which
        is the one failure mode worth writing a test against.
        """
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o077)
        fake_stat = os.stat_result(
            (
                stat.S_IFREG | 0o077,
                0,
                0,
                1,
                FAKE_WEBSERVER_UID,
                0,
                0,
                0,
                0,
                0,
            )
        )
        real_stat = os.stat

        def stat_with_webserver_owner(path, *args, **kwargs):
            if path == video:
                return fake_stat
            return real_stat(path, *args, **kwargs)

        with mock.patch("api.serving_permissions.os.stat", stat_with_webserver_owner):
            result = diagnose_media_path(video)

        self.assertFalse(result["readable_by_webserver"])
        self.assertEqual(result["cause"], CAUSE_MODE_BITS)
        self.assertEqual(result["blocking"]["kind"], "file")

    def test_group_match_is_honored(self):
        """A group-readable file whose group is the web server's is fine."""
        _root, _dirs, video = self.make_tree()
        fake_stat = os.stat_result(
            (stat.S_IFREG | 0o640, 0, 0, 1, 0, FAKE_WEBSERVER_GID, 0, 0, 0, 0)
        )
        real_stat = os.stat

        def stat_with_webserver_group(path, *args, **kwargs):
            if path == video:
                return fake_stat
            return real_stat(path, *args, **kwargs)

        with mock.patch("api.serving_permissions.os.stat", stat_with_webserver_group):
            result = diagnose_media_path(video)

        self.assertTrue(result["readable_by_webserver"])

    def test_missing_file_is_distinguished_from_a_permission_problem(self):
        _root, _dirs, video = self.make_tree()
        os.remove(video)

        result = diagnose_media_path(video)

        self.assertFalse(result["exists"])
        self.assertEqual(result["cause"], CAUSE_MISSING)
        self.assertEqual(result["remedies"], [])

    def test_reported_webserver_ids_come_from_settings(self):
        _root, _dirs, video = self.make_tree()

        result = diagnose_media_path(video)

        self.assertEqual(
            result["webserver"], {"uid": FAKE_WEBSERVER_UID, "gid": FAKE_WEBSERVER_GID}
        )


@override_settings(WEBSERVER_UID=FAKE_WEBSERVER_UID, WEBSERVER_GID=FAKE_WEBSERVER_GID)
class RemedySelectionTest(_TreeMixin, SimpleTestCase):
    """Which *kind* of fix gets suggested has to follow the storage.

    Recommending chmod on a NAS share is not a harmless imprecision: it appears
    to succeed, changes nothing, and costs the admin the afternoon that this
    whole feature exists to give back.
    """

    def _mounts_dir(self):
        directory = tempfile.mkdtemp(prefix="librephotos-mounts-")
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        return directory

    def _diagnose_with_mounts(self, video, entries):
        mounts = _mounts_file(self._mounts_dir(), entries)
        with mock.patch("api.serving_permissions.PROC_MOUNTS", mounts):
            return diagnose_media_path(video)

    def test_local_posix_filesystem_gets_chmod(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = self._diagnose_with_mounts(
            video, [("/dev/sda1", "/", "ext4", "rw,relatime")]
        )

        self.assertEqual(result["mount"]["type"], "ext4")
        self.assertFalse(result["mount"]["permissions_from_mount"])
        self.assertEqual(result["remedies"], [REMEDY_CHMOD])

    def test_cifs_share_is_told_to_edit_mount_options_not_chmod(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = self._diagnose_with_mounts(
            video,
            [
                ("/dev/sda1", "/", "ext4", "rw,relatime"),
                ("//nas/photos", os.path.dirname(video), "cifs", "rw,uid=1000"),
            ],
        )

        self.assertTrue(result["mount"]["permissions_from_mount"])
        self.assertIn(REMEDY_MOUNT_OPTIONS, result["remedies"])
        self.assertNotIn(REMEDY_CHMOD, result["remedies"])

    def test_ntfs_via_ntfs_3g_is_recognised_under_its_fuseblk_name(self):
        """ntfs-3g never says "ntfs" in /proc/mounts, and it is very common."""
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = self._diagnose_with_mounts(
            video,
            [
                ("/dev/sda1", "/", "ext4", "rw,relatime"),
                (
                    "/dev/sdb1",
                    os.path.dirname(video),
                    "fuseblk",
                    "rw,uid=1000,fmask=0177",
                ),
            ],
        )

        self.assertTrue(result["mount"]["permissions_from_mount"])
        self.assertIn(REMEDY_MOUNT_OPTIONS, result["remedies"])
        self.assertNotIn(REMEDY_CHMOD, result["remedies"])

    def test_read_only_mount_is_flagged_before_anything_else_is_suggested(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = self._diagnose_with_mounts(
            video,
            [
                ("/dev/sda1", "/", "ext4", "rw,relatime"),
                ("/dev/sdb1", os.path.dirname(video), "ext4", "ro,relatime"),
            ],
        )

        self.assertTrue(result["mount"]["read_only"])
        self.assertEqual(result["remedies"][0], REMEDY_READ_ONLY)

    def test_nfs_export_mentions_the_server_side(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        result = self._diagnose_with_mounts(
            video,
            [
                ("/dev/sda1", "/", "ext4", "rw,relatime"),
                ("nas:/photos", os.path.dirname(video), "nfs4", "rw,relatime"),
            ],
        )

        self.assertTrue(result["mount"]["network"])
        self.assertIn(REMEDY_NETWORK_FS, result["remedies"])

    def test_closed_library_root_suggests_mounting_deeper_first(self):
        """Opening up a home directory is a security change, not a fix.

        When the blocking directory *is* the data root, the honest advice is to
        bind-mount the photo folders directly rather than widen a parent that
        has every reason to stay private.
        """
        _root, dirs, video = self.make_tree(depth=2)
        os.chmod(dirs[0], 0o750)

        with override_settings(DATA_ROOT=dirs[0]):
            result = self._diagnose_with_mounts(
                video, [("/dev/sda1", "/", "ext4", "rw,relatime")]
            )

        self.assertEqual(result["blocking"]["path"], dirs[0])
        self.assertEqual(result["remedies"][0], REMEDY_MOUNT_DEEPER)
        self.assertIn(REMEDY_CHMOD, result["remedies"])

    def test_unreadable_proc_mounts_degrades_instead_of_raising(self):
        _root, _dirs, video = self.make_tree()
        os.chmod(video, 0o640)

        with mock.patch(
            "api.serving_permissions.PROC_MOUNTS", "/nonexistent/proc/mounts"
        ):
            result = diagnose_media_path(video)

        self.assertIsNone(result["mount"])
        self.assertEqual(result["cause"], CAUSE_MODE_BITS)

    def test_mount_points_with_spaces_are_unescaped(self):
        mounts = _mounts_file(
            self._mounts_dir(), [("/dev/sdb1", "/media/My\\040Photos", "ext4", "rw")]
        )
        with mock.patch("api.serving_permissions.PROC_MOUNTS", mounts):
            described = describe_mount("/media/My Photos/holiday/clip.mp4")

        self.assertIsNotNone(described)
        self.assertEqual(described["point"], "/media/My Photos")


class ServeFileDirectPermissionTest(SimpleTestCase):
    """No-proxy installs must not report a permission error as "not found".

    Django serves the file itself when ``SERVE_FRONTEND`` is on, and the old
    handler folded ``PermissionError`` into a 404. That sends the admin looking
    for a file that is sitting right there, and it destroys the only signal the
    frontend has: a ``<video>`` element exposes no HTTP status, so the status
    code is the entire diagnosis.
    """

    def test_permission_error_is_403_not_404(self):
        handle, path = tempfile.mkstemp(prefix="librephotos-direct-")
        os.close(handle)
        self.addCleanup(os.remove, path)

        with mock.patch("builtins.open", side_effect=PermissionError("denied")):
            response = UnifiedMediaAccessView()._serve_file_direct(path)

        self.assertEqual(response.status_code, 403)

    def test_absent_file_is_still_404(self):
        response = UnifiedMediaAccessView()._serve_file_direct(
            "/nonexistent/library/clip.mp4"
        )

        self.assertEqual(response.status_code, 404)


class MediaDiagnosticsEndpointTest(TestCase):
    """The answer names filesystem paths, so only administrators may ask."""

    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.regular = create_test_user()
        self.client = APIClient()

    def _url(self, identifier):
        return f"/api/media/diagnostics/{identifier}/"

    def test_admin_receives_a_diagnosis(self):
        photo = create_test_photo(owner=self.admin)
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(self._url(photo.image_hash))

        self.assertEqual(response.status_code, 200)
        self.assertIn("cause", response.json())
        self.assertIn("webserver", response.json())

    def test_photo_is_also_addressable_by_uuid(self):
        photo = create_test_photo(owner=self.admin)
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(self._url(photo.pk))

        self.assertEqual(response.status_code, 200)

    def test_regular_user_is_refused(self):
        photo = create_test_photo(owner=self.regular)
        self.client.force_authenticate(user=self.regular)

        response = self.client.get(self._url(photo.image_hash))

        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_refused(self):
        photo = create_test_photo(owner=self.admin)

        response = self.client.get(self._url(photo.image_hash))

        self.assertIn(response.status_code, (401, 403))

    def test_unknown_photo_is_404(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(self._url("0" * 32))

        self.assertEqual(response.status_code, 404)

    def test_detached_photo_reports_missing_rather_than_erroring(self):
        """A scan that lost the file leaves no path to inspect."""
        photo = create_test_photo(owner=self.admin)
        photo.main_file = None
        photo.save()
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(self._url(photo.image_hash))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cause"], CAUSE_MISSING)


class AuthenticationForbiddenIsMarkedTest(TestCase):
    """Django's own 403 on a media URL must be distinguishable from nginx's.

    Both arrive at the browser as a bare 403 with an HTML body, and they call
    for opposite responses: sign in again, versus fix the permissions on the
    library. Since a ``<video>`` element hands the frontend no body to inspect,
    the marker header is the only thing separating them.
    """

    def test_missing_session_is_marked_as_an_authentication_failure(self):
        photo = create_test_photo(owner=create_test_user())

        response = self.client.get(f"/media/photos/{photo.image_hash}.mp4")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers.get("X-Media-Error"), "authentication")
