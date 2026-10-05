"""Quick throughput comparison, Django vs Rust, in a few minutes.

  python quick.py [--ds 50k] [--conc 32] [--duration 4] [--contenders django-tuned,rust]
                  [--endpoints date_list,photo_detail] [--label note]
                  [--expect-bytes media_big=15210]  (a media file swapped on purpose)

One cell per (endpoint, contender): 1 s warm-up + --duration s measured at one
concurrency, checked against the endpoint plan of the full run. Prints a
requests/s table with the Rust speedup and appends it to results/quick.jsonl.
Build the release binary first (cargo build --release -p lp-server).
"""

import argparse
import json
import os
import time

import lpb
from run_bench import PORTS, db_for, log, pin_postgres, start_all, stop_all, template_for

PLAN_DIR = os.path.join(lpb.HERE, "results", "2026-09-30-ryzen5-2600x-131db0764")


def load_plan(ds):
    with open(os.path.join(PLAN_DIR, f"plan_{ds}.json"), encoding="utf-8") as f:
        d = json.load(f)
    checks = {v["endpoint"]: v["check"] for v in d["validation"]}
    return [dict(ep, check=checks[ep["name"]]) for ep in d["plan"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ds", default="50k")
    ap.add_argument("--conc", type=int, default=32)
    ap.add_argument("--duration", type=float, default=4)
    ap.add_argument("--contenders", default="django-tuned,rust")
    ap.add_argument("--endpoints", default="")
    ap.add_argument("--label", default="")
    ap.add_argument("--expect-bytes", default="",
                    help="endpoint=N,...: expected body size when a media file was swapped on purpose")
    args = ap.parse_args()

    plan = load_plan(args.ds)
    if args.endpoints:
        want = set(args.endpoints.split(","))
        plan = [e for e in plan if e["name"] in want]
    for item in filter(None, args.expect_bytes.split(",")):
        name, n = item.split("=")
        for e in plan:
            if e["name"] == name:
                e["check"] = dict(e["check"], bytes=int(n))
    names = args.contenders.split(",")
    token = lpb.mint_token()
    t0 = time.perf_counter()
    pm = pin_postgres()
    servers = start_all(args.ds, names)
    rows = []
    try:
        for ep in plan:
            row = {"endpoint": ep["name"]}
            for name in names:
                s = servers[name]
                lpb.quiesce([pm, s.proc.pid], limit_s=15)
                r = lpb.lpbench("w1", "--base", s.base, "--path", ep["path"], "--token", token,
                                "--concurrency", args.conc, "--warmup", 1, "--duration", args.duration,
                                "--check", json.dumps(ep["check"]), "--server-pids", s.pids(),
                                "--pg-pids", pm, "--timeout", 30, timeout=args.duration + 90)
                c = r["counts"]
                row[name] = {"rps": r["rps"], "p50": r["latency"]["p50_ms"], "p99": r["latency"]["p99_ms"],
                             "bad": c["check_failed"] + c["errors"]}
            rows.append(row)
            log("  ".join([f"{ep['name']:<20}"] + [f"{n} {row[n]['rps']:8.1f} rps" for n in names]))
    finally:
        stop_all(servers)
        lpb.pin([pm], lpb.MASK_ALL)

    ref, rs = names[0], names[-1]
    print(f"\n{args.ds}, c={args.conc}, {args.duration:g} s/cell, {time.perf_counter() - t0:.0f} s total"
          + (f" [{args.label}]" if args.label else ""))
    print(f"| endpoint | {ref} rps | {rs} rps | speedup | {ref} p50 ms | {rs} p50 ms | errors |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for row in rows:
        a, b = row[ref], row[rs]
        sp = b["rps"] / a["rps"] if a["rps"] else float("inf")
        print(f"| {row['endpoint']} | {a['rps']:.1f} | {b['rps']:.1f} | {sp:.1f}x | {a['p50']:.1f} | {b['p50']:.1f} | "
              f"{a['bad']}/{b['bad']} |")
    lpb.append_jsonl(os.path.join(lpb.HERE, "results", "quick.jsonl"),
                     {"t": time.time(), "commit": lpb.git_commit(), "ds": args.ds, "conc": args.conc,
                      "duration": args.duration, "label": args.label, "rows": rows})


if __name__ == "__main__":
    main()
