"""Round 3 table rows from `ml_footprint.py scan --lib w4 --scan-only` result files.

  python round3_summary.py results/2026-10-05-round3/<glob>...

One line per file: photos/s of the scan stage, wall, job seconds (scan / tags / faces),
CPU seconds of the stage, peak RSS (whole tree, whole run) and of the scan stage,
peak GPU memory (nvidia-smi delta) and mean GPU utilisation.
"""

import glob
import json
import sys


def row(path):
    r = json.load(open(path))
    jobs = {j["job"]: (j["seconds"] if j["finished"] else f"cut@{j['progress']}") for j in r.get("lrj", [])}
    st = r.get("stages_s", {}).get("scan+tags+clip+faces")
    n = r.get("counts_after_scan", {}).get("photos")
    done = all(j["finished"] for j in r.get("lrj", []) if j["job"] in ("scan", "tags", "scan faces"))
    g = r.get("gpu_scan") or {}
    return (f"{path.split('/')[-1].split(chr(92))[-1]:<28} {('' if done else '<=')}{n / st if st else 0:6.2f}/s "
            f"wall {st:6.1f}  scan {jobs.get('scan')}  tags {jobs.get('tags')}  faces {jobs.get('scan faces')}  "
            f"cpu {r.get('cpu_s', {}).get('scan')}  peak {r.get('peak', {}).get('rss_mb')} "
            f"(stage {r.get('scan_stage_peak', {}).get('rss')})  vram {g.get('peak_mib')} util {g.get('mean_util')}")


if __name__ == "__main__":
    for pat in sys.argv[1:]:
        for p in sorted(glob.glob(pat)):
            try:
                print(row(p))
            except Exception as e:  # noqa: BLE001
                print(p, "unreadable:", e)
