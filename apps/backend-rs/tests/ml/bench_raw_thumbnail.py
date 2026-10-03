"""Python side of crates/lp-ml/examples/raw_bench.rs: Django's RAW thumbnail
path per file (``image_decoding.raw_preview`` + webpsave, else the thumbnail
service's ``render_raw``), median latency and peak RSS above the process
after imports. Usage: ``python bench_raw_thumbnail.py <dng>... [--repeat N]``.
"""

import os
import sys
import tempfile
import threading
import time

import golden_common as gc

gc.setup("service/thumbnail")

import psutil  # noqa: E402

import main as thumbnail_service  # noqa: E402
from api import image_decoding  # noqa: E402

PROC = psutil.Process()


def thumbnail(src, out):
    preview = image_decoding.raw_preview(src, 1080)
    if preview is not None:
        preview.write_to_file(out, Q=95, effort=2)
        return "preview"
    thumbnail_service.render_raw(src, out, 1080)
    return "render"


def with_peak(fn):
    peak = [PROC.memory_info().rss]
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            peak[0] = max(peak[0], PROC.memory_info().rss)
            time.sleep(0.002)

    t = threading.Thread(target=sample)
    t.start()
    try:
        r = fn()
    finally:
        stop.set()
        t.join()
    return r, max(peak[0], PROC.memory_info().rss)


def main():
    args = sys.argv[1:]
    repeat = 5
    if "--repeat" in args:
        i = args.index("--repeat")
        repeat = int(args[i + 1])
        del args[i : i + 2]
    out = os.path.join(tempfile.mkdtemp(), "x.webp")
    idle = PROC.memory_info().rss
    print(f"idle RSS {idle / 1e6:.1f} MB")
    for f in args:
        times, peak, path = [], 0, ""
        for _ in range(repeat):
            t = time.perf_counter()
            path, pk = with_peak(lambda: thumbnail(f, out))
            times.append(time.perf_counter() - t)
            peak = max(peak, pk)
        times.sort()
        name = os.path.splitext(os.path.basename(f))[0]
        print(
            f"{name:24} {path:8} {times[len(times) // 2] * 1e3:7.0f}ms {times[0] * 1e3:7.0f}ms"
            f" {(peak - idle) / 1e6:9.1f} MB"
        )


if __name__ == "__main__":
    main()
