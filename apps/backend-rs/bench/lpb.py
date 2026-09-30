"""Shared plumbing for the benchmark stages: paths, databases, servers, tokens, lpbench.

Runs with the Django venv's Python (stdlib only). See bench/README.md.
"""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_RS = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(BACKEND_RS))
FIXTURE_DIR = os.path.join(BACKEND_RS, "tests", "fixture")

PG_BIN = r"C:\Users\Niaz\librephotos\rust-pg\pginstall\bin"
PG_LOG = r"C:\Users\Niaz\librephotos\rust-pg\pg.log"
PG_PORT = 5433
BASH = r"C:\Program Files\Git\bin\bash.exe"
LPBENCH = os.environ.get("LP_LPBENCH") or os.path.join(HERE, "client", "target", "release", "lpbench.exe")
RS_BIN = os.environ.get("LP_RS_BIN") or os.path.join(BACKEND_RS, "target", "release", "librephotos-rs.exe")
# Parallel agents: their own database prefix (lp_run_ or lp_t_*) and port block.
RUN_PREFIX = os.environ.get("LP_BENCH_DB_PREFIX", "lp_run_")
PORT_BASE = int(os.environ.get("LP_BENCH_PORT_BASE", "8901"))
VENV = r"C:\Users\Niaz\librephotos\wt-windev\apps\backend\.venv-win"
VENV_SP = os.path.join(VENV, "Lib", "site-packages")
FIXTURE_ROOT = r"C:\Users\Niaz\librephotos\rust-pg\fixture"
MEDIA = r"C:\Users\Niaz\librephotos\rust-pg\bench-media"
RUNS = r"C:\Users\Niaz\librephotos\rust-pg\bench-runs"
SECRET = "rust-bench-secret"
ALICE = 2

# 12 logical CPUs (6 cores x SMT). Server: CPUs 0-5, Postgres: 6-9, load client: 10-11.
MASK_SERVER = "3f"
MASK_PG = "3c0"
MASK_CLIENT = "c00"
MASK_ALL = "fff"
SERVER_CPUS = 6

CONTENDERS = {
    "django-shipped": {"kind": "django", "workers": 1, "threads": 16},
    "django-tuned": {"kind": "django", "workers": SERVER_CPUS, "threads": 4},
    "rust": {"kind": "rust", "pool": 2 * SERVER_CPUS},
}
ORDER = ["django-shipped", "django-tuned", "rust"]

# Process-tree stats leave out the Git Bash wrapper and the venv's python.exe
# launcher stub: they exist only because of how Django is started on this box.
os.environ["LPBENCH_EXCLUDE"] = r"\git\bin\bash.exe;\git\usr\bin\bash.exe;\.venv-win\scripts\python.exe"

SCHEDULES = ["cleanup_deleted_photos", "cleanup_stuck_jobs", "cleanup_old_jobs", "zip_expiry", "prune_refresh_tokens"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def psql(sql, db="postgres", capture=True):
    r = subprocess.run(
        [os.path.join(PG_BIN, "psql.exe"), "-h", "localhost", "-p", str(PG_PORT), "-U", "postgres",
         "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql],
        capture_output=capture, text=True, env={**os.environ, "PGPASSWORD": "x"}, encoding="utf-8",
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql failed on {db}: {r.stderr.strip()}\n{sql}")
    return (r.stdout or "").strip()


def clone(template, db):
    """A run database from a benchmark template. Rust's maintenance schedules are
    marked as not due, so its in-process worker leaves the data alone (Django
    runs no qcluster either)."""
    assert db.startswith(("lp_run_", "lp_t_")) and db.startswith(RUN_PREFIX), db
    psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
    psql(f'CREATE DATABASE "{db}" TEMPLATE "{template}"')
    names = ",".join(f"'{s}'" for s in SCHEDULES)
    psql(
        "INSERT INTO schedule_state (name, last_run_at, next_run_at) "
        f"SELECT n, now(), now() + interval '365 days' FROM unnest(ARRAY[{names}]) n "
        "ON CONFLICT (name) DO UPDATE SET next_run_at = EXCLUDED.next_run_at",
        db,
    )
    # Extra schema for every clone (e.g. an index under test, so Django gets it too).
    extra = os.environ.get("LP_BENCH_CLONE_SQL")
    if extra:
        with open(extra, encoding="utf-8") as f:
            psql(f.read(), db)


def drop(db):
    assert db.startswith(("lp_run_", "lp_t_")) and db.startswith(RUN_PREFIX), db
    psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')


def b64(d):
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def mint_token(user_id=ALICE, days=30):
    """A simplejwt-layout access token signed with the shared SECRET_KEY, valid for
    the whole run, so both backends accept the same token."""
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps({"token_type": "access", "exp": now + days * 86400, "iat": now,
                              "jti": uuid.uuid4().hex, "user_id": str(user_id)}, separators=(",", ":")).encode())
    sig = b64(hmac.new(SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def http_get(url, token=None, timeout=120):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, body, time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.perf_counter() - t0


def lpbench(*args, timeout=None):
    cmd = [LPBENCH, "--affinity", MASK_CLIENT, *[str(a) for a in args]]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"lpbench failed: {' '.join(cmd[:6])} ...\n{r.stderr[-2000:]}")
    return json.loads(r.stdout)


def listener_pid(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "TCP" and parts[1].endswith(f":{port}") and parts[2] in ("0.0.0.0:0", "[::]:0"):
            return int(parts[4])
    return None


def pg_postmaster():
    pid = listener_pid(PG_PORT)
    if pid is None:
        raise RuntimeError("Postgres on 5433 is not running")
    return pid


def pin(pids, mask):
    return lpbench("pin", "--pids", ",".join(str(p) for p in pids), "--mask", mask)


def rust_env(db, port, media=MEDIA, logs=None, extra=None):
    env = dict(os.environ)
    logs = logs or os.path.join(RUNS, "logs", f"rust-{db}-{port}")
    os.makedirs(logs, exist_ok=True)
    env.update({
        "BASE_DATA": media, "BASE_LOGS": logs, "SECRET_KEY": SECRET, "DB_NAME": db, "DB_USER": "postgres",
        "DB_PASS": "x", "DB_HOST": "localhost", "DB_PORT": str(PG_PORT), "LP_BIND": f"127.0.0.1:{port}",
        "LP_MEDIA_MODE": "direct", "LOG_LEVEL": "info", "TZ": "UTC",
        "LP_EXIFTOOL": os.path.join(VENV_SP, "exiftool_bin", "exiftool.exe"),
        "LP_FFMPEG": os.path.join(VENV_SP, "ffmpeg_bin", "bin", "ffmpeg.exe"),
        "LP_FFPROBE": os.path.join(VENV_SP, "ffmpeg_bin", "bin", "ffprobe.exe"),
        "LP_VIPS_LIB": os.path.join(VENV_SP, "libvips-42-e6cc51bbc763e7deda536c6f56ce96b4.dll"),
        "FEATURE_FACE_DETECTION": "0", "FEATURE_FACE_CLUSTER": "0", "FEATURE_IMAGE_CAPTIONING": "0",
        "FEATURE_REVERSE_GEOCODING": "0", "FEATURE_SCENE_CLASSIFICATION": "0",
    })
    env.update(extra or {})
    return env


class Server:
    """One contender on its own database. Django goes through tests/fixture/run_django.sh
    (production settings, SERVE_FRONTEND direct media, no access log)."""

    def __init__(self, name, db, port, media=MEDIA, extra_env=None, rust_cmd=("serve",)):
        self.name, self.db, self.port, self.media = name, db, port, media
        self.cfg = CONTENDERS[name] if name in CONTENDERS else {"kind": name}
        self.kind = self.cfg["kind"]
        self.extra_env = extra_env or {}
        self.rust_cmd = list(rust_cmd)
        self.proc = None
        self.cold_start_s = None

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"

    def start(self, pin_mask=MASK_SERVER, timeout=240):
        if listener_pid(self.port) is not None:
            raise RuntimeError(f"port {self.port} busy")
        logdir = os.path.join(RUNS, "logs")
        os.makedirs(logdir, exist_ok=True)
        self.logfile = open(os.path.join(logdir, f"{self.name}-{self.db}-{self.port}.log"), "ab")
        if self.kind == "django":
            env = dict(os.environ)
            env.update({"TZ": "UTC", "LP_WORKERS": str(self.cfg.get("workers", 1)), "WEB_THREADS": str(self.cfg.get("threads", 16)),
                        "LP_MEDIA_ROOT": self.media, "LP_RUNS_ROOT": os.path.join(RUNS, "django")})
            env.update(self.extra_env)
            cmd = [BASH, os.path.join(FIXTURE_DIR, "run_django.sh"), self.db, str(self.port), "direct"]
        else:
            env = rust_env(self.db, self.port, self.media, extra={"LP_DB_POOL": str(self.cfg.get("pool", 12)), **self.extra_env})
            cmd = [RS_BIN, *self.rust_cmd]
        t0 = time.perf_counter()
        self.proc = subprocess.Popen(cmd, env=env, stdout=self.logfile, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f"{self.name} exited with {self.proc.returncode}; see {self.logfile.name}")
            try:
                status, _, _ = http_get(f"{self.base}/api/healthz", timeout=2)
                if status == 200:
                    break
            except Exception:
                pass
            if time.perf_counter() - t0 > timeout:
                self.stop()
                raise RuntimeError(f"{self.name} not healthy after {timeout}s")
            time.sleep(0.05)
        self.cold_start_s = time.perf_counter() - t0
        if pin_mask:
            pin([self.proc.pid], pin_mask)
        return self

    def pids(self):
        return str(self.proc.pid)

    def stat(self):
        return lpbench("procstat", "--pids", self.pids())

    def stop(self):
        if self.proc is not None:
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                pass
        for _ in range(100):
            pid = listener_pid(self.port)
            if pid is None:
                break
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            time.sleep(0.2)
        self.proc = None


def django_env(db, media, run_dir, extra=None):
    """What tests/fixture/env.sh lp_django_env exports, for processes started
    without run_django.sh (qcluster, the exif sidecar, one-off scripts)."""
    os.makedirs(os.path.join(run_dir, "logs"), exist_ok=True)
    os.makedirs(os.path.join(run_dir, "matplotlib"), exist_ok=True)
    env = dict(os.environ)
    env.update({
        "BASE_DATA": media, "PHOTOS": os.path.join(media, "data"), "BASE_LOGS": os.path.join(run_dir, "logs"),
        "MPLCONFIGDIR": os.path.join(run_dir, "matplotlib"), "SECRET_KEY": SECRET,
        "DB_BACKEND": "postgresql", "DB_NAME": db, "DB_USER": "postgres", "DB_PASS": "x",
        "DB_HOST": "localhost", "DB_PORT": str(PG_PORT), "DJANGO_SETTINGS_MODULE": "lp_bench_settings",
        "PYTHONPATH": os.pathsep.join([HERE, FIXTURE_DIR]), "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1",
        "BACKEND_HOST": "127.0.0.1",
        # Containers run in UTC. On a local zone ahead of UTC, Django's rescan
        # (fromtimestamp(mtime).replace(tzinfo=utc)) sees every file as modified.
        "TZ": "UTC",
        "FEATURE_FACE_DETECTION": "0", "FEATURE_FACE_CLUSTER": "0", "FEATURE_IMAGE_CAPTIONING": "0",
        "FEATURE_REVERSE_GEOCODING": "0", "FEATURE_SCENE_CLASSIFICATION": "0",
    })
    env["PATH"] = os.pathsep.join([os.path.join(VENV_SP, "exiftool_bin"), os.path.join(VENV_SP, "ffmpeg_bin", "bin"),
                                   env.get("PATH", "")])
    env.update(extra or {})
    return env


DJANGO_PY = os.path.join(VENV, "Scripts", "python.exe")
BACKEND_DIR = os.path.join(REPO, "apps", "backend")


class Proc:
    """A helper process (qcluster, exif sidecar) stopped with its whole tree."""

    def __init__(self, name, cmd, env, cwd=BACKEND_DIR):
        os.makedirs(os.path.join(RUNS, "logs"), exist_ok=True)
        self.name = name
        self.logfile = open(os.path.join(RUNS, "logs", f"{name}.log"), "ab")
        self.proc = subprocess.Popen(cmd, env=env, cwd=cwd, stdout=self.logfile, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)

    def alive(self):
        return self.proc.poll() is None

    def stop(self):
        subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            pass


def wait_port(port, timeout=60):
    t0 = time.perf_counter()
    while listener_pid(port) is None:
        if time.perf_counter() - t0 > timeout:
            raise RuntimeError(f"nothing listens on {port} after {timeout}s")
        time.sleep(0.2)


class TreeSampler:
    """Working set and CPU of process trees, sampled from a thread (lpbench procstat)."""

    def __init__(self, pids, period=1.0):
        import threading
        self.pids, self.period = [p for p in pids if p], period
        self.samples = []
        self.first_cpu = {}  # pid -> CPU seconds when first seen
        self.last_cpu = {}  # pid -> CPU seconds when last seen
        self.initial = None  # pids alive at the first sample
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _run(self):
        while not self._stop.is_set():
            self._sample()
            self._stop.wait(self.period)
        self._sample()

    def _sample(self):
        try:
            s = lpbench("procstat", "--pids", ",".join(str(p) for p in self.pids), "--detail")
        except Exception:
            return
        detail = s.pop("detail")
        if self.initial is None:
            self.initial = {pid for pid, _, _ in detail}
        for pid, cpu, _ in detail:
            self.first_cpu.setdefault(pid, cpu)
            self.last_cpu[pid] = cpu
        self.samples.append((time.time(), s))

    def finish(self):
        """Peak/mean working set, and the CPU seconds used in the window by every
        process seen: processes that exited (recycled workers) count up to their
        last sample, processes started in the window count whole."""
        self._stop.set()
        self._t.join()
        ws = [s["working_set"] for _, s in self.samples]
        initial = self.initial or set()
        cpu = sum(last - (self.first_cpu[pid] if pid in initial else 0) for pid, last in self.last_cpu.items())
        return {"peak_working_set": max(ws, default=0), "mean_working_set": sum(ws) / len(ws) if ws else 0,
                "samples": len(ws), "max_procs": max((s["procs"] for _, s in self.samples), default=0),
                "distinct_pids": len(self.last_cpu), "cpu_s": cpu}


def quiesce(pids, limit_s=240, idle_cores=0.15, interval=1.0):
    """Wait until the process trees (servers + Postgres) use less than `idle_cores`
    CPUs over `interval`: a contender still draining the backlog of a previous
    cell must not load Postgres while the next one is measured."""
    pids = ",".join(str(p) for p in pids if p)
    t0 = time.perf_counter()
    prev = lpbench("procstat", "--pids", pids)["cpu_s"]
    while True:
        time.sleep(interval)
        cur = lpbench("procstat", "--pids", pids)["cpu_s"]
        if (cur - prev) / interval < idle_cores:
            return time.perf_counter() - t0
        if time.perf_counter() - t0 > limit_s:
            log(f"quiesce: still busy after {limit_s}s ({(cur - prev) / interval:.2f} cores)")
            return time.perf_counter() - t0
        prev = cur


def git_commit():
    return subprocess.run(["git", "-C", REPO, "rev-parse", "--short=9", "HEAD"], capture_output=True, text=True).stdout.strip()


def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj) + "\n")


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
