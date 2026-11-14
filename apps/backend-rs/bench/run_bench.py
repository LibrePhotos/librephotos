"""Benchmark stages (plans/rust-backend/05-benchmarks.md), one sub-command each:

  python run_bench.py validate  <ds> --out <results dir>   endpoint plan + cross-contender checks
  python run_bench.py attrib    <ds> --out ...             SQL statements / DB ms / bytes per request
  python run_bench.py w1        <ds> --out ... [--reps 5 --duration 20 --conc 1,8,32,128]
  python run_bench.py journeys  <ds> --out ... [--reps 5]
  python run_bench.py burst     <ds> --out ...
  python run_bench.py resources <ds> --out ...

<ds> is 50k or 250k (template lp_bench_<ds>). Every stage appends JSON lines to
<out>/<stage>_<ds>.jsonl, so an interrupted stage can be resumed (--resume).
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time

import lpb
from lpb import log

PORTS = {"django-shipped": lpb.PORT_BASE, "django-tuned": lpb.PORT_BASE + 1, "rust": lpb.PORT_BASE + 2}


def db_for(ds, name):
    return f"{lpb.RUN_PREFIX}{ds}_{name.replace('-', '_')}"


def template_for(ds):
    """lp_bench_<ds>; the fixture's template is lp_fixture adopted for Rust once
    (lp_fixture itself is never touched)."""
    t = f"lp_bench_{ds}"
    if ds == "fixture" and lpb.psql(f"SELECT 1 FROM pg_database WHERE datname = '{t}'") != "1":
        build = "lp_run_fixture_build"
        lpb.psql(f'DROP DATABASE IF EXISTS "{build}" WITH (FORCE)')
        lpb.psql(f'CREATE DATABASE "{build}" TEMPLATE lp_fixture')
        subprocess.run([lpb.RS_BIN, "adopt"], env=lpb.rust_env(build, 8998), check=True, capture_output=True)
        lpb.psql(f'ALTER DATABASE "{build}" RENAME TO "{t}"')
        lpb.psql(f'ALTER DATABASE "{t}" IS_TEMPLATE true')
    return t


def start_all(ds, names=lpb.ORDER):
    servers = {}
    for name in names:
        db = db_for(ds, name)
        lpb.clone(template_for(ds), db)
        servers[name] = lpb.Server(name, db, PORTS[name]).start()
        log(f"{name} up on {db} in {servers[name].cold_start_s:.1f}s (pid {servers[name].proc.pid})")
    return servers


def stop_all(servers, drop=True):
    for s in servers.values():
        s.stop()
        if drop:
            lpb.drop(s.db)


def pin_postgres():
    pm = lpb.pg_postmaster()
    r = lpb.pin([pm], lpb.MASK_PG)
    log(f"postgres {pm}: pinned {r['pinned']} processes to {lpb.MASK_PG}")
    return pm


# ---------------------------------------------------------------- endpoint plan

def jget(base, path, token):
    status, body, _ = lpb.http_get(base + path, token)
    try:
        return status, json.loads(body) if body[:1] in (b"{", b"[") else body
    except ValueError:
        return status, body


def ptr(v, p):
    for part in p.strip("/").split("/"):
        if part == "":
            continue
        if isinstance(v, list):
            idx = int(part)
            if idx >= len(v):
                return None
            v = v[idx]
        elif isinstance(v, dict):
            if part not in v:
                return None
            v = v[part]
        else:
            return None
    return v


def build_plan(ref_base, token):
    """W1 endpoints with the frontend's params, and their checks, derived from the
    reference (django-tuned) answers."""
    _, dl = jget(ref_base, "/api/albums/date/list/", token)
    groups = dl["results"]
    g1 = groups[0]
    big = max((g for g in groups if g.get("date")), key=lambda g: g["numberOfItems"])
    deep_page = (big["numberOfItems"] + 99) // 100
    _, p1 = jget(ref_base, f"/api/albums/date/{g1['id']}/?page=1", token)
    photo = p1["results"]["items"][0]
    h = photo["url"]
    _, ua = jget(ref_base, "/api/albums/user/list/", token)
    # a user album of median size: what a user typically opens
    ualbums = sorted(ua["results"], key=lambda a: a.get("photo_count") or 0)
    album = ualbums[len(ualbums) // 2]
    E = []

    def ep(name, path, len_=(), eq=(), media=False, cls="api"):
        E.append({"name": name, "path": path, "len": list(len_), "eq": list(eq), "media": media, "class": cls})

    ep("date_list", "/api/albums/date/list/", ["/results"], ["/results/0/id", "/results/0/numberOfItems", "/results/10/id"])
    ep("date_page_1", f"/api/albums/date/{g1['id']}/?page=1", ["/results/items"], ["/results/id", "/results/numberOfItems", "/results/items/0/id"])
    ep("date_page_deep", f"/api/albums/date/{big['id']}/?page={deep_page}", ["/results/items"], ["/results/id", "/results/items/0/id"])
    ep("photo_detail", f"/api/photos/{h}/", [], ["/image_hash", "/owner/id"])
    ep("persons", "/api/persons/?page_size=1000", ["/results"], ["/count", "/results/0/id"])
    ep("user_self", f"/api/user/{lpb.ALICE}/", [], ["/id", "/username"])
    ep("sitesettings", "/api/sitesettings", [], ["/allow_upload"])
    ep("rqavailable", "/api/rqavailable/", [], [])
    ep("jobs", "/api/jobs/?page_size=10&page=1&mine=true", ["/results"], ["/count", "/results/0/job_id"])
    ep("album_user_list", "/api/albums/user/list/", ["/results"], [])
    ep("album_thing_list", "/api/albums/thing/list/", ["/results"], [])
    ep("album_place_list", "/api/albums/place/list/", ["/results"], [])
    ep("search_text", "/api/photos/searchlist/?search=beach", ["/results"], ["/results/0/date"])
    ep("album_user_detail", f"/api/albums/user/{album['id']}/", ["/grouped_photos"], ["/id", "/title"])
    ep("media_square_small", f"/media/square_thumbnails_small/{h}", media=True, cls="media")
    ep("media_big", f"/media/thumbnails_big/{h}", media=True, cls="media")
    return E


def check_for(ep, ref_status, ref_body):
    c = {"status": ref_status}
    if ep["media"]:
        c["bytes"] = len(ref_body)
        return c
    c["len"] = [[p, len(ptr(ref_body, p) or [])] for p in ep["len"]]
    c["eq"] = [[p, ptr(ref_body, p)] for p in ep["eq"]]
    return c


def verify(check, status, body):
    if status != check["status"]:
        return [f"status {status} != {check['status']}"]
    probs = []
    if "bytes" in check and len(body) != check["bytes"]:
        probs.append(f"bytes {len(body)} != {check['bytes']}")
    for p, n in check.get("len", []):
        got = ptr(body, p)
        if not isinstance(got, (list, dict)) or len(got) != n:
            probs.append(f"{p}: len {len(got) if isinstance(got, (list, dict)) else got} != {n}")
    for p, v in check.get("eq", []):
        got = ptr(body, p)
        if got != v and not (isinstance(got, (int, float)) and isinstance(v, (int, float)) and float(got) == float(v)):
            probs.append(f"{p}: {str(got)[:60]} != {str(v)[:60]}")
    return probs


def stage_validate(args):
    token = lpb.mint_token()
    servers = start_all(args.ds)
    try:
        ref = servers["django-tuned"]
        plan = build_plan(ref.base, token)
        out = []
        for ep in plan:
            status, body = jget(ref.base, ep["path"], token)
            check = check_for(ep, status, body)
            row = {"endpoint": ep["name"], "path": ep["path"], "ref_status": status, "check": check, "contenders": {}}
            for name, s in servers.items():
                t0 = time.perf_counter()
                st, b = jget(s.base, ep["path"], token)
                row.setdefault("first_ms", {})[name] = round((time.perf_counter() - t0) * 1000, 1)
                probs = verify(check, st, b)
                row["contenders"][name] = probs
                if probs:
                    log(f"MISMATCH {ep['name']} {name}: {probs}")
            # eq pointers the contenders disagree on are dropped from the load checks and reported
            bad = {p.split(":")[0] for probs in row["contenders"].values() for p in probs if p.startswith("/")}
            if "eq" in check:
                check["eq"] = [e for e in check["eq"] if e[0] not in bad]
            row["dropped_eq"] = sorted(bad)
            out.append(row)
            log(f"{ep['name']:<20} {status} ok {row['first_ms']}" + (f" (dropped {sorted(bad)})" if bad else ""))
        with open(os.path.join(args.out, f"plan_{args.ds}.json"), "w", encoding="utf-8") as f:
            json.dump({"plan": plan, "validation": out}, f, indent=1)
        # the journeys' discovery must work too
        for name, s in servers.items():
            j = lpb.lpbench("journey", "--base", s.base, "--token", token, "--user-id", lpb.ALICE,
                            "--journey", "J6", "--mode", "fixed", "--rate", "2", "--duration", "1")
            log(f"{name} journey discovery: {j['discovered']}")
    finally:
        stop_all(servers)


def load_plan(args):
    with open(os.path.join(args.out, f"plan_{args.ds}.json"), encoding="utf-8") as f:
        d = json.load(f)
    checks = {v["endpoint"]: v["check"] for v in d["validation"]}
    return [dict(ep, check=checks[ep["name"]]) for ep in d["plan"]]


# ---------------------------------------------------------------- W1

def stage_w1(args):
    plan = load_plan(args)
    if args.endpoints:
        want = set(args.endpoints.split(","))
        plan = [e for e in plan if e["name"] in want]
    concs = [int(c) for c in args.conc.split(",")]
    path = os.path.join(args.out, f"w1_{args.ds}.jsonl")
    done = {(r["rep"], r["endpoint"], r["concurrency"], r["contender"]) for r in lpb.read_jsonl(path)} if args.resume else set()
    if not args.resume and os.path.exists(path):
        os.remove(path)
    token = lpb.mint_token()
    pm = pin_postgres()
    servers = start_all(args.ds)
    all_pids = [pm] + [s.proc.pid for s in servers.values()]
    try:
        for rep in range(0, args.reps + 1):  # rep 0 = warm-up, discarded by the report
            order = lpb.ORDER if rep % 2 == 1 else list(reversed(lpb.ORDER))
            dur = args.warmup_duration if rep == 0 else args.duration
            for ep in plan:
                saturated = set()
                for c in concs:
                    for name in order:
                        if (rep, ep["name"], c, name) in done:
                            continue
                        if name in saturated:
                            # Timed out at a lower concurrency: a higher one only piles up a
                            # backlog the server keeps working through after the cell.
                            lpb.append_jsonl(path, {"rep": rep, "endpoint": ep["name"], "contender": name,
                                                    "ds": args.ds, "concurrency": c, "skipped": "saturated",
                                                    "class": ep["class"], "t": time.time()})
                            continue
                        s = servers[name]
                        lpb.quiesce(all_pids, limit_s=900)
                        r = lpb.lpbench("w1", "--base", s.base, "--path", ep["path"], "--token", token,
                                        "--concurrency", c, "--warmup", 2, "--duration", dur,
                                        "--check", json.dumps(ep["check"]), "--server-pids", s.pids(),
                                        "--pg-pids", pm, "--timeout", 60, timeout=dur + 200)
                        r.update({"rep": rep, "endpoint": ep["name"], "contender": name, "ds": args.ds,
                                  "class": ep["class"], "t": time.time()})
                        lpb.append_jsonl(path, r)
                        cnt = r["counts"]
                        if cnt["errors"]:
                            saturated.add(name)
                        log(f"rep{rep} {ep['name']:<20} c={c:<3} {name:<15} {r['rps']:>9.1f} rps "
                            f"p50 {r['latency']['p50_ms']:>8.2f} p99 {r['latency']['p99_ms']:>8.2f} ms "
                            f"fail {cnt['check_failed']} err {cnt['errors']}"
                            + (f" [{cnt['first_failure']}]" if cnt["first_failure"] else ""))
    finally:
        stop_all(servers)
        lpb.pin([pm], lpb.MASK_ALL)


# ---------------------------------------------------------------- attribution (SQL per request)

LINE_RE = re.compile(r"^\S+ \S+ \S+ \[(\d+)\] (\w+):\s+(.*)$")
DUR_RE = re.compile(r"^duration: ([\d.]+) ms\s+(statement|execute [^:]*|parse [^:]*|bind [^:]*):\s?(.*)$")


def pg_log_since(offset):
    with open(lpb.PG_LOG, "rb") as f:
        f.seek(offset)
        data = f.read().decode("utf-8", "replace")
    entries = []
    for line in data.splitlines():
        m = LINE_RE.match(line)
        if m:
            entries.append({"pid": int(m.group(1)), "level": m.group(2), "msg": m.group(3)})
        elif entries:
            entries[-1]["msg"] += "\n" + line
    return entries


def parse_statements(entries):
    stmts = []
    for e in entries:
        if e["level"] != "LOG":
            continue
        m = DUR_RE.match(e["msg"])
        if not m:
            continue
        kind = m.group(2).split(" ")[0]
        stmts.append({"pid": e["pid"], "ms": float(m.group(1)), "kind": kind, "sql": m.group(3).strip()})
    return stmts


BACKGROUND_RE = re.compile(r"job_queue|schedule_state|pg_notify|LISTEN|UNLISTEN|django_q_", re.I)


def stage_attrib(args):
    """One request per endpoint on a database that logs every statement."""
    plan = load_plan(args)
    token = lpb.mint_token()
    path = os.path.join(args.out, f"attrib_{args.ds}.jsonl")
    if os.path.exists(path):
        os.remove(path)
    for name in ("django-tuned", "rust"):
        db = f"lp_run_{args.ds}_attr_{name.replace('-', '_')}"
        lpb.clone(template_for(args.ds), db)
        lpb.psql(f'ALTER DATABASE "{db}" SET log_min_duration_statement = 0')
        s = lpb.Server(name, db, 8911).start(pin_mask=lpb.MASK_SERVER)
        try:
            for ep in plan:
                for _ in range(3):
                    lpb.http_get(s.base + ep["path"], token)
                time.sleep(1.5)
                runs = []
                for _ in range(args.samples):
                    off = os.path.getsize(lpb.PG_LOG)
                    status, body, secs = lpb.http_get(s.base + ep["path"], token)
                    time.sleep(1.2)
                    stmts = parse_statements(pg_log_since(off))
                    bg = [x for x in stmts if BACKGROUND_RE.search(x["sql"])]
                    fg = [x for x in stmts if not BACKGROUND_RE.search(x["sql"])]
                    runs.append({
                        "status": status, "bytes": len(body), "latency_ms": secs * 1000,
                        "queries": sum(1 for x in fg if x["kind"] in ("statement", "execute")),
                        "db_ms": sum(x["ms"] for x in fg),
                        "background_statements": len(bg),
                        "statements": [{"kind": x["kind"], "ms": x["ms"], "sql": x["sql"][:400]} for x in fg],
                    })
                best = min(runs, key=lambda r: r["db_ms"])
                row = {"endpoint": ep["name"], "contender": name, "path": ep["path"], "ds": args.ds,
                       "queries": statistics.median(r["queries"] for r in runs),
                       "db_ms": statistics.median(r["db_ms"] for r in runs),
                       "bytes": statistics.median(r["bytes"] for r in runs),
                       "latency_ms": statistics.median(r["latency_ms"] for r in runs),
                       "status": runs[0]["status"], "sample": best}
                lpb.append_jsonl(path, row)
                log(f"attrib {name:<13} {ep['name']:<20} q={row['queries']:<5} db={row['db_ms']:.2f} ms bytes={row['bytes']}")
        finally:
            s.stop()
            lpb.psql(f'ALTER DATABASE "{db}" RESET log_min_duration_statement')
            lpb.drop(db)


# ---------------------------------------------------------------- W2 journeys

JOURNEY_START = {"J1": 0.02, "J2": 0.1, "J3": 0.1, "J4": 0.02, "J5": 0.05, "J6": 5.0}


def stage_journeys(args):
    token = lpb.mint_token()
    path = os.path.join(args.out, f"journeys_{args.ds}.jsonl")
    rows = lpb.read_jsonl(path) if args.resume else []
    if not args.resume and os.path.exists(path):
        os.remove(path)
    done = {(r["rep"], r["journey"], r["contender"], r["mode"]) for r in rows}
    journeys = args.journeys.split(",")
    pm = pin_postgres()
    servers = start_all(args.ds)
    all_pids = [pm] + [s.proc.pid for s in servers.values()]
    first_max = {(r["journey"], r["contender"]): r["max_pass_rate"] for r in rows if r["rep"] == 1 and r["mode"] == "ramp"}
    try:
        for rep in range(1, args.reps + 1):
            order = lpb.ORDER if rep % 2 == 1 else list(reversed(lpb.ORDER))
            for j in journeys:
                for name in order:
                    if (rep, j, name, "ramp") in done:
                        continue
                    s = servers[name]
                    lpb.quiesce(all_pids)
                    if rep == 1:
                        rate, factor, steps = JOURNEY_START[j], 1.5, 30
                    else:
                        m = first_max.get((j, name)) or JOURNEY_START[j]
                        rate, factor, steps = m * 0.7, 1.12, 12
                    r = lpb.lpbench("journey", "--base", s.base, "--token", token, "--user-id", lpb.ALICE,
                                    "--journey", j, "--mode", "ramp", "--rate", f"{rate:.4f}",
                                    "--factor", factor, "--max-steps", steps, "--duration", args.step,
                                    "--drain", 30, "--server-pids", s.pids(), "--pg-pids", pm, timeout=3 * 3600)
                    if rep == 1:
                        first_max[(j, name)] = r["max_pass_rate"]
                    r.update({"rep": rep, "contender": name, "ds": args.ds, "t": time.time()})
                    lpb.append_jsonl(path, r)
                    log(f"ramp rep{rep} {j} {name:<15} max {r['max_pass_rate']} journeys/s")
        # latency at a fixed moderate rate: half of what django-shipped sustains (rep-1 ramp)
        for rep in range(1, args.reps + 1):
            order = lpb.ORDER if rep % 2 == 1 else list(reversed(lpb.ORDER))
            for j in journeys:
                rate = max(0.05, 0.5 * (first_max.get((j, "django-shipped")) or JOURNEY_START[j]))
                for name in order:
                    if (rep, j, name, "fixed") in done:
                        continue
                    s = servers[name]
                    lpb.quiesce(all_pids)
                    r = lpb.lpbench("journey", "--base", s.base, "--token", token, "--user-id", lpb.ALICE,
                                    "--journey", j, "--mode", "fixed", "--rate", f"{rate:.4f}",
                                    "--duration", args.fixed_duration, "--drain", 60, "--max-inflight", 2000,
                                    "--server-pids", s.pids(), "--pg-pids", pm, timeout=3600)
                    r.update({"rep": rep, "contender": name, "ds": args.ds, "t": time.time()})
                    lpb.append_jsonl(path, r)
                    st = r["steps"][0]
                    log(f"fixed rep{rep} {j} {name:<15} @{rate:.3f}/s journey p50 {st['journey_latency']['p50_ms']:.0f} ms "
                        f"req p99 {st['request_latency']['p99_ms']:.1f} ms redirects/j {st['redirects_per_journey']:.1f}")
    finally:
        stop_all(servers)
        lpb.pin([pm], lpb.MASK_ALL)


def stage_jsmoke(args):
    """A few journeys of each kind per contender: every request must pass before hours of ramps."""
    token = lpb.mint_token()
    servers = start_all(args.ds)
    try:
        for j in args.journeys.split(","):
            for name, s in servers.items():
                r = lpb.lpbench("journey", "--base", s.base, "--token", token, "--user-id", lpb.ALICE,
                                "--journey", j, "--mode", "fixed", "--rate", "0.5", "--duration", "4",
                                "--drain", 120, timeout=600)
                st = r["steps"][0]
                log(f"jsmoke {j} {name:<15} ok {st['journeys_ok']} failed {st['journeys_failed']} "
                    f"req/j {st['requests_per_journey']:.1f} 301/j {st['redirects_per_journey']:.1f} "
                    f"journey p50 {st['journey_latency']['p50_ms']:.0f} ms statuses {st['counts']['statuses']} "
                    f"first failure {st['counts']['first_failure']}")
    finally:
        stop_all(servers)


# ---------------------------------------------------------------- W3 burst

def stage_burst(args):
    token = lpb.mint_token()
    path = os.path.join(args.out, f"burst_{args.ds}.jsonl")
    if os.path.exists(path):
        os.remove(path)
    hashes_file = os.path.join(lpb.RUNS, f"burst-hashes-{args.ds}.txt")
    pm = pin_postgres()
    servers = start_all(args.ds)
    try:
        # the newest photos first: what the timeline paints first
        hashes = lpb.psql(
            "SELECT p.image_hash FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id "
            "WHERE p.owner_id = 2 AND NOT p.video AND NOT p.hidden AND NOT p.in_trashcan "
            "ORDER BY p.exif_timestamp DESC NULLS LAST LIMIT 4000", servers["rust"].db).split()
        with open(hashes_file, "w") as f:
            f.write("\n".join(hashes))
        for conns in (6, 64):
            for rep in range(0, args.reps + 1):
                order = lpb.ORDER if rep % 2 == 1 else list(reversed(lpb.ORDER))
                for name in order:
                    s = servers[name]
                    lpb.quiesce([pm] + [x.proc.pid for x in servers.values()])
                    # each rep bursts a different 200-photo slice (rep 0 = warm-up)
                    r = lpb.lpbench("burst", "--base", s.base, "--token", token, "--hashes", hashes_file,
                                    "--n", 200, "--conns", conns, "--reps", 1, "--offset", 200 * rep)
                    row = {"rep": rep, "contender": name, "conns": conns, "ds": args.ds, **r[0]}
                    lpb.append_jsonl(path, row)
                    log(f"burst conns={conns} rep{rep} {name:<15} ttlb {row['ttlb_ms']:.1f} ms "
                        f"ok {row['counts']['ok']} fail {row['counts']['check_failed']} err {row['counts']['errors']}")
    finally:
        stop_all(servers)
        lpb.pin([pm], lpb.MASK_ALL)


# ---------------------------------------------------------------- W5 resources

def stage_resources(args):
    """Cold start to /api/healthz (5 reps each, fresh process), idle RSS after start
    and after a warm-up pass over the W1 endpoints."""
    token = lpb.mint_token()
    plan = load_plan(args)
    path = os.path.join(args.out, f"resources_{args.ds}.jsonl")
    if os.path.exists(path):
        os.remove(path)
    for name in lpb.ORDER:
        db = db_for(args.ds, name)
        lpb.clone(template_for(args.ds), db)
    try:
        for rep in range(1, args.reps + 1):
            order = lpb.ORDER if rep % 2 == 1 else list(reversed(lpb.ORDER))
            for name in order:
                s = lpb.Server(name, db_for(args.ds, name), PORTS[name]).start()
                time.sleep(10)
                idle = s.stat()
                for ep in plan:
                    for _ in range(3):
                        lpb.http_get(s.base + ep["path"], token)
                time.sleep(10)
                warm = s.stat()
                s.stop()
                row = {"rep": rep, "contender": name, "ds": args.ds, "cold_start_s": s.cold_start_s,
                       "idle": idle, "idle_after_warmup": warm}
                lpb.append_jsonl(path, row)
                log(f"resources rep{rep} {name:<15} cold {s.cold_start_s:.2f}s idle {idle['working_set'] / 2**20:.0f} MiB "
                    f"({idle['procs']} procs) warm {warm['working_set'] / 2**20:.0f} MiB")
    finally:
        for name in lpb.ORDER:
            lpb.drop(db_for(args.ds, name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage")
    ap.add_argument("ds")
    ap.add_argument("--out", required=True)
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--duration", type=float, default=20)
    ap.add_argument("--warmup-duration", type=float, default=5)
    ap.add_argument("--conc", default="1,8,32,128")
    ap.add_argument("--endpoints", default="")
    ap.add_argument("--journeys", default="J1,J2,J3,J4,J5,J6")
    ap.add_argument("--step", type=float, default=10)
    ap.add_argument("--fixed-duration", type=float, default=20)
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    {"validate": stage_validate, "jsmoke": stage_jsmoke, "attrib": stage_attrib, "w1": stage_w1, "journeys": stage_journeys,
     "burst": stage_burst, "resources": stage_resources}[args.stage](args)


if __name__ == "__main__":
    sys.exit(main())
