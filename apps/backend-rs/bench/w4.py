"""W4 background work (05-benchmarks.md §4): a full scan from empty with ML off,
a no-change rescan, and duplicate detection.

  python w4.py scan  --out <dir> [--reps 3 --workers 6 --variants django-shipped,django-tuned,rust]
  python w4.py dupes --out <dir> [--ds 50k --reps 3]

A/B of Rust settings in one binary: `--variants rust,rust@v --variant-env v:LP_X=1,LP_Y=2`
(alternating order per rep). `--idle-wait 75` snapshots the tree's memory 75 s after
the rescan; `--dump-phash` writes image_hash/pHash per run. Rust runs also record the
tree's peak working set and private bytes per executable (psutil).

Django runs as it ships (uvicorn web + `manage.py qcluster` with
WORKER_CONCURRENCY=N, ORM broker, and the exif sidecar on its fixed port 8010);
django-tuned only lifts qcluster's 50-task worker recycling. Rust runs
`librephotos-rs serve` (API + embedded worker) with WORKER_CONCURRENCY=N.
"""

import argparse
import os
import shutil
import statistics
import subprocess
import sys
import time
import uuid

import lpb
from lpb import log

SCAN_LIB = r"C:\Users\Niaz\librephotos\rust-pg\bench-scan\lib"
SCAN_TEMPLATE = "lp_bench_scan"
SCAN_USER = "scanner"
WEB_PORT = 8921
EXIF_PORT = 8010


def scan_template():
    """lp_fixture + Rust adoption + an admin `scanner` whose scan directory is the
    W4 library: that user starts with no photos."""
    if lpb.psql(f"SELECT 1 FROM pg_database WHERE datname = '{SCAN_TEMPLATE}'") == "1":
        return
    build = "lp_run_scan_build"
    lpb.psql(f'DROP DATABASE IF EXISTS "{build}" WITH (FORCE)')
    lpb.psql(f'CREATE DATABASE "{build}" TEMPLATE lp_fixture')
    env = lpb.rust_env(build, 8998)
    subprocess.run([lpb.RS_BIN, "adopt"], env=env, check=True, capture_output=True)
    subprocess.run([lpb.RS_BIN, "createadmin", SCAN_USER, "scanner@example.com"],
                   env={**env, "ADMIN_PASSWORD": uuid.uuid4().hex}, check=True, capture_output=True)
    lib = SCAN_LIB.replace("'", "''")
    lpb.psql(f"UPDATE api_user SET scan_directory = '{lib}' WHERE username = '{SCAN_USER}'", build)
    lpb.psql(f"VACUUM ANALYZE", build)
    lpb.psql(f'ALTER DATABASE "{build}" RENAME TO "{SCAN_TEMPLATE}"')
    lpb.psql(f'ALTER DATABASE "{SCAN_TEMPLATE}" IS_TEMPLATE true')


def user_id(db, username):
    return int(lpb.psql(f"SELECT id FROM api_user WHERE username = '{username}'", db))


def lrj(db, job_id):
    row = lpb.psql(
        "SELECT finished, failed, progress_current, progress_target, "
        "extract(epoch FROM (finished_at - started_at)) FROM api_longrunningjob "
        f"WHERE job_id = '{job_id}'", db)
    if not row:
        return None
    f, failed, cur, tgt, secs = row.split("|")
    return {"finished": f == "t", "failed": failed == "t", "current": int(cur), "target": int(tgt),
            "db_seconds": float(secs) if secs else None}


def queue_busy(db, kind):
    if kind == "rust":
        return int(lpb.psql("SELECT count(*) FROM job_queue WHERE status IN ('queued', 'running') "
                            "AND run_after < now() + interval '5 minutes'", db))
    # A claimed row keeps a lock far in the future (retry = 20000000 s) even when
    # its worker died without acking it; running work shows up as CPU in drain().
    return int(lpb.psql("SELECT count(*) FROM django_q_ormq WHERE lock IS NULL OR lock < now()", db))


class Stack:
    """One contender for background work: web server (+ qcluster + exif sidecar for Django)."""

    def __init__(self, variant, db, media, workers, env=None):
        self.variant, self.db, self.media, self.workers = variant, db, media, workers
        # `rust@<name>`: the Rust server with the extra env of --variant-env <name>:...
        self.kind = "rust" if variant.split("@")[0] == "rust" else "django"
        self.env = env or {}
        self.helpers = []
        self.server = None

    def start(self):
        if self.kind == "rust":
            self.server = lpb.Server("rust", self.db, WEB_PORT, media=self.media,
                                     extra_env={"WORKER_CONCURRENCY": str(self.workers), **self.env}).start()
        else:
            if lpb.listener_pid(EXIF_PORT) is not None:
                raise RuntimeError(f"port {EXIF_PORT} (exif sidecar) is already taken")
            run_dir = os.path.join(lpb.RUNS, "django", f"{self.db}-w4")
            extra = {"WORKER_CONCURRENCY": str(self.workers)}
            if self.variant == "django-tuned":
                extra["LP_Q_RECYCLE"] = "1000000"
            env = lpb.django_env(self.db, self.media, run_dir, extra)
            self.helpers.append(lpb.Proc(f"exif-{self.db}", [lpb.DJANGO_PY, "-m", "service.exif.main"], env))
            lpb.wait_port(EXIF_PORT)
            self.helpers.append(lpb.Proc(f"qcluster-{self.db}", [lpb.DJANGO_PY, "manage.py", "qcluster"], env))
            self.server = lpb.Server("django-shipped", self.db, WEB_PORT, media=self.media).start()
        pids = self.pids()
        lpb.pin(pids, lpb.MASK_SERVER)
        return self

    def pids(self):
        return [self.server.proc.pid] + [h.proc.pid for h in self.helpers]

    def stop(self):
        if self.server:
            self.server.stop()
        for h in self.helpers:
            h.stop()
        self.helpers = []
        for _ in range(50):
            if lpb.listener_pid(EXIF_PORT) is None:
                break
            time.sleep(0.2)

    def trigger_scan(self, uid):
        """Start a (non-full) scan of the user's directory; returns (job_id, t0)."""
        token = lpb.mint_token(uid)
        if self.kind == "rust":
            t0 = time.perf_counter()
            status, body, _ = lpb.http_get(f"{self.server.base}/api/scanphotos/", token)
            if status != 200:
                raise RuntimeError(f"scanphotos: {status} {body[:200]}")
            import json
            return json.loads(body)["job_id"], t0
        # Django's ScanPhotosView chains download_models first whenever a model
        # file is missing (all of them here, ML is off): enqueue scan_photos
        # itself, as the view does after that step.
        job_id = str(uuid.uuid4())
        script = (
            "import django; django.setup()\n"
            "from django_q.tasks import AsyncTask\n"
            "from api.directory_watcher import scan_photos\n"
            "from api.models import User\n"
            f"u = User.objects.get(id={uid})\n"
            f"AsyncTask(scan_photos, u, False, '{job_id}', u.scan_directory).run()\n"
        )
        env = lpb.django_env(self.db, self.media, os.path.join(lpb.RUNS, "django", f"{self.db}-w4"))
        r = subprocess.run([lpb.DJANGO_PY, "-c", script + "import time; print(time.time())"], env=env,
                           cwd=lpb.BACKEND_DIR, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-2000:])
        # The clock starts when the task is queued: the one-off script's Django
        # start-up is not part of the scan.
        enqueued_at = float(r.stdout.strip().splitlines()[-1])
        t0 = time.perf_counter() - (time.time() - enqueued_at)
        return job_id, t0

    def trigger_dupes(self, uid):
        token = lpb.mint_token(uid)
        import json
        import urllib.request
        req = urllib.request.Request(f"{self.server.base}/api/duplicates/detect", data=b"{}", method="POST",
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status != 202:
                raise RuntimeError(f"duplicates/detect: {r.status}")
            json.loads(r.read())
        return t0


def wait_job(db, job_id, t0, timeout, what):
    last = None
    while True:
        j = lrj(db, job_id)
        if j and j["finished"]:
            return time.perf_counter() - t0, j
        if j and (j["current"], j["target"]) != last:
            last = (j["current"], j["target"])
        if time.perf_counter() - t0 > timeout:
            raise RuntimeError(f"{what} not finished after {timeout}s: {j}")
        time.sleep(0.1)


def drain(stack, timeout=900):
    t0 = time.perf_counter()
    while queue_busy(stack.db, stack.kind) and time.perf_counter() - t0 < timeout:
        time.sleep(1)
    lpb.quiesce(stack.pids() + [lpb.pg_postmaster()], limit_s=120)
    return time.perf_counter() - t0


def scan_outcome(db, uid, media):
    q = lambda sql: lpb.psql(sql, db)  # noqa: E731
    row = q(
        "SELECT count(*), count(*) FILTER (WHERE video), count(exif_timestamp), count(exif_gps_lat), "
        "count(t.photo_id), count(perceptual_hash), count(DISTINCT image_hash) "
        f"FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = {uid}").split("|")
    files, sizes = 0, {}
    for k in ("thumbnails_big", "square_thumbnails", "square_thumbnails_small"):
        d = os.path.join(media, "protected_media", k)
        if os.path.isdir(d):
            names = os.listdir(d)
            files += len(names)
            sizes[k] = sum(os.path.getsize(os.path.join(d, n)) for n in names)
    keys = ["photos", "videos", "with_timestamp", "with_gps", "with_thumbnail_row", "with_phash", "distinct_hashes"]
    out = dict(zip(keys, map(int, row)))
    out["thumbnail_files"] = files
    out["thumbnail_bytes"] = sizes
    out["date_albums"] = int(q(f"SELECT count(*) FROM api_albumdate WHERE owner_id = {uid}"))
    return out


class ExeSampler:
    """psutil, every 0.5 s: working set and private bytes of the server's tree,
    the total and per executable name (exiftool's perl next to the server)."""

    def __init__(self, root_pid, period=0.5):
        import threading
        self.root, self.period = root_pid, period
        self.peak = {"rss": 0, "private": 0, "by_exe_at_peak": {}}
        self.peak_by_exe = {}
        self.max_procs = {}
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    @staticmethod
    def snap(root_pid):
        import psutil
        try:
            p = psutil.Process(root_pid)
            procs = [p, *p.children(recursive=True)]
        except psutil.Error:
            return {"rss": 0, "private": 0, "by_exe": {}, "procs": {}}
        rss = priv = 0
        by, n = {}, {}
        for q in procs:
            try:
                m, name = q.memory_info(), q.name().lower()
            except psutil.Error:
                continue
            rss += m.rss
            priv += m.private
            e = by.setdefault(name, [0, 0])
            e[0] += m.rss
            e[1] += m.private
            n[name] = n.get(name, 0) + 1
        return {"rss": rss, "private": priv, "by_exe": by, "procs": n}

    def _run(self):
        while not self._stop.is_set():
            s = self.snap(self.root)
            if s["rss"] > self.peak["rss"]:
                self.peak.update(rss=s["rss"], by_exe_at_peak=s["by_exe"])
            self.peak["private"] = max(self.peak["private"], s["private"])
            for k, (r, pv) in s["by_exe"].items():
                cur = self.peak_by_exe.setdefault(k, [0, 0])
                cur[0], cur[1] = max(cur[0], r), max(cur[1], pv)
            for k, c in s["procs"].items():
                self.max_procs[k] = max(self.max_procs.get(k, 0), c)
            self._stop.wait(self.period)

    def finish(self):
        self._stop.set()
        self._t.join()
        mib = lambda b: round(b / 2**20, 1)  # noqa: E731
        return {"peak_rss_mib": mib(self.peak["rss"]), "peak_private_mib": mib(self.peak["private"]),
                "by_exe_at_peak_mib": {k: [mib(r), mib(p)] for k, (r, p) in self.peak["by_exe_at_peak"].items()},
                "peak_by_exe_mib": {k: [mib(r), mib(p)] for k, (r, p) in self.peak_by_exe.items()},
                "max_procs": self.max_procs}


def variant_envs(specs):
    """--variant-env name:K=V,K2=V2 (repeatable) -> {name: {K: V}}."""
    out = {}
    for spec in specs or []:
        name, _, kv = spec.partition(":")
        out[name] = dict(item.split("=", 1) for item in kv.split(",") if item)
    return out


def stage_scan(args):
    scan_template()
    envs = variant_envs(args.variant_env)
    path = os.path.join(args.out, "scan.jsonl")
    rows = lpb.read_jsonl(path) if args.resume else []
    if not args.resume and os.path.exists(path):
        os.remove(path)
    done = {(r["rep"], r["variant"]) for r in rows}
    variants = args.variants.split(",")
    pm = lpb.pg_postmaster()
    lpb.pin([pm], lpb.MASK_PG)
    try:
        for rep in range(1, args.reps + 1):
            order = variants if rep % 2 == 1 else list(reversed(variants))
            for variant in order:
                if (rep, variant) in done:
                    continue
                slug = variant.replace("-", "_").replace("@", "_")
                db = f"lp_run_scan_{slug}"
                media = os.path.join(lpb.RUNS, "scan-media", slug)
                shutil.rmtree(media, ignore_errors=True)
                os.makedirs(os.path.join(media, "data"), exist_ok=True)
                lpb.clone(SCAN_TEMPLATE, db)
                uid = user_id(db, SCAN_USER)
                env = envs.get(variant.partition("@")[2], {}) if "@" in variant else {}
                stack = Stack(variant, db, media, args.workers, env).start()
                try:
                    lpb.quiesce(stack.pids() + [pm], limit_s=60)
                    cpu0 = lpb.lpbench("procstat", "--pids", ",".join(map(str, stack.pids())))["cpu_s"]
                    sampler = lpb.TreeSampler(stack.pids(), period=0.5)
                    exe = ExeSampler(stack.server.proc.pid) if stack.kind == "rust" else None
                    job_id, t0 = stack.trigger_scan(uid)
                    wall, j = wait_job(db, job_id, t0, args.timeout, "scan")
                    rss = sampler.finish()
                    if exe:
                        rss["exe"] = exe.finish()
                        log(f"  tree peak {rss['exe']['peak_rss_mib']} MiB rss / {rss['exe']['peak_private_mib']} MiB "
                            f"private; by exe at peak {rss['exe']['by_exe_at_peak_mib']}; procs {rss['exe']['max_procs']}")
                    cpu_tree = lpb.lpbench("procstat", "--pids", ",".join(map(str, stack.pids())))["cpu_s"] - cpu0
                    cpu = rss["cpu_s"]
                    outcome = scan_outcome(db, uid, media)
                    log(f"scan rep{rep} {variant:<15} {wall:7.1f} s  {outcome['photos'] / wall:6.1f} files/s  "
                        f"peak {rss['peak_working_set'] / 2**20:.0f} MiB  cpu {cpu:.0f} s  {outcome}")
                    drained = drain(stack)
                    # no-change rescan: the same trigger again once the follow-ups are done
                    cpu1 = lpb.lpbench("procstat", "--pids", ",".join(map(str, stack.pids())))["cpu_s"]
                    job2, t1 = stack.trigger_scan(uid)
                    wall2, j2 = wait_job(db, job2, t1, args.timeout, "rescan")
                    cpu2 = lpb.lpbench("procstat", "--pids", ",".join(map(str, stack.pids())))["cpu_s"] - cpu1
                    after = scan_outcome(db, uid, media)
                    log(f"rescan rep{rep} {variant:<15} {wall2:7.2f} s  target {j2['target']}  photos {after['photos']}")
                    idle = {}
                    if stack.kind == "rust":
                        idle["after_rescan"] = ExeSampler.snap(stack.server.proc.pid)
                        if args.idle_wait:
                            time.sleep(args.idle_wait)
                            idle[f"after_{args.idle_wait:g}s"] = ExeSampler.snap(stack.server.proc.pid)
                        for k, s in idle.items():
                            log(f"  idle {k}: rss {s['rss'] / 2**20:.1f} MiB private {s['private'] / 2**20:.1f} MiB "
                                f"procs {s['procs']}")
                    if args.dump_phash:
                        with open(os.path.join(args.out, f"phash_{slug}_rep{rep}.tsv"), "w", encoding="utf-8") as f:
                            f.write(lpb.psql("SELECT p.image_hash, p.perceptual_hash FROM api_photo p "
                                             f"WHERE p.owner_id = {uid} ORDER BY 1", db) + "\n")
                    lpb.append_jsonl(path, {
                        "idle": idle,
                        "rep": rep, "variant": variant, "workers": args.workers, "scan_s": wall,
                        "scan_db_s": j["db_seconds"], "files_per_s": outcome["photos"] / wall, "cpu_s": cpu,
                        "cpu_s_live_tree": cpu_tree,
                        "rss": rss, "job": j, "outcome": outcome, "followups_drain_s": drained,
                        "rescan_s": wall2, "rescan_db_s": j2["db_seconds"], "rescan_cpu_s": cpu2, "rescan_job": j2,
                        "rescan_outcome": after, "t": time.time()})
                finally:
                    stack.stop()
                    lpb.drop(db)
    finally:
        lpb.pin([pm], lpb.MASK_ALL)


def stage_dupes(args):
    path = os.path.join(args.out, f"dupes_{args.ds}.jsonl")
    if os.path.exists(path) and not args.resume:
        os.remove(path)
    variants = args.variants.split(",")
    pm = lpb.pg_postmaster()
    lpb.pin([pm], lpb.MASK_PG)
    try:
        for rep in range(1, args.reps + 1):
            order = variants if rep % 2 == 1 else list(reversed(variants))
            for variant in order:
                db = f"lp_run_{args.ds}_dupes_{variant.replace('-', '_')}"
                lpb.clone(f"lp_bench_{args.ds}", db)
                stack = Stack(variant, db, lpb.MEDIA, args.workers).start()
                try:
                    lpb.quiesce(stack.pids() + [pm], limit_s=60)
                    before = int(lpb.psql(f"SELECT coalesce(max(id), 0) FROM api_longrunningjob", db))
                    cpu0 = lpb.lpbench("procstat", "--pids", ",".join(map(str, stack.pids())))["cpu_s"]
                    sampler = lpb.TreeSampler(stack.pids(), period=0.5)
                    t0 = stack.trigger_dupes(lpb.ALICE)
                    job_id = None
                    while job_id is None:
                        job_id = lpb.psql(f"SELECT job_id FROM api_longrunningjob WHERE id > {before} "
                                          "AND job_type = 15 ORDER BY id LIMIT 1", db) or None
                        if job_id is None:
                            if time.perf_counter() - t0 > 120:
                                raise RuntimeError("duplicate detection job never started")
                            time.sleep(0.1)
                    timed_out = False
                    try:
                        wall, j = wait_job(db, job_id, t0, args.timeout, "duplicate detection")
                    except RuntimeError:
                        # Reported as "> timeout" with the progress the job had reached.
                        timed_out, wall, j = True, time.perf_counter() - t0, lrj(db, job_id)
                    rss = sampler.finish()
                    cpu = rss["cpu_s"]
                    groups = lpb.psql("SELECT duplicate_type, count(*) FROM api_duplicate WHERE owner_id = 2 "
                                      "GROUP BY 1 ORDER BY 1", db).replace("\n", ", ")
                    members = int(lpb.psql("SELECT count(DISTINCT pd.photo_id) FROM api_photo_duplicates pd JOIN api_duplicate d ON d.id = pd.duplicate_id WHERE d.owner_id = 2", db) or 0)
                    result = lpb.psql(f"SELECT result::text FROM api_longrunningjob WHERE job_id = '{job_id}'", db)
                    log(f"dupes {args.ds} rep{rep} {variant:<15} {wall:7.2f} s{' TIMEOUT' if timed_out else ''}  groups [{groups}] members {members} "
                        f"failed {j['failed']} peak {rss['peak_working_set'] / 2**20:.0f} MiB")
                    lpb.append_jsonl(path, {"rep": rep, "variant": variant, "ds": args.ds, "seconds": wall,
                                            "timed_out": timed_out, "timeout_s": args.timeout,
                                            "db_seconds": j["db_seconds"], "cpu_s": cpu, "rss": rss, "job": j,
                                            "groups": groups, "members": members, "result": result, "t": time.time()})
                finally:
                    stack.stop()
                    lpb.drop(db)
    finally:
        lpb.pin([pm], lpb.MASK_ALL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ds", default="50k")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--workers", type=int, default=lpb.SERVER_CPUS)
    ap.add_argument("--variants", default="django-shipped,django-tuned,rust")
    ap.add_argument("--timeout", type=float, default=3600)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--variant-env", action="append",
                    help="name:K=V,K2=V2 = extra env of variant rust@name (repeatable)")
    ap.add_argument("--idle-wait", type=float, default=0,
                    help="after the rescan, wait this long and snapshot the tree's memory again")
    ap.add_argument("--dump-phash", action="store_true", help="write image_hash -> pHash per run")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    {"scan": stage_scan, "dupes": stage_dupes}[args.stage](args)


if __name__ == "__main__":
    sys.exit(main())
