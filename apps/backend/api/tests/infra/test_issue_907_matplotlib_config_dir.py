"""Regression test for issue #907 - "Error creating Matplotlib cache".

https://github.com/LibrePhotos/librephotos/issues/907

LibrePhotos never points ``MPLCONFIGDIR`` at a writable, persistent directory.
Matplotlib is still part of the production dependency tree (``insightface``
requires it unconditionally, and ``service/face_recognition/main.py`` imports
``insightface.app``), so every LibrePhotos process that touches it inherits
matplotlib's default lookup: ``$MPLCONFIGDIR`` -> ``$XDG_CONFIG_HOME`` ->
``~/.config``.

In the reporter's container the home directory resolves to ``/``, which is not
writable, so matplotlib falls back to a brand new ``/tmp/matplotlib-XXXXXXXX``
directory on *every* process start and logs::

    Matplotlib created a temporary config/cache directory at
    /tmp/matplotlib-y6irp9ju because the default path (/.config/matplotlib) is
    not a writable directory; it is highly recommended to set the MPLCONFIGDIR
    environment variable to a writable directory, [...]

The font cache is therefore rebuilt from scratch for every worker and every
service restart. Fixing it means LibrePhotos itself exporting MPLCONFIGDIR to a
directory it owns (e.g. under ``BASE_DATA``/``BASE_LOGS``) before matplotlib is
imported; because ``api.services.start_service`` spawns the ML services with
``subprocess.Popen`` they inherit whatever the Django process exported.

The tests below simulate the reporter's environment (home directory that cannot
be created) and assert the correct behaviour: the matplotlib cache directory
must be stable and LibrePhotos-owned, not a throwaway temp directory.
"""

import json
import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parents[1]

# Environment variables matplotlib consults when resolving its config/cache
# directory. They are cleared so the child process starts from the same blank
# slate a freshly started container has.
_HOME_VARS = (
    "MPLCONFIGDIR",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
)

_PROBE = textwrap.dedent(
    """
    import json, os, sys, tempfile
    from pathlib import Path

    sys.path.insert(0, sys.argv[1])
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "librephotos.settings.production")

    import django

    django.setup()

    # This is what service/face_recognition/main.py ends up doing through
    # insightface: importing matplotlib and materialising its cache directory.
    import matplotlib

    cachedir = matplotlib.get_cachedir()
    sys.stdout.write(
        "REPRO_JSON:"
        + json.dumps(
            {
                "cachedir": cachedir,
                "configdir": matplotlib.get_configdir(),
                "system_tempdir": tempfile.gettempdir(),
                "fell_back_to_tempdir": (
                    Path(cachedir).name.startswith("matplotlib-")
                    and Path(cachedir).parent == Path(tempfile.gettempdir())
                ),
            }
        )
        + "\\n"
    )
    """
)


class MatplotlibCacheDirIssue907Test(SimpleTestCase):
    """The matplotlib cache directory must survive an unwritable home dir."""

    def _probe(self, sandbox):
        """Start a LibrePhotos python process with an unwritable home directory."""
        blocked = sandbox / "not-a-directory"
        if not blocked.exists():
            blocked.write_text("this is a regular file, not a directory")
        # Any path below `blocked` is impossible to mkdir -> exactly the
        # "default path is not a writable directory" situation from the report.
        fake_home = blocked / "home"

        logs = sandbox / "logs"
        logs.mkdir(exist_ok=True)

        env = {k: v for k, v in os.environ.items() if k not in _HOME_VARS}
        env["HOME"] = str(fake_home)
        env["USERPROFILE"] = str(fake_home)
        env["LOCALAPPDATA"] = str(fake_home)
        env["XDG_CONFIG_HOME"] = str(fake_home / ".config")
        env["XDG_CACHE_HOME"] = str(fake_home / ".cache")
        env["BASE_DATA"] = str(sandbox)
        env["BASE_LOGS"] = str(logs)
        env["SECRET_KEY"] = "test-secret-key"
        env["DJANGO_SETTINGS_MODULE"] = "librephotos.settings.production"

        script = sandbox / "probe_907.py"
        script.write_text(_PROBE)

        result = subprocess.run(
            [sys.executable, str(script), str(BACKEND_DIR)],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        payload = None
        for line in result.stdout.splitlines():
            if line.startswith("REPRO_JSON:"):
                payload = json.loads(line[len("REPRO_JSON:") :])
        if payload is None:
            self.fail(
                "probe process did not report a matplotlib cache directory\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        payload["stderr"] = result.stderr
        return payload

    def test_matplotlib_cache_dir_is_persistent_when_home_is_not_writable(self):
        with TemporaryDirectory(prefix="lp907-") as tmp:
            sandbox = Path(tmp)
            first = self._probe(sandbox)
            second = self._probe(sandbox)

        self.assertFalse(
            first["fell_back_to_tempdir"],
            "LibrePhotos did not configure MPLCONFIGDIR, so matplotlib fell back "
            "to a throwaway temporary cache directory "
            f"({first['cachedir']}) - issue #907.\n"
            f"matplotlib said:\n{first['stderr'].strip()}",
        )
        self.assertEqual(
            first["cachedir"],
            second["cachedir"],
            "Every LibrePhotos process gets a fresh matplotlib cache directory "
            "and has to rebuild the font cache from scratch - issue #907.",
        )

    def test_startup_exports_a_writable_mplconfigdir(self):
        """Some part of the shipped startup surface must export MPLCONFIGDIR."""
        candidates = [
            BACKEND_DIR / "librephotos" / "settings" / "production.py",
            BACKEND_DIR / "librephotos" / "settings" / "__init__.py",
            BACKEND_DIR / "librephotos" / "wsgi.py",
            BACKEND_DIR / "manage.py",
            REPO_ROOT / "deploy" / "docker" / "backend" / "entrypoint.sh",
            REPO_ROOT / "deploy" / "docker" / "backend-gpu" / "entrypoint.sh",
            REPO_ROOT / "deploy" / "docker" / "unified" / "entrypoint.sh",
            REPO_ROOT / "deploy" / "docker" / "backend" / "Dockerfile",
            REPO_ROOT / "deploy" / "docker" / "backend" / "base" / "Dockerfile",
            REPO_ROOT / "deploy" / "compose" / "librephotos.env",
            REPO_ROOT / "deploy" / "compose" / "docker-compose.yml",
        ]
        existing = [path for path in candidates if path.is_file()]
        if not existing:
            raise unittest.SkipTest("no startup files available in this checkout")

        configured = [
            str(path)
            for path in existing
            if "MPLCONFIGDIR" in path.read_text(encoding="utf-8", errors="replace")
        ]
        self.assertTrue(
            configured,
            "No LibrePhotos startup file sets MPLCONFIGDIR, so matplotlib "
            "recreates its cache directory on every process start when the "
            "home directory is not writable - issue #907. Checked:\n"
            + "\n".join(f"  - {path}" for path in existing),
        )
