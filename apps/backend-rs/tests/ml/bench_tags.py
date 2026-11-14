"""Per-photo latency and resident memory of the Python taggers on the
fixture's big thumbnails; counterpart of the Rust `bench_tagger_latency_and_memory`
test (crates/lp-ml/tests/tags.rs). Imports the model code directly, no sidecar.

    python bench_tags.py [mobileclip_s2|siglip2 ...]

Each model is measured in a fresh process so the RSS deltas do not mix.
"""

import os
import subprocess
import sys
import time

if not sys.flags.utf8_mode:
    sys.exit(subprocess.call([sys.executable, "-X", "utf8", *sys.argv]))

import golden_common as gc  # noqa: E402

gc.setup("service/tags")

import psutil  # noqa: E402

MODELS = {"mobileclip_s2": 0.02, "siglip2": 0.05}


def rss_mb():
    return psutil.Process(os.getpid()).memory_info().rss / 1e6


def bench(model):
    import onnxruntime  # noqa: F401  (import cost is not the model's)
    from PIL import Image  # noqa: F401

    before = rss_mb()
    if model == "mobileclip_s2":
        from mobileclip.mobileclip import MobileCLIP as cls
    else:
        from siglip2.siglip2 import SigLIP2 as cls
    t0 = time.perf_counter()
    tagger = cls()
    tagger.load()
    load = time.perf_counter() - t0
    loaded = rss_mb()
    images = sorted((gc.FIXTURE / "protected_media" / "thumbnails_big").glob("*.webp"))
    tagger.predict(str(images[0]), threshold=MODELS[model], max_tags=10)
    ms = []
    for p in images:
        s = time.perf_counter()
        tagger.predict(str(p), threshold=MODELS[model], max_tags=10)
        ms.append((time.perf_counter() - s) * 1000)
    after = rss_mb()
    ms.sort()
    print(
        f"{model} (python): load {load:.2f}s | {len(ms)} images: mean {sum(ms) / len(ms):.1f} ms, "
        f"p50 {ms[len(ms) // 2]:.1f} ms, max {ms[-1]:.1f} ms | RSS {before:.0f} MB -> loaded "
        f"{loaded:.0f} MB (+{loaded - before:.0f}) -> after inference {after:.0f} MB (+{after - before:.0f})"
    )


if __name__ == "__main__":
    models = sys.argv[1:] or list(MODELS)
    if len(models) == 1:
        bench(models[0])
    else:
        for m in models:
            subprocess.call([sys.executable, "-X", "utf8", sys.argv[0], m])
