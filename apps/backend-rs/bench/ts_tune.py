"""Quick A/B loop for the TS server: cold start, idle memory, throughput, memory after load.

    python ts_tune.py [--bun <bun.exe>] [--cmd "run server.ts"] [--env K=V ...]
                      [--endpoints date_page_1,photo_detail,...] [--duration 4] [--label note]

One server on a clone of lp_bench_50k (same env as the bench's `ts` contender),
pinned like the bench (server CPUs 0-5), each endpoint for --duration s at c=32.
`--cmd` is what follows the bun executable (e.g. "--smol run server.ts"), or
an absolute path to a compiled executable to run instead of bun. Appends a
row to results/ts_tune.jsonl. About 1-3 minutes.
"""

import argparse
import json
import os
import shlex
import subprocess
import time

import lpb
from quick import load_plan

DEFAULT_EPS = "sitesettings,rqavailable,user_self,date_page_1,photo_detail,album_user_detail,media_square_small,media_big"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bun", default=lpb.BUN)
    ap.add_argument("--cmd", default="run server.ts")
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("--endpoints", default=DEFAULT_EPS)
    ap.add_argument("--duration", type=float, default=4)
    ap.add_argument("--port", type=int, default=8931)
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    plan = {e["name"]: e for e in load_plan("50k")}
    eps = [plan[n] for n in args.endpoints.split(",") if n]
    db = f"{lpb.RUN_PREFIX}tstune"
    lpb.clone("lp_bench_50k", db)
    env = lpb.rust_env(db, args.port, lpb.MEDIA, extra={"LP_DB_POOL": str(2 * lpb.SERVER_CPUS), "LP_PYTHON": lpb.DJANGO_PY})
    for kv in args.env:
        k, v = kv.split("=", 1)
        env[k] = v
    subprocess.run([args.bun, "run", "src/cli.ts", "adopt"], cwd=lpb.TS_DIR, env=env, check=True, capture_output=True)
    if os.path.isabs(args.cmd.split()[0]):
        cmd = shlex.split(args.cmd, posix=False)
    else:
        cmd = [args.bun, *shlex.split(args.cmd)]
    log = open(os.path.join(lpb.RUNS, "logs", f"ts_tune-{args.port}.log"), "ab")
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, cwd=lpb.TS_DIR, env=env, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    base = f"http://127.0.0.1:{args.port}"
    try:
        while True:
            if proc.poll() is not None:
                raise RuntimeError(f"server exited {proc.returncode}; see {log.name}")
            try:
                if lpb.http_get(base + "/api/healthz", timeout=2)[0] == 200:
                    break
            except Exception:
                pass
            time.sleep(0.05)
        cold = time.perf_counter() - t0
        lpb.pin([proc.pid], lpb.MASK_SERVER)
        time.sleep(5)
        idle = lpb.lpbench("procstat", "--pids", str(proc.pid))
        token = lpb.mint_token()
        row = {"t": time.time(), "label": args.label, "cmd": " ".join(cmd[1:]) if not os.path.isabs(cmd[0]) or "bun" in cmd[0].lower() else cmd[0],
               "env": args.env, "cold_start_s": round(cold, 3), "idle_ws_mib": round(idle["working_set"] / 2**20, 1),
               "idle_private_mib": round(idle["private_bytes"] / 2**20, 1), "rps": {}}
        for ep in eps:
            r = lpb.lpbench("w1", "--base", base, "--path", ep["path"], "--token", token, "--concurrency", 32,
                            "--warmup", 1, "--duration", args.duration, "--check", json.dumps(ep["check"]),
                            "--server-pids", str(proc.pid), "--timeout", 30, timeout=args.duration + 60)
            c = r["counts"]
            row["rps"][ep["name"]] = round(r["rps"], 1)
            bad = c["check_failed"] + c["errors"]
            print(f"{ep['name']:<20} {r['rps']:8.1f} rps  p50 {r['latency']['p50_ms']:6.1f} ms" + (f"  BAD {bad}" if bad else ""))
        loaded = lpb.lpbench("procstat", "--pids", str(proc.pid))
        row["loaded_ws_mib"] = round(loaded["working_set"] / 2**20, 1)
        print(f"cold {row['cold_start_s']} s  idle {row['idle_ws_mib']} MiB ws / {row['idle_private_mib']} MiB private  "
              f"after load {row['loaded_ws_mib']} MiB  [{args.label}]")
        lpb.append_jsonl(os.path.join(lpb.HERE, "results", "ts_tune.jsonl"), row)
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        time.sleep(0.5)
        lpb.drop(db)


if __name__ == "__main__":
    main()
