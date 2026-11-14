"""Throughput (full big/m/s set per image) and peak memory per conversion.

    python throughput.py run --workers 1 [--secs 12] -> $LP_THUMBS_WORK/tp_w1.json
    python throughput.py run --workers 4             -> tp_w4.json
    python throughput.py mem                         -> mem.json
    python throughput.py run --workers 4 --renderers ffmpeg_yuv -> tp_w4_ffmpeg_yuv.json
    python throughput.py spawn                       -> spawn.json (bare ffmpeg start cost)

Renderers: vips (in-process pyvips, as lp-ingest calls libvips in-process),
ffmpeg (one ffmpeg process per image, split filter), ffmpeg_3proc (big from the
original, m and s each from big.webp: three processes, as api/thumbnails.py does).
Each cell (class x renderer) runs whole images for ~--secs seconds after one warm-up
image; images/s = images / wall time across the worker pool.

Peak memory: each conversion in a fresh process; the process handle stays open after
exit, so GetProcessMemoryInfo still reports its PeakWorkingSetSize / PeakPagefileUsage
(private). For vips the bare `python + import pyvips` peak is subtracted.
"""

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from multiprocessing import Pool
from pathlib import Path

from common import CORPUS, FFMPEG, WORK
from pipelines import RENDERERS, ffmpeg_cmd

CLASSES = {
    "jpeg_small (<=2 MP)": sorted((CORPUS / "mlcheck").glob("*.jpg"))[:40] + sorted((CORPUS / "fixture").glob("*.jpg"))[:20],
    "jpeg_12mp": [CORPUS / "gen" / "jpeg_12mp.jpg", CORPUS / "gen" / "jpeg_progressive.jpg",
                  CORPUS / "gen" / "orient_6_12mp.jpg"],
    "jpeg_24mp": [CORPUS / "gen" / "jpeg_24mp.jpg"],
    "png_6mp": [CORPUS / "gen" / "png_rgb.png"],
    "heic_12mp_grid": [CORPUS / "gen" / "heic_grid_12mp.heic"],
    "panorama_24mp": [CORPUS / "gen" / "panorama_12000x2000.jpg"],
}
RUN = ("vips", "ffmpeg", "ffmpeg_3proc")


def _work(args):
    how, path, i = args
    d = Path(tempfile.gettempdir()) / f"lp-thumbs-{os.getpid()}"
    d.mkdir(exist_ok=True)
    t = time.perf_counter()
    RENDERERS[how](path, d, f"x{i % 4}")
    return time.perf_counter() - t


def run(workers, secs, renderers=RUN):
    res = {}
    with Pool(workers) as pool:
        for cls, files in CLASSES.items():
            for how in renderers:
                pool.map(_work, [(how, files[0], k) for k in range(workers)])  # warm-up
                done, t0, k = 0, time.perf_counter(), 0
                per = []
                while time.perf_counter() - t0 < secs or done < 2 * workers:
                    batch = [(how, files[(k + j) % len(files)], k + j) for j in range(workers * 2)]
                    k += len(batch)
                    per += pool.map(_work, batch)
                    done += len(batch)
                wall = time.perf_counter() - t0
                res[f"{cls}|{how}"] = {"images": done, "wall_s": round(wall, 2),
                                       "images_per_s": round(done / wall, 2),
                                       "mean_latency_ms": round(1000 * sum(per) / len(per), 1)}
                print(cls, how, res[f"{cls}|{how}"], flush=True)
    for d in Path(tempfile.gettempdir()).glob("lp-thumbs-*"):
        shutil.rmtree(d, ignore_errors=True)
    return res


class PMC(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD)] + [
        (n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                       "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                                       "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]


def peak(cmd):
    p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    _, err = p.communicate()
    if p.returncode:
        raise RuntimeError(err.decode()[-300:])
    m = PMC()
    m.cb = ctypes.sizeof(PMC)
    ctypes.windll.psapi.GetProcessMemoryInfo(int(p._handle), ctypes.byref(m), m.cb)
    return m.PeakWorkingSetSize / 2**20, m.PeakPagefileUsage / 2**20


# The venv's python.exe is a launcher that runs the real interpreter as a child, so
# the child reports its own peaks.
VIPS_ONE = ("import sys, psutil; sys.path.insert(0, {here!r}); import pipelines, pyvips; "
            "pipelines._vips(); {body}; m = psutil.Process().memory_info(); "
            "print(m.peak_wset / 2**20, m.peak_pagefile / 2**20)")


def self_peak(cmd):
    out = subprocess.run(cmd, capture_output=True, check=True, text=True).stdout.split()
    return float(out[0]), float(out[1])


def mem():
    here = str(Path(__file__).resolve().parent)
    out = {}
    with tempfile.TemporaryDirectory() as d:
        base = [self_peak([sys.executable, "-c", VIPS_ONE.format(here=here, body="pass")]) for _ in range(3)]
        base = (min(b[0] for b in base), min(b[1] for b in base))
        out["python+pyvips baseline (ws, private) MiB"] = [round(x, 1) for x in base]
        for cls, files in CLASSES.items():
            f = files[0]
            body = f"pipelines.vips_render({str(f)!r}, {d!r})"
            v = [self_peak([sys.executable, "-c", VIPS_ONE.format(here=here, body=body)]) for _ in range(3)]
            grid = f.suffix.lower() == ".heic"
            ff = [peak(ffmpeg_cmd(f, d, grid=grid)) for _ in range(3)]
            out[cls] = {
                "vips_ws_mib": round(max(x[0] for x in v) - base[0], 1),
                "vips_private_mib": round(max(x[1] for x in v) - base[1], 1),
                "vips_process_ws_mib": round(max(x[0] for x in v), 1),
                "ffmpeg_ws_mib": round(max(x[0] for x in ff), 1),
                "ffmpeg_private_mib": round(max(x[1] for x in ff), 1),
            }
            print(cls, out[cls], flush=True)
    return out


def spawn():
    t = time.perf_counter()
    n = 30
    for _ in range(n):
        subprocess.run([str(FFMPEG), "-hide_banner", "-version"], capture_output=True, check=True)
    return {"ffmpeg_-version_ms": round(1000 * (time.perf_counter() - t) / n, 1)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["run", "mem", "spawn"])
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--secs", type=float, default=12)
    ap.add_argument("--renderers", default=",".join(RUN), help="e.g. ffmpeg_yuv")
    a = ap.parse_args()
    if a.what == "run":
        rs = tuple(a.renderers.split(","))
        suffix = "" if rs == RUN else "_" + "_".join(rs)
        r, name = run(a.workers, a.secs, rs), f"tp_w{a.workers}{suffix}.json"
    elif a.what == "mem":
        r, name = mem(), "mem.json"
    else:
        r, name = spawn(), "spawn.json"
        print(r)
    (WORK / name).write_text(json.dumps(r, indent=1))
