"""Import for its side effect: on Windows every subprocess this process starts
gets CREATE_NO_WINDOW, so the harness (run without a console) does not pop up
a console window for psql, ffmpeg, exiftool, lpbench or the servers."""

import os
import subprocess

if os.name == "nt" and not getattr(subprocess.Popen, "_lp_no_window", False):
    _init = subprocess.Popen.__init__

    def _init_no_window(self, *args, creationflags=0, **kwargs):
        _init(self, *args, creationflags=creationflags | subprocess.CREATE_NO_WINDOW, **kwargs)

    subprocess.Popen.__init__ = _init_no_window
    subprocess.Popen._lp_no_window = True
