"""Validate ExifTool tag names and media paths before they become arguments.

The exif sidecar drives ExifTool in ``-stay_open`` mode: every argument is a
line written to ExifTool's stdin (PyExifTool joins them with ``\n`` and ends
the batch with ``-execute``). A tag name is passed as ``-<tag>``, so a tag
that is not a plain tag name escapes the read it was meant to be:

* a tag containing ``=`` turns the read into a write or rename --
  ``FileName=../evil.jpg`` renames the media file, ``all=`` wipes its
  metadata;
* a tag containing a line break injects further ExifTool options --
  ``-if`` followed by a Perl expression runs arbitrary code in the sidecar
  process, ``-o`` / ``-@`` / ``-execute`` redirect or re-batch the command.

Tag names reach the sidecar from the user's ``burst_detection_rules`` and
``datetime_rules`` (the tag before ``//`` in a ``condition_exif``, and a
datetime rule's ``exif_tag``), which any authenticated user can PATCH onto
their own profile. Media paths reach it as the files to read; a path is not
user-typed, but a line break in one would inject arguments just the same, so
it is rejected here as defense in depth.

This module has no Django or Flask dependency on purpose: the sidecar imports
it as ``service.exif.tag_validation`` and so does ``api`` when it validates
saved rules, so both sides apply exactly the same rule. Mirror of the Rust
port's ``is_safe_tag`` (apps/backend-rs .../jobs/exif.rs).
"""

import re

# A real ExifTool tag name: an alphanumeric/underscore first character, then
# up to 127 more of the characters that appear in genuine tags -- a family or
# group prefix (``XMP-dc:``), the wildcard language suffix (``Description-*``),
# and the numeric ``#`` / ``?`` forms. Notably absent: ``=`` (write/rename),
# whitespace and line breaks (argument injection), and a leading ``-`` (an
# option rather than a tag). 128 characters is well past the longest real tag.
_TAG_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_:*?#-]{0,127}$")


def is_safe_tag_name(tag):
    """True when *tag* is a plain ExifTool tag name safe to pass as ``-<tag>``."""
    return isinstance(tag, str) and _TAG_NAME.match(tag) is not None


def is_safe_media_path(path):
    """True when *path* carries no line break that would inject an argument."""
    return isinstance(path, str) and "\n" not in path and "\r" not in path
