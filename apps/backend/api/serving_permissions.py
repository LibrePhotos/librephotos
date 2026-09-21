"""Explain why the web server could not read an original media file.

Serving an original is nginx's job, not Django's: the backend authorizes the
request and hands off with ``X-Accel-Redirect`` (see
``UnifiedMediaAccessView._generate_response_proxy``). nginx's workers run as a
far less privileged user than the backend -- uid 101 in the stock proxy image,
while the backend runs as root -- so the scanner happily indexes and thumbnails
files that nginx then cannot open. nginx answers ``EACCES`` with its own 403
page, the browser reports nothing richer than "the video could not be loaded",
and the administrator is left guessing. Issue #714 has been open on that guess
since 2022.

Nothing in this module participates in serving media. It runs only once a
request has already failed, and it deliberately reports what it can *verify*
rather than what is merely likely: which component of the path the web server
cannot get through, and what kind of filesystem that component lives on. That
second half matters more than it looks, because the remedy is not the same
twice over. ``chmod`` fixes a local ext4 library; it is a silent no-op on a
CIFS share or an NTFS drive, where the mode bits are manufactured from mount
options; and it is worse than useless on a host where the bits are already
correct and SELinux is the one saying no.
"""

import os
import stat

from django.conf import settings

# Filesystems that synthesise mode bits at mount time from ``uid=``/``gid=``/
# ``umask=``/``file_mode=`` and friends. chmod against these either fails or,
# worse, appears to succeed and changes nothing -- so the diagnostic must never
# recommend it here. ``fuseblk`` is how ntfs-3g shows up in /proc/mounts.
MOUNT_OPTION_FILESYSTEMS = frozenset(
    {
        "cifs",
        "smbfs",
        "smb3",
        "vfat",
        "msdos",
        "exfat",
        "ntfs",
        "ntfs3",
        "fuseblk",
        "iso9660",
        "udf",
        "sshfs",
        "fuse.sshfs",
    }
)

# Filesystems where the authority over permissions lives on another machine, so
# even a successful local chmod may be squashed or ignored.
NETWORK_FILESYSTEMS = frozenset(
    {"nfs", "nfs4", "cifs", "smbfs", "smb3", "sshfs", "fuse.sshfs"}
)

CAUSE_MISSING = "missing"
CAUSE_MODE_BITS = "mode_bits"
CAUSE_NOT_MODE_BITS = "not_mode_bits"
CAUSE_UNKNOWN = "unknown"

REMEDY_CHMOD = "chmod"
REMEDY_MOUNT_OPTIONS = "mount_options"
REMEDY_MOUNT_DEEPER = "mount_deeper"
REMEDY_READ_ONLY = "read_only"
REMEDY_NETWORK_FS = "network_fs"
REMEDY_LABELS = "labels"

PROC_MOUNTS = "/proc/mounts"


def webserver_ids():
    """The uid/gid nginx serves originals as, as far as this install knows."""
    return (
        int(getattr(settings, "WEBSERVER_UID", 101)),
        int(getattr(settings, "WEBSERVER_GID", 101)),
    )


def _permits(st, uid, gid, user_bit, group_bit, other_bit):
    """Does ``st`` grant this bit to ``uid``/``gid`` under POSIX rules?

    Owner is checked first, then group, and neither falls through to the class
    below it: a file *owned* by the web server with mode 0077 is unreadable to
    the web server no matter how generous the other bits look. Getting this
    wrong in the lenient direction is the expensive mistake -- it would have
    the diagnostic pronounce a broken library healthy and send the admin off
    to look somewhere else entirely.
    """
    if st.st_uid == uid:
        return bool(st.st_mode & user_bit)
    if st.st_gid == gid:
        return bool(st.st_mode & group_bit)
    return bool(st.st_mode & other_bit)


def _can_traverse(st, uid, gid):
    return _permits(st, uid, gid, stat.S_IXUSR, stat.S_IXGRP, stat.S_IXOTH)


def _can_read(st, uid, gid):
    return _permits(st, uid, gid, stat.S_IRUSR, stat.S_IRGRP, stat.S_IROTH)


def _ancestors(path):
    """``/data/a/b.mp4`` -> ``["/", "/data", "/data/a"]``, outermost first.

    Every one of these has to be traversable, not just the directory the file
    sits in. The failure we keep meeting in the wild is a mode 750 directory
    several levels *above* the photos, so walking only the immediate parent
    would miss the actual culprit.
    """
    parent = os.path.dirname(os.path.normpath(path))
    chain = []
    while True:
        chain.append(parent)
        nxt = os.path.dirname(parent)
        if nxt == parent:
            break
        parent = nxt
    return list(reversed(chain))


def _unescape_mount_field(value):
    """Undo the octal escaping the kernel applies to /proc/mounts fields."""
    for escaped, raw in (
        ("\\040", " "),
        ("\\011", "\t"),
        ("\\012", "\n"),
        ("\\134", "\\"),
    ):
        value = value.replace(escaped, raw)
    return value


def _read_mounts():
    try:
        with open(PROC_MOUNTS, encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError:
        return []

    mounts = []
    for line in lines:
        fields = line.split()
        if len(fields) < 4:
            continue
        mounts.append(
            {
                "source": _unescape_mount_field(fields[0]),
                "point": _unescape_mount_field(fields[1]),
                "type": fields[2],
                "options": fields[3].split(","),
            }
        )
    return mounts


def describe_mount(path):
    """The mount backing ``path``: the entry with the longest matching prefix.

    This is what lets the diagnostic tell a local ext4 library apart from a NAS
    share or an external NTFS drive, which is the difference between advice
    that works and advice that quietly does nothing.
    """
    path = os.path.normpath(path)
    best = None
    for mount in _read_mounts():
        point = os.path.normpath(mount["point"])
        if path == point or path.startswith(point.rstrip("/") + "/") or point == "/":
            if best is None or len(point) > len(os.path.normpath(best["point"])):
                best = mount
    if best is None:
        return None

    options = best["options"]
    return {
        "point": best["point"],
        "type": best["type"],
        "options": options,
        "read_only": "ro" in options,
        "permissions_from_mount": best["type"] in MOUNT_OPTION_FILESYSTEMS,
        "network": best["type"] in NETWORK_FILESYSTEMS,
    }


def _describe_component(path, st, kind):
    return {
        "path": path,
        "kind": kind,
        "mode": format(stat.S_IMODE(st.st_mode), "04o"),
        "uid": st.st_uid,
        "gid": st.st_gid,
    }


def _remedies(cause, blocking, mount):
    """Order the remedies worth trying, most applicable first.

    Deliberately conservative: the aim is to name the class of fix the evidence
    actually supports, not to hand out a command that might be a no-op on the
    reader's storage.
    """
    if cause == CAUSE_NOT_MODE_BITS:
        # The bits already permit it and the request still failed, so whatever
        # is denying access is not something chmod can reach.
        return [REMEDY_LABELS]

    if cause != CAUSE_MODE_BITS:
        return []

    remedies = []
    data_root = os.path.normpath(getattr(settings, "DATA_ROOT", "/data"))
    if blocking and os.path.normpath(blocking["path"]) in (data_root, "/"):
        # The library root itself, or something above it, is closed. Opening up
        # a home directory to satisfy nginx is a real security change, and the
        # better answer is usually to mount the photo folder directly instead
        # of a parent that has every reason to stay private.
        remedies.append(REMEDY_MOUNT_DEEPER)

    if mount and mount["read_only"]:
        remedies.append(REMEDY_READ_ONLY)
    if mount and mount["permissions_from_mount"]:
        remedies.append(REMEDY_MOUNT_OPTIONS)
    elif mount and mount["network"]:
        remedies.append(REMEDY_NETWORK_FS)
    else:
        remedies.append(REMEDY_CHMOD)

    if mount and mount["network"] and REMEDY_NETWORK_FS not in remedies:
        remedies.append(REMEDY_NETWORK_FS)
    return remedies


def diagnose_media_path(path):
    """Report why the web server cannot serve ``path``.

    Returns a description rather than a verdict: ``cause`` says what the
    evidence supports, ``blocking`` names the exact component responsible when
    the mode bits are to blame, and ``remedies`` lists the *kinds* of fix that
    apply to this storage. The caller renders it; this function never guesses
    past what it checked.
    """
    uid, gid = webserver_ids()
    path = os.path.normpath(path)
    result = {
        "path": path,
        "exists": True,
        "readable_by_webserver": False,
        "cause": CAUSE_UNKNOWN,
        "blocking": None,
        "webserver": {"uid": uid, "gid": gid},
        "mount": describe_mount(path),
        "remedies": [],
    }

    for directory in _ancestors(path):
        try:
            st = os.stat(directory)
        except FileNotFoundError:
            result["exists"] = False
            result["cause"] = CAUSE_MISSING
            result["blocking"] = {"path": directory, "kind": "directory"}
            return result
        except OSError:
            # The backend is root almost everywhere, so a stat it cannot
            # perform is itself evidence of something beyond mode bits.
            result["cause"] = CAUSE_NOT_MODE_BITS
            result["blocking"] = {"path": directory, "kind": "directory"}
            result["remedies"] = _remedies(
                CAUSE_NOT_MODE_BITS, result["blocking"], result["mount"]
            )
            return result

        if not _can_traverse(st, uid, gid):
            result["cause"] = CAUSE_MODE_BITS
            result["blocking"] = _describe_component(directory, st, "directory")
            result["remedies"] = _remedies(
                CAUSE_MODE_BITS, result["blocking"], result["mount"]
            )
            return result

    try:
        st = os.stat(path)
    except FileNotFoundError:
        result["exists"] = False
        result["cause"] = CAUSE_MISSING
        result["blocking"] = {"path": path, "kind": "file"}
        return result
    except OSError:
        result["cause"] = CAUSE_NOT_MODE_BITS
        result["blocking"] = {"path": path, "kind": "file"}
        result["remedies"] = _remedies(
            CAUSE_NOT_MODE_BITS, result["blocking"], result["mount"]
        )
        return result

    if not _can_read(st, uid, gid):
        result["cause"] = CAUSE_MODE_BITS
        result["blocking"] = _describe_component(path, st, "file")
        result["remedies"] = _remedies(
            CAUSE_MODE_BITS, result["blocking"], result["mount"]
        )
        return result

    # Every bit along the way permits it, yet the request that brought us here
    # failed. That is a genuinely useful finding rather than an empty one: it
    # rules out the entire family of permission fixes and points at SELinux or
    # AppArmor labelling, a user-namespace remapped runtime, or a proxy image
    # whose nginx does not run as the uid this install assumes.
    result["readable_by_webserver"] = True
    result["cause"] = CAUSE_NOT_MODE_BITS
    result["remedies"] = _remedies(CAUSE_NOT_MODE_BITS, None, result["mount"])
    return result
