"""Unit tests for api.util.is_valid_path, the containment guard used by the
folder browser, the dir-tree view and the scan-directory validator.

The POSIX and Windows cases run through ``_is_within`` with ``posixpath`` and
``ntpath`` directly, so both sets pin their semantics on whichever OS runs
the suite. All paths are absolute, so nothing depends on the working
directory or on what exists on disk.
"""

import ntpath
import os
import posixpath

from django.test import SimpleTestCase

from api.util import _is_within, is_valid_path


class PosixContainmentTests(SimpleTestCase):
    def check(self, path, root):
        return _is_within(path, root, posixpath)

    def test_root_itself_and_children_are_inside(self):
        self.assertTrue(self.check("/data/alice", "/data/alice"))
        self.assertTrue(self.check("/data/alice/", "/data/alice"))
        self.assertTrue(self.check("/data/alice/2024/trip", "/data/alice"))
        self.assertTrue(self.check("/data/alice/2024", "/data/alice/"))

    def test_sibling_sharing_the_prefix_is_outside(self):
        self.assertFalse(self.check("/data/alice2", "/data/alice"))
        self.assertFalse(self.check("/data/alice2/x", "/data/alice"))
        self.assertFalse(self.check("/data/alice-evil", "/data/alice/"))

    def test_dot_dot_cannot_climb_out(self):
        self.assertFalse(self.check("/data/alice/../bob", "/data/alice"))
        self.assertFalse(self.check("/data/alice/../../etc", "/data/alice"))
        self.assertFalse(self.check("/data/alice/x/../..", "/data/alice"))
        self.assertTrue(self.check("/data/alice/x/../y", "/data/alice"))

    def test_parent_is_outside(self):
        self.assertFalse(self.check("/data", "/data/alice"))
        self.assertFalse(self.check("/", "/data/alice"))

    def test_filesystem_root_admits_everything(self):
        # Regression: comparing against root + sep gave "//", which refused
        # every child of "/".
        self.assertTrue(self.check("/", "/"))
        self.assertTrue(self.check("/data", "/"))
        self.assertTrue(self.check("/data/alice/2024", "/"))
        self.assertTrue(self.check("/data/../etc", "/"))

    def test_case_is_significant(self):
        self.assertFalse(self.check("/Data/alice", "/data/alice"))


class WindowsContainmentTests(SimpleTestCase):
    def check(self, path, root):
        return _is_within(path, root, ntpath)

    def test_root_itself_and_children_are_inside(self):
        self.assertTrue(self.check(r"D:\Photos", r"D:\Photos"))
        self.assertTrue(self.check("D:\\Photos\\", r"D:\Photos"))
        self.assertTrue(self.check(r"D:\Photos\2024\trip", r"D:\Photos"))

    def test_sibling_sharing_the_prefix_is_outside(self):
        self.assertFalse(self.check(r"D:\Photos2", r"D:\Photos"))
        self.assertFalse(self.check(r"D:\Photos-evil\x", r"D:\Photos"))

    def test_dot_dot_cannot_climb_out(self):
        self.assertFalse(self.check(r"D:\Photos\..\Secrets", r"D:\Photos"))
        self.assertFalse(self.check("D:/Photos/../Secrets", r"D:\Photos"))
        self.assertTrue(self.check(r"D:\Photos\a\..\b", r"D:\Photos"))

    def test_drive_root_admits_everything_on_that_drive(self):
        # Regression: the standalone build lets the user pick D:\ as the
        # photo folder; root + sep was "D:\\\\" and refused every subfolder.
        self.assertTrue(self.check("D:\\", "D:\\"))
        self.assertTrue(self.check(r"D:\Photos", "D:\\"))
        self.assertTrue(self.check(r"D:\Photos\2024", "D:\\"))
        self.assertTrue(self.check("D:/Photos/2024", "D:/"))

    def test_other_drive_is_outside(self):
        self.assertFalse(self.check(r"C:\Windows", "D:\\"))
        self.assertFalse(self.check(r"C:\Photos", r"D:\Photos"))

    def test_mixed_separators_and_case_are_normalised(self):
        self.assertTrue(self.check("D:/Photos/2024", r"D:\Photos"))
        self.assertTrue(self.check(r"D:\Photos\2024", "D:/Photos/"))
        self.assertTrue(self.check(r"d:\photos\2024", r"D:\Photos"))
        self.assertFalse(self.check("d:/photos2", r"D:\Photos"))

    def test_unc_share_root_admits_its_children(self):
        share = r"\\nas\photos"
        self.assertTrue(self.check(share, share))
        self.assertTrue(self.check(share + r"\2024", share))
        self.assertTrue(self.check(share + r"\2024", share + "\\"))
        self.assertFalse(self.check(r"\\nas\photos2", share))
        self.assertFalse(self.check(r"\\nas\other\2024", share))
        self.assertFalse(self.check(r"\\other\photos\2024", share))


class IsValidPathUsesTheHostPathModuleTests(SimpleTestCase):
    def test_filesystem_root_of_the_host(self):
        here = os.path.abspath(os.path.dirname(__file__))
        fs_root = os.path.splitdrive(here)[0] + os.sep
        self.assertTrue(is_valid_path(here, fs_root))
        self.assertTrue(is_valid_path(fs_root, fs_root))

    def test_sibling_and_escape_on_the_host(self):
        here = os.path.abspath(os.path.dirname(__file__))
        self.assertTrue(is_valid_path(os.path.join(here, "x"), here))
        self.assertFalse(is_valid_path(here + "2", here))
        self.assertFalse(is_valid_path(os.path.join(here, "..", "x"), here))
