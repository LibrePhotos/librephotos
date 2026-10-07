"""Turn a results directory into results.json + REPORT.md.

    python report.py <results dir>

Reads the stage outputs (plan_*.json, attrib_*.jsonl, w1_*.jsonl,
journeys_*.jsonl, burst_*.jsonl, resources_*.jsonl, scan.jsonl, dupes_*.jsonl,
env.json, notes.md) that exist; missing stages are left out of the report.
"""

import json
import os
import statistics
import sys
from collections import defaultdict

CONTENDERS = ["django-shipped", "django-tuned", "rust"]
DATASETS = ["fixture", "50k", "250k"]
MIB = 2**20


def jl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def spread(xs):
    xs = [x for x in xs if x is not None]
    return (min(xs), max(xs)) if xs else (None, None)


def fmt(x, nd=1, unit=""):
    if x is None:
        return "–"
    if isinstance(x, float) and x >= 1000 and nd <= 1:
        return f"{x:,.0f}{unit}"
    return f"{x:.{nd}f}{unit}"


def ratio(a, b):
    if a is None or b is None or b == 0:
        return None
    return a / b


def fx(r):
    return "–" if r is None else f"{r:.2f}×"


# ---------------------------------------------------------------- W1

def agg_w1(rows):
    cells = defaultdict(list)
    skipped = defaultdict(int)
    for r in rows:
        if r["rep"] == 0:
            continue
        k = (r["ds"], r["endpoint"], r["concurrency"], r["contender"])
        if r.get("skipped"):
            skipped[k] += 1
            continue
        cells[k].append(r)
    out = {}
    for k, n in skipped.items():
        if k not in cells:
            out[k] = {"reps": 0, "skipped": n, "rps": None, "p50_ms": None, "p99_ms": None, "wrong": 0, "errors": 0,
                      "server_cpu_per_1k": None, "pg_cpu_per_1k": None, "bytes": None, "first_failure": None,
                      "rps_spread": (None, None), "p50_spread": (None, None), "peak_rss_mib": None}
    for k, rs in cells.items():
        requests = [r["counts"]["ok"] + r["counts"]["check_failed"] for r in rs]
        wrong = sum(r["counts"]["check_failed"] for r in rs)
        errors = sum(r["counts"]["errors"] for r in rs)
        cpu_per_1k = [1000 * r["server_cpu_s"] / n if n else None for r, n in zip(rs, requests)]
        pg_per_1k = [1000 * r["pg_cpu_s"] / n if n else None for r, n in zip(rs, requests)]
        out[k] = {
            "reps": len(rs),
            "rps": med([r["rps"] for r in rs]),
            "rps_spread": spread([r["rps"] for r in rs]),
            "p50_ms": med([r["latency"]["p50_ms"] if r["latency"]["n"] else None for r in rs]),
            "p50_spread": spread([r["latency"]["p50_ms"] if r["latency"]["n"] else None for r in rs]),
            "p99_ms": med([r["latency"]["p99_ms"] if r["latency"]["n"] else None for r in rs]),
            "bytes": med([r["bytes_per_response"] for r in rs]),
            "server_cpu_per_1k": med(cpu_per_1k),
            "pg_cpu_per_1k": med(pg_per_1k),
            "peak_rss_mib": med([r["server_rss"]["peak_working_set"] / MIB for r in rs]),
            "wrong": wrong,
            "errors": errors,
            "first_failure": next((r["counts"]["first_failure"] for r in rs if r["counts"]["first_failure"]), None),
            "skipped": skipped.get(k, 0),
        }
    return out


def cell_txt(c, key="rps", nd=1):
    if c is None:
        return "–"
    if c["reps"] == 0 and c.get("skipped"):
        return "sat."
    if c["wrong"]:
        return "FAIL(data)"
    v = c[key]
    s = fmt(v, nd)
    if c["errors"]:
        s += "†"
    return s


# ---------------------------------------------------------------- attribution

def agg_attrib(rows):
    return {(r["ds"], r["endpoint"], r["contender"]): r for r in rows}


def classify(dj, rs, dj_p50, rs_p50):
    """runtime / query / payload win (or loss) labels for rust vs django-tuned."""
    if not dj or not rs:
        return "–"
    labels = []
    q_dj, q_rs = dj["queries"], rs["queries"]
    db_dj, db_rs = dj["db_ms"], rs["db_ms"]
    if db_rs > 1.3 * db_dj + 0.5:
        labels.append("query LOSS")
    elif q_rs < q_dj or (db_dj > 0.5 and db_rs < 0.7 * db_dj):
        labels.append("query")
    if dj["bytes"] and rs["bytes"] < 0.8 * dj["bytes"]:
        labels.append("payload")
    elif rs["bytes"] > 1.2 * dj["bytes"] + 200:
        labels.append("payload LOSS")
    if dj_p50 is not None and rs_p50 is not None:
        app_dj = max(dj_p50 - db_dj, 0.0)
        app_rs = max(rs_p50 - db_rs, 0.0)
        if app_rs < 0.7 * app_dj:
            labels.append("runtime")
        elif app_rs > 1.3 * app_dj + 0.5:
            labels.append("runtime LOSS")
    return " + ".join(labels) if labels else "same"


# ---------------------------------------------------------------- journeys

def agg_journeys(rows):
    ramp = defaultdict(list)
    fixed = defaultdict(list)
    at_max = defaultdict(list)
    for r in rows:
        k = (r["ds"], r["journey"], r["contender"])
        if r["mode"] == "ramp":
            ramp[k].append(r["max_pass_rate"] or 0.0)
            passing = [st for st in r["steps"] if st["pass"]]
            if passing:
                at_max[k].append(passing[-1])
        else:
            fixed[k].append(r["steps"][0])
    out = {}
    for k in set(ramp) | set(fixed):
        steps = fixed.get(k, [])
        out[k] = {
            "max_rate": med(ramp.get(k, [])),
            "max_rate_spread": spread(ramp.get(k, [])),
            "fixed_rate": med([s["rate"] for s in steps]),
            "journey_p50_ms": med([s["journey_latency"]["p50_ms"] for s in steps]),
            "journey_p99_ms": med([s["journey_latency"]["p99_ms"] for s in steps]),
            "req_p50_ms": med([s["request_latency"]["p50_ms"] for s in steps]),
            "req_p99_ms": med([s["request_latency"]["p99_ms"] for s in steps]),
            "requests_per_journey": med([s["requests_per_journey"] for s in steps]),
            "redirects_per_journey": med([s["redirects_per_journey"] for s in steps]),
            "redirect_ms_per_journey": med([s["redirect_ms_per_journey"] for s in steps]),
            "failed": sum(s["journeys_failed"] for s in steps),
            "wrong": sum(s["counts"]["check_failed"] for s in steps),
            "server_cpu_per_journey": med([s["server_cpu_s"] / max(s["journeys_ok"], 1) for s in steps]),
            "peak_rss_mib": med([s["server_rss"]["peak_working_set"] / MIB for s in steps]),
            "mean_rss_mib": med([s["server_rss"]["mean_working_set"] / MIB for s in steps]),
            "at_max_peak_rss_mib": med([s["server_rss"]["peak_working_set"] / MIB for s in at_max.get(k, [])]),
            "at_max_cpu_per_journey": med([s["server_cpu_s"] / max(s["journeys_ok"], 1) for s in at_max.get(k, [])]),
            "at_max_req_per_s": med([s["requests"] / s["duration_s"] for s in at_max.get(k, [])]),
        }
    return out


# ---------------------------------------------------------------- report

def main():
    d = sys.argv[1]
    env = json.load(open(os.path.join(d, "env.json"), encoding="utf-8")) if os.path.exists(os.path.join(d, "env.json")) else {}
    plans = {ds: json.load(open(os.path.join(d, f"plan_{ds}.json"), encoding="utf-8"))
             for ds in DATASETS if os.path.exists(os.path.join(d, f"plan_{ds}.json"))}
    w1_rows = [r for ds in DATASETS for r in jl(os.path.join(d, f"w1_{ds}.jsonl"))]
    w1 = agg_w1(w1_rows)
    attrib = agg_attrib([r for ds in DATASETS for r in jl(os.path.join(d, f"attrib_{ds}.jsonl"))])
    journeys = agg_journeys([r for ds in DATASETS for r in jl(os.path.join(d, f"journeys_{ds}.jsonl"))])
    bursts = [r for ds in DATASETS for r in jl(os.path.join(d, f"burst_{ds}.jsonl"))]
    resources = [r for ds in DATASETS for r in jl(os.path.join(d, f"resources_{ds}.jsonl"))]
    scans = jl(os.path.join(d, "scan.jsonl"))
    dupes = [r for ds in DATASETS for r in jl(os.path.join(d, f"dupes_{ds}.jsonl"))]

    endpoints = {ds: [e["name"] for e in p["plan"]] for ds, p in plans.items()}
    paths = {(ds, e["name"]): e["path"] for ds, p in plans.items() for e in p["plan"]}
    concs = sorted({k[2] for k in w1})
    L = []
    P = L.append

    P(f"# Django vs Rust backend benchmark — {os.path.basename(os.path.abspath(d))}\n")
    P("Plan: `plans/rust-backend/05-benchmarks.md`. Scripts: `apps/backend-rs/bench/` "
      "(`run_bench.py`, `w4.py`, `lpb.py`, load client `client/` = `lpbench`). "
      "Raw data: the `*.jsonl` files next to this report; aggregated: `results.json`.\n")

    # ------------------------------------------------ environment
    P("## Environment\n")
    for k, v in env.get("summary", {}).items():
        P(f"- **{k}:** {v}")
    P("")

    # ------------------------------------------------ headline
    headline = []
    for ds in ("50k", "250k"):
        if ds not in endpoints:
            continue
        rows = []
        for ep in endpoints[ds]:
            c = {n: w1.get((ds, ep, 1, n)) for n in CONTENDERS}
            peak = {n: max((w1[(ds, ep, cc, n)]["rps"] or 0 for cc in concs if (ds, ep, cc, n) in w1
                            and not w1[(ds, ep, cc, n)]["wrong"]), default=None) for n in CONTENDERS}
            if not any(c.values()):
                continue
            rows.append((ep, c, peak))
        if rows:
            headline.append((ds, rows))

    notes_path = os.path.join(d, "notes.md")
    if os.path.exists(notes_path):
        P(open(notes_path, encoding="utf-8").read().strip() + "\n")

    # ------------------------------------------------ W1
    if w1:
        P("## W1 — per-endpoint micro-benchmarks\n")
        P("Closed loop, one path per cell, 20 s measured after a 2 s warm-up (250k: see deviations), "
          "5 repetitions after a discarded warm-up rep, contenders alternating A B C / C B A. "
          "Median over repetitions; `†` = some requests timed out (60 s) or failed to connect, "
          "`FAIL(data)` = a response failed the correctness check, `sat.` = not run because the contender "
          "already timed out at a lower concurrency in that repetition. Django is called on its slash form.\n")
        for ds, rows in headline:
            P(f"### {ds}: speedup summary (rust vs django-tuned / django-shipped)\n")
            P("| endpoint | p50 @c=1 tuned | p50 @c=1 rust | latency speedup vs tuned | vs shipped | peak rps shipped | peak rps tuned | peak rps rust | throughput speedup vs tuned | vs shipped |")
            P("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
            for ep, c, peak in rows:
                t, r, s = c.get("django-tuned"), c.get("rust"), c.get("django-shipped")
                lat_t = ratio(t and t["p50_ms"], r and r["p50_ms"])
                lat_s = ratio(s and s["p50_ms"], r and r["p50_ms"])
                P(f"| {ep} | {cell_txt(t, 'p50_ms', 2)} | {cell_txt(r, 'p50_ms', 2)} | {fx(lat_t)} | {fx(lat_s)} | "
                  f"{fmt(peak['django-shipped'])} | {fmt(peak['django-tuned'])} | {fmt(peak['rust'])} | "
                  f"{fx(ratio(peak['rust'], peak['django-tuned']))} | {fx(ratio(peak['rust'], peak['django-shipped']))} |")
            lat = [ratio(c["django-tuned"]["p50_ms"], c["rust"]["p50_ms"]) for _, c, _ in rows
                   if c.get("django-tuned") and c.get("rust") and c["django-tuned"]["p50_ms"] and c["rust"]["p50_ms"]]
            thr = [ratio(p["rust"], p["django-tuned"]) for _, _, p in rows if p["rust"] and p["django-tuned"]]
            if lat and thr:
                gm = lambda xs: statistics.geometric_mean(xs)  # noqa: E731
                P(f"\nGeometric mean over endpoints: latency speedup {gm(lat):.2f}×, peak-throughput speedup {gm(thr):.2f}× (vs django-tuned).\n")
            P("")
        for ds in endpoints:
            if not any(k[0] == ds for k in w1):
                continue
            P(f"### {ds}: requests/s by concurrency (median of reps; p50 / p99 ms below)\n")
            P("| endpoint | c | shipped rps | tuned rps | rust rps | shipped p50/p99 | tuned p50/p99 | rust p50/p99 | CPU-s/1k req shipped / tuned / rust | PG CPU-s/1k tuned / rust |")
            P("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
            for ep in endpoints[ds]:
                for cc in concs:
                    c = {n: w1.get((ds, ep, cc, n)) for n in CONTENDERS}
                    if not any(c.values()):
                        continue
                    lat = lambda x: "–" if not x or x["p50_ms"] is None else f"{x['p50_ms']:.1f} / {x['p99_ms']:.1f}"  # noqa: E731
                    cpu = " / ".join(fmt(c[n] and c[n]["server_cpu_per_1k"], 2) for n in CONTENDERS)
                    pg = " / ".join(fmt(c[n] and c[n]["pg_cpu_per_1k"], 2) for n in ("django-tuned", "rust"))
                    P(f"| {ep} | {cc} | {cell_txt(c['django-shipped'])} | {cell_txt(c['django-tuned'])} | {cell_txt(c['rust'])} | "
                      f"{lat(c['django-shipped'])} | {lat(c['django-tuned'])} | {lat(c['rust'])} | {cpu} | {pg} |")
            P("")
            fails = [(k, v) for k, v in w1.items() if k[0] == ds and (v["wrong"] or v["errors"])]
            if fails:
                P("Cells with failures (errors = timeouts/connect errors under overload; wrong = failed check):\n")
                for k, v in sorted(fails):
                    P(f"- {k[1]} c={k[2]} {k[3]}: wrong {v['wrong']}, errors {v['errors']} — first: `{v['first_failure']}`")
                P("")

    # ------------------------------------------------ attribution
    if attrib:
        P("## Attribution: runtime, queries or payload?\n")
        P("One request per endpoint on a dedicated clone with `log_min_duration_statement = 0` "
          "(median of 3 after 3 warm-ups); statements and their summed duration are read from the "
          "Postgres log (pg_stat_statements is not available on this server). `queries` counts "
          "executed statements (simple `statement` + extended `execute`); `DB ms` sums parse + bind + "
          "execute durations; app time ≈ W1 p50 at c=1 − DB ms. Classification rules: *query* = fewer "
          "statements or < 70 % DB time, but *query LOSS* whenever DB time is > 130 %; *payload* = "
          "< 80 % bytes; *runtime* = < 70 % app time; LOSS = the reverse by 30 %. DB ms here include the "
          "cost of logging every statement, which weighs more on the side issuing more statements.\n")
        for ds in endpoints:
            if not any(k[0] == ds for k in attrib):
                continue
            P(f"### {ds}\n")
            P("| endpoint | queries tuned | queries rust | DB ms tuned | DB ms rust | bytes tuned | bytes rust | app ms tuned | app ms rust | classification |")
            P("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|")
            for ep in endpoints[ds]:
                a, b = attrib.get((ds, ep, "django-tuned")), attrib.get((ds, ep, "rust"))
                if not a and not b:
                    continue
                pt = w1.get((ds, ep, 1, "django-tuned"))
                pr = w1.get((ds, ep, 1, "rust"))
                p50t = pt and pt["p50_ms"]
                p50r = pr and pr["p50_ms"]
                app = lambda p, x: None if p is None or x is None else max(p - x["db_ms"], 0.0)  # noqa: E731
                P(f"| {ep} | {fmt(a and a['queries'], 0)} | {fmt(b and b['queries'], 0)} | {fmt(a and a['db_ms'], 2)} | "
                  f"{fmt(b and b['db_ms'], 2)} | {fmt(a and a['bytes'], 0)} | {fmt(b and b['bytes'], 0)} | "
                  f"{fmt(app(p50t, a), 2)} | {fmt(app(p50r, b), 2)} | {classify(a, b, p50t, p50r)} |")
            P("")

    # ------------------------------------------------ journeys
    if journeys:
        P("## W2 — user journeys\n")
        P("Open model (journeys start at a fixed rate whatever the server does), each journey behaves "
          "like one browser tab (≤ 6 requests in flight, redirects followed by hand). **Max sustainable "
          "rate** = highest rate of a ramp (×1.5 steps in rep 1, then ×1.12 around it) whose step has "
          "request p99 < 500 ms, no unfinished/failed journeys (≤ 1 %) and no failed checks. **Fixed rate** = "
          "half of django-shipped's max, the same for all contenders.\n")
        for ds in DATASETS:
            ks = sorted({k[1] for k in journeys if k[0] == ds})
            if not ks:
                continue
            P(f"### {ds}\n")
            P("| journey | max journeys/s shipped | tuned | rust | rust/tuned | rust/shipped | fixed rate | journey p50 ms shipped / tuned / rust | req p99 ms shipped / tuned / rust | requests/journey dj / rust | 301s/journey (dj) | ms in 301s/journey shipped / tuned |")
            P("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
            for j in ks:
                c = {n: journeys.get((ds, j, n)) for n in CONTENDERS}
                g = lambda n, key: c[n] and c[n][key]  # noqa: E731
                P(f"| {j} | {fmt(g('django-shipped', 'max_rate'), 2)} | {fmt(g('django-tuned', 'max_rate'), 2)} | "
                  f"{fmt(g('rust', 'max_rate'), 2)} | {fx(ratio(g('rust', 'max_rate'), g('django-tuned', 'max_rate')))} | "
                  f"{fx(ratio(g('rust', 'max_rate'), g('django-shipped', 'max_rate')))} | {fmt(g('rust', 'fixed_rate'), 3)} | "
                  + " / ".join(fmt(g(n, "journey_p50_ms"), 0) for n in CONTENDERS) + " | "
                  + " / ".join(fmt(g(n, "req_p99_ms"), 1) for n in CONTENDERS) + " | "
                  f"{fmt(g('django-tuned', 'requests_per_journey'), 1)} / {fmt(g('rust', 'requests_per_journey'), 1)} | "
                  f"{fmt(g('django-tuned', 'redirects_per_journey'), 1)} | "
                  f"{fmt(g('django-shipped', 'redirect_ms_per_journey'), 1)} / {fmt(g('django-tuned', 'redirect_ms_per_journey'), 1)} |")
            P("")
            P("**The 301 effect.** Django answers the frontend's `/albums/date/{id}?page=` (and `/exists/{h}`) "
              "with a 301 to the slash form; Rust answers directly. The table shows the redirects per journey "
              "and the summed latency of those redirect round trips (requests of one journey overlap, so the "
              "sum is an upper bound on the wall time they add). Compare it with the journey p50 difference.\n")

    # ------------------------------------------------ W3
    if bursts:
        P("## W3 — thumbnail storm\n")
        P("200 `square_thumbnails_small` GETs of the newest photos on a fresh connection pool, "
          "at most 6 (browser HTTP/1.1 per-host limit) or 64 in flight; time to last byte. "
          "Every rep takes a different slice of 200 photos (rep 0 = warm-up, discarded). No nginx on "
          "this box: Django streams the files itself (SERVE_FRONTEND), Rust with LP_MEDIA_MODE=direct.\n")
        P("| dataset | conns | shipped ms | tuned ms | rust ms | rust vs tuned | failures |")
        P("|---|---:|---:|---:|---:|---:|---|")
        g = defaultdict(list)
        bad = defaultdict(int)
        for r in bursts:
            if r["rep"] == 0:
                continue
            g[(r["ds"], r["conns"], r["contender"])].append(r["ttlb_ms"])
            bad[(r["ds"], r["conns"], r["contender"])] += r["counts"]["check_failed"] + r["counts"]["errors"]
        for ds in DATASETS:
            for conns in sorted({k[1] for k in g if k[0] == ds}):
                m = {n: med(g.get((ds, conns, n), [])) for n in CONTENDERS}
                sp = {n: spread(g.get((ds, conns, n), [])) for n in CONTENDERS}
                cellf = lambda n: f"{fmt(m[n], 0)} ({fmt(sp[n][0], 0)}–{fmt(sp[n][1], 0)})"  # noqa: E731
                P(f"| {ds} | {conns} | {cellf('django-shipped')} | {cellf('django-tuned')} | {cellf('rust')} | "
                  f"{fx(ratio(m['django-tuned'], m['rust']))} | "
                  + ", ".join(f"{n}: {bad[(ds, conns, n)]}" for n in CONTENDERS if bad[(ds, conns, n)]) + " |")
        P("")

    # ------------------------------------------------ W4
    if scans:
        P("## W4 — background work\n")
        P("### Full scan from empty (ML off) and no-change rescan\n")
        P("Library: 2000 unique JPEGs (Pillow re-encodes of `deploy/e2e/photos`, 4032×3024 / 2048×1536 / 800×600, "
          "varied EXIF date, camera, 40 % GPS), 20 PNG screenshots, 5 H.264 videos: 2025 files, 3.4 GB. "
          "Each run: fresh clone of the fixture with a new user whose scan directory is the library, empty "
          "media tree, WORKER_CONCURRENCY=N for both. Wall time = scan job queued → its LongRunningJob "
          "finished (every file group done). The rescan is a second non-full scan after the follow-up "
          "jobs have drained.\n")
        P("| variant | N | scan s (spread) | files/s | CPU s | peak working set MiB | rescan s | photos | with thumbnail | with timestamp | with GPS | thumbnail files |")
        P("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        g = defaultdict(list)
        for r in scans:
            g[r["variant"]].append(r)
        for v in CONTENDERS:
            rs = g.get(v)
            if not rs:
                continue
            o = rs[-1]["outcome"]
            lo, hi = spread([r["scan_s"] for r in rs])
            P(f"| {v} | {rs[0]['workers']} | {fmt(med([r['scan_s'] for r in rs]), 1)} ({fmt(lo, 1)}–{fmt(hi, 1)}) | "
              f"{fmt(med([r['files_per_s'] for r in rs]), 1)} | {fmt(med([r['cpu_s'] for r in rs]), 0)} | "
              f"{fmt(med([r['rss']['peak_working_set'] / MIB for r in rs]), 0)} | {fmt(med([r['rescan_s'] for r in rs]), 2)} | "
              f"{o['photos']} | {o['with_thumbnail_row']} | {o['with_timestamp']} | {o['with_gps']} | {o['thumbnail_files']} |")
        P("")
    if dupes:
        P("### Duplicate detection (exact copies + visual pHash, defaults)\n")
        P("| dataset | variant | seconds (spread) | CPU s | peak working set MiB | groups found |")
        P("|---|---|---:|---:|---:|---|")
        g = defaultdict(list)
        for r in dupes:
            g[(r["ds"], r["variant"])].append(r)
        for (ds, v), rs in sorted(g.items()):
            lo, hi = spread([r["seconds"] for r in rs])
            if any(r.get("timed_out") for r in rs):
                job = rs[-1]["job"] or {}
                P(f"| {ds} | {v} | > {fmt(rs[-1]['timeout_s'], 0)} (stopped; progress {job.get('current')}/{job.get('target')}) | "
                  f"{fmt(med([r['cpu_s'] for r in rs]), 1)} | {fmt(med([r['rss']['peak_working_set'] / MIB for r in rs]), 0)} | – |")
                continue
            P(f"| {ds} | {v} | {fmt(med([r['seconds'] for r in rs]), 2)} ({fmt(lo, 2)}–{fmt(hi, 2)}) | "
              f"{fmt(med([r['cpu_s'] for r in rs]), 1)} | {fmt(med([r['rss']['peak_working_set'] / MIB for r in rs]), 0)} | "
              f"{rs[-1]['groups']} ({rs[-1]['members']} photos) |")
        P("")

    # ------------------------------------------------ W5
    if resources or journeys:
        P("## W5 — resources\n")
        P("Working set (Windows' RSS) of each backend's whole process tree (Django: uvicorn parent + "
          "workers; the Git Bash wrapper and the venv launcher stub are excluded). Cold start = process "
          "spawn → first 200 from `/api/healthz`.\n")
        P("| dataset | contender | cold start s | idle MiB (procs) | after warm-up MiB | J1 fixed-rate mean / peak MiB | J1 at own max rate: peak MiB (req/s) | server CPU-s per J1 journey |")
        P("|---|---|---:|---:|---:|---:|---:|---:|")
        g = defaultdict(list)
        for r in resources:
            g[(r["ds"], r["contender"])].append(r)
        for ds in DATASETS:
            for n in CONTENDERS:
                rs = g.get((ds, n), [])
                jr = journeys.get((ds, "J1", n))
                if not rs and not jr:
                    continue
                P(f"| {ds} | {n} | {fmt(med([r['cold_start_s'] for r in rs]), 2)} | "
                  f"{fmt(med([r['idle']['working_set'] / MIB for r in rs]), 0)} ({rs[0]['idle']['procs'] if rs else '–'}) | "
                  f"{fmt(med([r['idle_after_warmup']['working_set'] / MIB for r in rs]), 0)} | "
                  f"{fmt(jr and jr['mean_rss_mib'], 0)} / {fmt(jr and jr['peak_rss_mib'], 0)} | "
                  f"{fmt(jr and jr['at_max_peak_rss_mib'], 0)} ({fmt(jr and jr['at_max_req_per_s'], 0)}) | "
                  f"{fmt(jr and jr['server_cpu_per_journey'], 3)} |")
        P("")

    # ------------------------------------------------ validation
    if plans:
        P("## Correctness guard\n")
        P("Before any load, every W1 endpoint was requested from all three contenders on their own clone of "
          "the same template and checked against django-tuned's answer (status, item counts, first ids / "
          "key values; media: exact byte length). During the runs every measured response is checked the "
          "same way by `lpbench`. Pointers the contenders disagreed on would have been dropped from the "
          "checks and listed here:\n")
        for ds, p in plans.items():
            dropped = {v["endpoint"]: v["dropped_eq"] for v in p["validation"] if v["dropped_eq"]}
            mism = {v["endpoint"]: {k: x for k, x in v["contenders"].items() if x} for v in p["validation"]
                    if any(v["contenders"].values())}
            P(f"- **{ds}**: {len(p['validation'])} endpoints; mismatches: {mism or 'none'}; dropped checks: {dropped or 'none'}")
        P("")
        P("W1 paths:\n")
        for ds in plans:
            P(f"- {ds}: " + ", ".join(f"`{e}` = `{paths[(ds, e)]}`" for e in endpoints[ds]))
        P("")

    dev = os.path.join(d, "deviations.md")
    if os.path.exists(dev):
        P(open(dev, encoding="utf-8").read().strip() + "\n")

    with open(os.path.join(d, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

    def keyed(m):
        return [dict(zip(("ds", "endpoint", "concurrency", "contender")[: len(k)] if len(k) == 4 else
                             ("ds", "endpoint", "contender") if len(k) == 3 else range(len(k)), k), **v)
                for k, v in sorted(m.items(), key=lambda kv: tuple(str(x) for x in kv[0]))]

    results = {
        "environment": env,
        "w1": keyed(w1),
        "attribution": [dict(v, sample=None) for v in attrib.values()],
        "journeys": [dict(ds=k[0], journey=k[1], contender=k[2], **v) for k, v in sorted(journeys.items())],
        "burst": bursts,
        "resources": resources,
        "scan": scans,
        "dupes": dupes,
        "validation": {ds: p["validation"] for ds, p in plans.items()},
    }
    with open(os.path.join(d, "results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, default=str)
    print(f"wrote {os.path.join(d, 'REPORT.md')} and results.json")


if __name__ == "__main__":
    main()
