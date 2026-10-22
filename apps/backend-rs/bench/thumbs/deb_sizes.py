"""What dropping libvips saves in a Debian-slim image (Packages index only, nothing installed).

Closure sizes (Depends + Pre-Depends, no Recommends, minus the Essential/required base
of debian-slim) for bookworm and trixie, amd64 and arm64:

- the libvips closure alone, and its biggest members;
- the *marginal* cost of libvips on top of everything else the Rust image installs
  (exiftool/perl, ca-certificates), i.e. what removing it saves when ffmpeg comes from
  the self-contained ffmpeg-bin wheel libs (no Debian deps);
- the same on top of Debian's own ffmpeg (shared libs overlap: libjxl, libwebp, ...);
- the same on top of just the ffmpeg libraries the thumbnailer needs (libavcodec,
  libavformat, libavfilter, libswscale) without the ffmpeg CLI's libavdevice/SDL.

    python deb_sizes.py -> $LP_THUMBS_WORK/deb_sizes.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import footprint_sizes as fs  # noqa: E402

from common import WORK  # noqa: E402

VIPS = {"bookworm": "libvips42", "trixie": "libvips42t64"}
AV = {"bookworm": ["libavcodec59", "libavformat59", "libavfilter8", "libswscale6"],
      "trixie": ["libavcodec61", "libavformat61", "libavfilter10", "libswscale8"]}
REST = ["libimage-exiftool-perl", "ca-certificates"]


def size(pk, names):
    return {
        "packages": len(names),
        "installed_mb": round(sum(int(pk[n].get("Installed-Size", 0)) for n in names) / 1024, 1),
        "debs_mb": fs.mb(sum(int(pk[n].get("Size", 0)) for n in names)),
    }


def main():
    res = {}
    for dist in ("bookworm", "trixie"):
        fs.DEBIAN = dist
        for arch in ("amd64", "arm64"):
            pk, prov = fs._packages(arch)
            base = {n for n, f in pk.items() if f.get("Priority") == "required" or f.get("Essential") == "yes"}
            base = fs._closure(pk, prov, sorted(base), set())

            def clo(roots):
                return fs._closure(pk, prov, roots, base)

            vips = clo([VIPS[dist]])
            r = {"version": pk[VIPS[dist]].get("Version"),
                 "ffmpeg_version": pk["ffmpeg"].get("Version"),
                 "libvips_closure": size(pk, vips),
                 "libvips_largest_installed_mb": {
                     n: round(int(pk[n].get("Installed-Size", 0)) / 1024, 1)
                     for n in sorted(vips, key=lambda n: -int(pk[n].get("Installed-Size", 0)))[:12]}}
            for label, others in (("ffmpeg_bin_wheel", REST), ("debian_ffmpeg_cli", REST + ["ffmpeg"]),
                                  ("debian_av_libs", REST + AV[dist])):
                with_v, without = clo(others + [VIPS[dist]]), clo(others)
                r[f"saving_with_{label}"] = size(pk, with_v - without)
                r[f"rest_{label}"] = size(pk, without)
            r["debian_ffmpeg_cli_alone"] = size(pk, clo(["ffmpeg"]))
            r["debian_av_libs_alone"] = size(pk, clo(AV[dist]))
            res[f"{dist}/{arch}"] = r
            print(dist, arch, json.dumps(r)[:400])
    (WORK / "deb_sizes.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
