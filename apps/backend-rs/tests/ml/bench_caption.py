"""Seconds per caption and resident memory of the Python LFM2.5-VL captioner
(service/image_captioning/lfm2_vl.py), the twin of
`cargo run -p lp-ml --example caption_bench -- <model dir> <image>...`.

    python bench_caption.py <model dir> <image>...
"""

import sys
import threading
import time

import golden_common as gc

gc.setup("service/image_captioning")

import psutil  # noqa: E402

proc = psutil.Process()


def rss_mb():
    return proc.memory_info().rss / 1048576


def main():
    model_dir, images = sys.argv[1], sys.argv[2:]
    peak = [0.0]
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            peak[0] = max(peak[0], rss_mb())
            time.sleep(0.02)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()

    base = rss_mb()
    import onnxruntime  # noqa: F401
    from lfm2_vl import DEFAULT_PROMPT, Lfm2VlCaptioner

    ort = rss_mb()
    cap = Lfm2VlCaptioner(model_dir)
    t = time.perf_counter()
    cap.load()
    load_secs = time.perf_counter() - t
    loaded = rss_mb()
    print(
        f"python baseline {base:.1f} MB, ORT+numpy {ort:.1f} MB, "
        f"model loaded {loaded:.1f} MB (load {load_secs:.2f} s)"
    )

    ids = {}
    inner = cap._decode

    def decode(embeds, n):
        ids["v"] = inner(embeds, n)
        return ids["v"]

    cap._decode = decode
    secs = tokens = 0
    for img in images:
        t = time.perf_counter()
        caption = cap.caption(img, DEFAULT_PROMPT)
        s = time.perf_counter() - t
        secs += s
        tokens += len(ids["v"])
        print(f"python {s:6.2f} s {len(ids['v']):3} tok  {caption}")
    stop.set()
    sampler.join()
    after = rss_mb()
    print(
        f"python mean {secs / max(1, len(images)):.2f} s/caption, {tokens / secs:.1f} tok/s; "
        f"RSS after {after:.1f} MB, peak {peak[0]:.1f} MB; model delta {loaded - ort:.1f} MB "
        f"(peak {peak[0] - ort:.1f} MB over ORT)"
    )


if __name__ == "__main__":
    main()
