"""Print the markdown tables for FFMPEG_VS_LIBVIPS.md from $LP_THUMBS_WORK/*.json.

    python summarize.py > tables.md
"""

import json
import statistics as st

from common import WORK

R = ("vips", "ffmpeg", "ffmpeg_yuv")


def load(name):
    p = WORK / name
    return json.loads(p.read_text()) if p.exists() else None


def cell(d):
    if not d:
        return "-"
    if not d.get("ok"):
        return "FAIL: " + d.get("error", "")[:60]
    bits = [d.get("decoder", "")]
    if d.get("orientation") and d["orientation"] != "identity":
        bits.append(f"**{d['orientation']}**")
    if d.get("mode") == "RGBA":
        bits.append("alpha")
    if d.get("icc"):
        bits.append("ICC")
    if "deltaE_vs_srgb_ref" in d:
        de = d["deltaE_vs_srgb_ref"]
        bits.append(f"dE {de[0]}/{de[1]}" if isinstance(de, list) else f"dE {de}")
    if d.get("same_sizes_as_vips") is False:
        bits.append("**sizes differ**")
    if "phash_bits_vs_vips" in d:
        bits.append(f"pHash {d['phash_bits_vs_vips']}b")
    return ", ".join(b for b in bits if b)


def main():
    m = load("matrix.json")
    gen = [r for r in m if r["file"].startswith("gen__") or "heic" in r["file"] or "dng" in r["file"]]
    print("| file | source | libvips (pyvips-binary 8.18.6) | ffmpeg 9.0.1 RGB | ffmpeg YUV |")
    print("|---|---|---|---|---|")
    for r in gen:
        src = "x".join(map(str, r.get("source_size", []))) or "?"
        print(f"| {r['file']} | {src} | " + " | ".join(cell(r.get(k)) for k in R) + " |")

    print("\n## aggregate over the whole corpus\n")
    for k in ("ffmpeg", "ffmpeg_yuv"):
        ok = [r for r in m if r.get(k, {}).get("ok") and r.get("vips", {}).get("ok")]
        bits = [r[k]["phash_bits_vs_vips"] for r in ok]
        dims = sum(1 for r in ok if not r[k]["same_sizes_as_vips"])
        orient_bad = [r["file"] for r in m if r.get(k, {}).get("orientation") not in (None, "identity")]
        vorient_bad = [r["file"] for r in m if r.get("vips", {}).get("orientation") not in (None, "identity")]
        print(f"### {k}: {len(ok)} files both decode; size mismatches {dims}; "
              f"wrong orientation {orient_bad} (vips: {vorient_bad})")
        hist = {}
        for b in bits:
            hist[b] = hist.get(b, 0) + 1
        print(f"pHash Hamming distance vs libvips histogram: {dict(sorted(hist.items()))}; "
              f"identical {hist.get(0, 0)}/{len(bits)}; within 10 bits {sum(1 for b in bits if b <= 10)}")
        for s in ("big", "m", "s"):
            vv = [r[k]["vs_vips"][s] for r in ok if r[k].get("vs_vips", {}).get(s)]
            vp = [r[k]["vs_pillow"][s] for r in ok if r[k].get("vs_pillow", {}).get(s)]
            bp = [r["vips"]["vs_pillow"][s] for r in ok if r["vips"].get("vs_pillow", {}).get(s)]
            print(f"- {s}: vs libvips SSIM median {st.median(x[0] for x in vv):.4f} min {min(x[0] for x in vv):.4f}"
                  f" PSNR median {st.median(x[1] for x in vv):.2f} min {min(x[1] for x in vv):.2f};"
                  f" vs Pillow SSIM median {st.median(x[0] for x in vp):.4f} PSNR {st.median(x[1] for x in vp):.2f}"
                  f" (libvips vs Pillow: SSIM {st.median(x[0] for x in bp):.4f} PSNR {st.median(x[1] for x in bp):.2f})")
        worst = sorted(ok, key=lambda r: r[k]["vs_vips"]["big"][0])[:5]
        print("worst big SSIM vs vips:", [(r["file"], r[k]["vs_vips"]["big"]) for r in worst])
        fails = [(r["file"], r[k].get("error", "")[:80]) for r in m if not r.get(k, {}).get("ok")]
        print("failures:", fails)
        sz = [r[k]["bytes_big"] / r["vips"]["bytes_big"] for r in ok]
        print(f"big WebP bytes ffmpeg/vips median {st.median(sz):.3f}")
    leg = [r["vips_legacy"]["phash_bits_vs_vips"] for r in m if "phash_bits_vs_vips" in r.get("vips_legacy", {})]
    print(f"\nvips effort-default vs effort-2 pHash bits: {dict(sorted({b: leg.count(b) for b in set(leg)}.items()))}")
    print("vips decoders:", {d: sum(1 for r in m if r.get("vips", {}).get("decoder") == d) for d in ("vips", "pillow")},
          "vips failures:", [(r["file"], r["vips"].get("error", "")[:80]) for r in m if not r.get("vips", {}).get("ok")])
    gps = [r["file"] for r in m if r.get("vips", {}).get("gps_in_exif")]
    print("libvips thumbnails carrying GPS EXIF:", len(gps), gps[:5],
          "ffmpeg:", sum(1 for r in m if r.get("ffmpeg", {}).get("exif")))

    for w in (1, 4):
        tp = load(f"tp_w{w}.json")
        if not tp:
            continue
        tp.update(load(f"tp_w{w}_ffmpeg_yuv.json") or {})
        print(f"\n## throughput, {w} worker(s): images/s (mean latency ms)\n")
        classes = list(dict.fromkeys(k.split("|")[0] for k in tp))
        print("| class | libvips | ffmpeg RGB, 1 proc | ffmpeg YUV, 1 proc | ffmpeg RGB, 3 procs |")
        print("|---|---:|---:|---:|---:|")
        for c in classes:
            row = [tp.get(f"{c}|{h}") for h in ("vips", "ffmpeg", "ffmpeg_yuv", "ffmpeg_3proc")]
            print(f"| {c} | " + " | ".join(f"{x['images_per_s']} ({x['mean_latency_ms']})" if x else "-" for x in row) + " |")
    mem = load("mem.json")
    if mem:
        print("\n## peak memory per conversion (MiB)\n", json.dumps(mem, indent=1))
    sp = load("spawn.json")
    if sp:
        print("\nspawn:", sp)


if __name__ == "__main__":
    main()
