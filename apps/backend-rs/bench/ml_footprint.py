"""ML footprint of one backend: memory per model and a full ML-on scan (ML_FOOTPRINT.md).

  python ml_footprint.py library                      # <root>/lib/{foot,tiny} as hard links
  python ml_footprint.py models --out models.json     # Rust: RSS idle / per model / all / after unload
  python ml_footprint.py scan rs|dj --concurrency N --out scan.json [--cap 540] [--captions 10]

Each run gets a fresh clone of lp_fixture (lp_run_foot_<side><N>) with user `foot`
scanning <root>/lib/foot (or lib/tiny for `models`), and a BASE_DATA whose
data_models is a junction to the shared models. Every ML feature is on
(default models; OCR_MODEL=ppocrv6_small because the default is off), reverse
geocoding off (network). The whole process tree is pinned to CPUs 0,2,4,6 (four
physical cores, a Pi-sized box) with ONNX_INTRA_OP_THREADS=4; Postgres to
CPUs 8-11.

rs = `librephotos-rs serve` (LP_RS_BIN, in-process ML, embedded worker).
dj = uvicorn (1 worker) + qcluster (WORKER_CONCURRENCY workers) + the 8 Python
sidecars (exif and the 7 ML ones, fixed ports 8002-8012: nothing else may hold them).
RSS = working set, private = private bytes, both summed over every process of
the tree (ExifTool's perl, qcluster workers, sidecars) every 0.5 s.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil
import requests

HERE = Path(__file__).resolve().parent
RS_DIR = HERE.parent
WT = RS_DIR.parents[1]
BACKEND = WT / "apps" / "backend"
LIBREPHOTOS = WT.parent
ROOT = Path(os.environ.get("LP_FOOT_ROOT", LIBREPHOTOS / "rust-pg" / "ml-foot"))
MODELS = Path(os.environ.get("LP_ML_ROOT", LIBREPHOTOS / "rust-pg" / "ml")) / "protected_media" / "data_models"
VENV = Path(os.environ.get("LP_FOOT_VENV", LIBREPHOTOS / "wt-windev" / "apps" / "backend" / ".venv-win"))
PY = VENV / "Scripts" / "python.exe"
SP = VENV / "Lib" / "site-packages"
PG_BIN = LIBREPHOTOS / "rust-pg" / "pginstall" / "bin"
RS_BIN = Path(os.environ.get("LP_RS_BIN", RS_DIR / "target" / "release" / "librephotos-rs.exe"))
PORT = {"rs": 8761, "dj": 8760}
USER, PW = "foot", "foot-pw"
SERVER_CPUS = [0, 2, 4, 6]
PG_CPUS = [8, 9, 10, 11]
SIDECARS = {
    "exif": ["-m", "service.exif.main"],
    "image_similarity": ["image_similarity/main.py"],
    "thumbnail": ["service/thumbnail/main.py"],
    "face_recognition": ["service/face_recognition/main.py"],
    "clip_embeddings": ["service/clip_embeddings/main.py"],
    "image_captioning": ["service/image_captioning/main.py"],
    "tags": ["service/tags/main.py"],
    "ocr": ["service/ocr/main.py"],
}
FLAGS = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
TINY = ["group_t1_orig.jpg", "portrait_hanks_orig.jpg", "portrait_astronaut_orig.jpg",
        "text_document_1240x1754.jpg", "text_receipt_720x1100.jpg", "scene_chelsea.jpg"]
CAPTION_PICKS = ["group_t1_orig", "portrait_hanks_orig", "portrait_astronaut_orig", "scene_chelsea",
                 "scene_coffee", "scene_horse", "scene_rocket", "text_sign_900x500", "scene_motorcycle_left",
                 "scene_flower"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def psql(sql, db="postgres"):
    r = subprocess.run([str(PG_BIN / "psql.exe"), "-h", "localhost", "-p", "5433", "-U", "postgres", "-X", "-q",
                        "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql],
                       capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PGPASSWORD": "x"})
    if r.returncode:
        raise RuntimeError(f"psql {db}: {r.stderr.strip()}")
    return r.stdout.strip()


def pg_pids():
    pm = None
    for c in psutil.net_connections(kind="tcp"):
        if c.status == "LISTEN" and c.laddr.port == 5433:
            pm = c.pid
    p = psutil.Process(pm)
    return [p, *p.children(recursive=True)]


def pin_postgres(cpus):
    for p in pg_pids():
        try:
            p.cpu_affinity(cpus)
        except psutil.Error:
            pass


# ------------------------------------------------------------------ library

def library():
    """Hard links, no copies: the 66 E2E photos (faces, documents, scenes), the
    fixture's originals (JPEG/PNG/HEIC/DNG/MP4), deploy/e2e, and every 10th
    generated phone JPEG of the W4 scan library."""
    src = LIBREPHOTOS / "rust-pg"
    foot, tiny = ROOT / "lib" / "foot", ROOT / "lib" / "tiny"
    if not tiny.exists():
        tiny.mkdir(parents=True)
        for n in TINY:
            os.link(src / "e2e-ml" / "lib" / "mlcheck" / n, tiny / n)
    if foot.exists():
        log("library exists:", foot)
        return
    parts = [("mlcheck", sorted((src / "e2e-ml" / "lib" / "mlcheck").glob("*"))),
             ("fixture", sorted(p for p in (src / "fixture" / "data").rglob("*") if p.is_file())),
             ("e2e", sorted((WT / "deploy" / "e2e" / "photos").glob("*.jpg")))]
    phone = sorted((src / "bench-scan" / "lib").rglob("*.jpg"))[2::10]
    for sub, files in parts:
        for f in files:
            rel = f.relative_to(src / "fixture" / "data") if sub == "fixture" else Path(f.name)
            dst = foot / sub / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.link(f, dst)
    media = sum(1 for p in foot.rglob("*") if p.is_file() and p.suffix != ".xmp")
    for f in phone[: 300 - media]:
        dst = foot / "phone" / f"{f.parent.name}_{f.name}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.link(f, dst)
    log("library:", sum(1 for p in foot.rglob("*") if p.is_file() and p.suffix != ".xmp"), "media files")


# ------------------------------------------------------------------ setup

def setup(side, tag, lib):
    db = f"lp_run_foot_{tag}"
    base = ROOT / "runs" / tag
    cleanup(base)
    (base / "protected_media").mkdir(parents=True)
    (base / "logs").mkdir()
    subprocess.run(["cmd", "/c", "mklink", "/J", str(base / "protected_media" / "data_models"), str(MODELS)],
                   check=True, capture_output=True)
    psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
    psql(f'CREATE DATABASE "{db}" TEMPLATE lp_fixture')
    env = {**os.environ, "BASE_DATA": base.as_posix(), "BASE_LOGS": (base / "logs").as_posix(),
           "SECRET_KEY": "rust-bench-secret", "DB_NAME": db, "DB_USER": "postgres", "DB_PASS": "x",
           "DB_HOST": "localhost", "DB_PORT": "5433"}
    subprocess.run([str(RS_BIN), "adopt"], env=env, check=True, capture_output=True)
    subprocess.run([str(RS_BIN), "createadmin", USER, "foot@example.com"], env={**env, "ADMIN_PASSWORD": PW},
                   check=True, capture_output=True)
    libw = str(lib).replace("/", "\\")
    psql(f"""UPDATE api_user SET scan_directory = '{libw}', semantic_search_topk = 100 WHERE username = '{USER}';
DELETE FROM constance_constance WHERE key = 'OCR_MODEL';
INSERT INTO constance_constance (key, value) VALUES ('OCR_MODEL', '{{"__type__": "default", "__value__": "ppocrv6_small"}}');
INSERT INTO site_settings (key, value) VALUES ('OCR_MODEL', '"ppocrv6_small"')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;""", db)
    return db, base


def cleanup(base):
    """Remove a run's BASE_DATA (its logs are kept under <root>/logs/<tag>); the
    data_models junction goes first (os.rmdir removes the link only), so the shared
    models are never followed."""
    if (base / "logs").exists():
        keep = ROOT / "logs" / base.name
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(base / "logs", keep)
    j = base / "protected_media" / "data_models"
    if os.path.lexists(j):
        os.rmdir(j)
    assert not os.path.lexists(j)
    if base.exists():
        shutil.rmtree(base)


# ------------------------------------------------------------------ processes

def common_env(side, db, base, conc):
    env = {k: v for k, v in os.environ.items()
           if not (k.startswith("LP_SIDECAR_") or k.startswith("LP_ML_") or k.startswith("FEATURE_"))}
    env.update(
        BASE_DATA=base.as_posix(), PHOTOS=(base / "data").as_posix(), BASE_LOGS=(base / "logs").as_posix(),
        SECRET_KEY="rust-bench-secret", DB_BACKEND="postgresql", DB_NAME=db, DB_USER="postgres", DB_PASS="x",
        DB_HOST="localhost", DB_PORT="5433", TZ="UTC",
        FEATURE_FACE_DETECTION="1", FEATURE_FACE_CLUSTER="1", FEATURE_IMAGE_CAPTIONING="1",
        FEATURE_SCENE_CLASSIFICATION="1", FEATURE_REVERSE_GEOCODING="0",
        WORKER_CONCURRENCY=str(conc), ONNX_INTRA_OP_THREADS="4", ONNX_PROVIDERS="CPUExecutionProvider",
        LOG_LEVEL="INFO", PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
    )
    env["PATH"] = os.pathsep.join([str(SP / "exiftool_bin"), str(SP / "ffmpeg_bin" / "bin"), env["PATH"]])
    return env


def spawn(label, argv, env, cwd, logdir):
    f = open(logdir / f"{label}.out", "ab")
    p = subprocess.Popen(argv, env=env, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=FLAGS)
    try:
        psutil.Process(p.pid).cpu_affinity(SERVER_CPUS)
    except psutil.Error:
        pass
    return p.pid


def start(side, db, base, conc, extra=None):
    env = common_env(side, db, base, conc)
    env.update(extra or {})
    logs = base / "logs"
    roots = {}
    if side == "rs":
        env.update(LP_BIND=f"127.0.0.1:{PORT['rs']}", LP_MEDIA_MODE="direct", LP_ML_AUTO_DOWNLOAD="0",
                   LP_SUPERVISE_SIDECARS="0",
                   LP_ORT_LIB=str(SP / "onnxruntime" / "capi" / "onnxruntime.dll"),
                   LP_VIPS_LIB=str(SP / "libvips-42-e6cc51bbc763e7deda536c6f56ce96b4.dll"),
                   LP_EXIFTOOL=str(SP / "exiftool_bin" / "exiftool.exe"),
                   LP_FFMPEG=str(SP / "ffmpeg_bin" / "bin" / "ffmpeg.exe"),
                   LP_FFPROBE=str(SP / "ffmpeg_bin" / "bin" / "ffprobe.exe"))
        roots["librephotos-rs"] = spawn("server", [str(RS_BIN), "serve"], env, RS_DIR, logs)
    else:
        env.update(DJANGO_SETTINGS_MODULE="lp_twin_settings", BACKEND_HOST="127.0.0.1", LP_DJANGO_DIRECT="1",
                   PYTHONPATH=os.pathsep.join([str(RS_DIR / "tests" / "fixture"), str(BACKEND)]),
                   MPLCONFIGDIR=str(base / "mpl"))
        for name, args in SIDECARS.items():
            roots[name] = spawn(f"sidecar_{name}", [str(PY), *args], env, BACKEND, logs)
        roots["qcluster"] = spawn("qcluster", [str(PY), "manage.py", "qcluster"], env, BACKEND, logs)
        roots["uvicorn"] = spawn("uvicorn", [str(PY), "-m", "uvicorn", "librephotos.asgi:application", "--host",
                                             "127.0.0.1", "--port", str(PORT["dj"]), "--workers", "1",
                                             "--no-access-log"], env, BACKEND, logs)
    return roots


def stop(roots):
    for pid in roots.values():
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)


def listening_roots(roots):
    tree = {}
    for label, pid in roots.items():
        try:
            p = psutil.Process(pid)
            for q in [p, *p.children(recursive=True)]:
                tree[q.pid] = label
        except psutil.Error:
            pass
    return {tree[c.pid] for c in psutil.net_connections(kind="tcp") if c.status == "LISTEN" and c.pid in tree}


# ------------------------------------------------------------------ sampler

class Sampler(threading.Thread):
    """Working set and private bytes summed over each root's process tree."""

    def __init__(self, roots, interval=0.5):
        super().__init__(daemon=True)
        self.roots, self.interval = roots, interval
        self.samples = []  # (t, rss, private, {label: rss})
        self.peak = {"rss": 0, "private": 0, "t": 0, "by_label": {}}
        self.stop_ev = threading.Event()
        self.lock = threading.Lock()

    def snap(self):
        by, total_r, total_p, nproc = {}, 0, 0, 0
        for label, pid in self.roots.items():
            try:
                p = psutil.Process(pid)
                procs = [p, *p.children(recursive=True)]
            except psutil.Error:
                continue
            for q in procs:
                try:
                    m = q.memory_info()
                    if q.cpu_affinity() != SERVER_CPUS:
                        q.cpu_affinity(SERVER_CPUS)
                except psutil.Error:
                    continue
                by[label] = by.get(label, 0) + m.rss
                total_r += m.rss
                total_p += m.private
                nproc += 1
        return {"t": time.time(), "rss": total_r, "private": total_p, "procs": nproc, "by_label": by}

    def run(self):
        while not self.stop_ev.is_set():
            s = self.snap()
            with self.lock:
                self.samples.append((s["t"], s["rss"], s["private"]))
                if s["rss"] > self.peak["rss"]:
                    self.peak.update(rss=s["rss"], t=s["t"], by_label=s["by_label"], procs=s["procs"])
                self.peak["private"] = max(self.peak["private"], s["private"])
            self.stop_ev.wait(self.interval)

    def window_peak(self, t0, t1):
        with self.lock:
            xs = [s for s in self.samples if t0 <= s[0] <= t1]
        return {"rss": max((s[1] for s in xs), default=0), "private": max((s[2] for s in xs), default=0)}


def mb(x):
    return round(x / 1048576, 1)


def snapshot(sampler, label):
    s = sampler.snap()
    out = {"label": label, "rss_mb": mb(s["rss"]), "private_mb": mb(s["private"]), "procs": s["procs"],
           "by_label_mb": {k: mb(v) for k, v in sorted(s["by_label"].items())}}
    log(f"  {label:<34} rss {out['rss_mb']:8.1f} MB  private {out['private_mb']:8.1f} MB  ({s['procs']} procs)")
    return out


# ------------------------------------------------------------------ driving

class Api:
    def __init__(self, base):
        self.base, self.s = base, requests.Session()
        self.login()

    def login(self):
        r = self.s.post(f"{self.base}/api/auth/token/obtain/", json={"username": USER, "password": PW}, timeout=60)
        r.raise_for_status()
        self.s.headers["Authorization"] = "Bearer " + r.json()["access"]

    def call(self, method, path, **kw):
        kw.setdefault("timeout", 900)
        r = self.s.request(method, self.base + path, **kw)
        if r.status_code == 401:
            self.login()
            r = self.s.request(method, self.base + path, **kw)
        return r


def wait_ready(side, roots, deadline=240):
    t0 = time.time()
    want = set(roots) - {"qcluster"}
    base = f"http://127.0.0.1:{PORT[side]}"
    while time.time() - t0 < deadline:
        if all(psutil.pid_exists(p) for p in roots.values()) and want <= listening_roots(roots):
            try:
                return Api(base), round(time.time() - t0, 1)
            except requests.RequestException:
                pass
        time.sleep(0.5)
    raise RuntimeError(f"{side} not ready after {deadline}s: listening {listening_roots(roots)}")


def busy(side, db, uid):
    n = int(psql(f"SELECT count(*) FROM api_longrunningjob WHERE started_by_id = {uid} AND NOT finished", db))
    if side == "rs":
        n += int(psql("SELECT count(*) FROM job_queue WHERE kind NOT LIKE 'maintenance.%' AND "
                      "(status = 'running' OR (status = 'queued' AND run_after <= now()))", db))
    else:
        n += int(psql("SELECT count(*) FROM django_q_ormq", db))
    return n


def wait_quiet(side, db, uid, deadline, label):
    """Poll every second until 3 quiet polls in a row; returns (seconds, finished)."""
    t0, quiet = time.time(), 0
    while time.time() < deadline:
        time.sleep(1)
        quiet = quiet + 1 if busy(side, db, uid) == 0 else 0
        if quiet >= 3:
            dt = round(time.time() - t0 - 3, 1)
            log(f"  {label}: {dt} s")
            return dt, True
    dt = round(time.time() - t0, 1)
    log(f"  {label}: CUT at {dt} s (cap)")
    return dt, False


def counts(db, uid):
    q = lambda sql: int(psql(sql, db) or 0)  # noqa: E731
    own = f"owner_id = {uid}"
    return {
        "photos": q(f"SELECT count(*) FROM api_photo WHERE {own}"),
        "with_thumbnail": q(f"SELECT count(*) FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id "
                            f"WHERE p.{own} AND t.thumbnail_big IS NOT NULL AND t.thumbnail_big <> ''"),
        "clip_embedded": q(f"SELECT count(*) FROM api_photo WHERE {own} AND clip_embeddings IS NOT NULL"),
        "faces": q(f"SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id WHERE p.{own}"),
        "tagged": q(f"SELECT count(*) FROM api_photo_caption c JOIN api_photo p ON p.id = c.photo_id "
                    f"WHERE p.{own} AND c.captions_json ? 'mobileclip_s2'"),
        "captioned": q(f"SELECT count(*) FROM api_photo_caption c JOIN api_photo p ON p.id = c.photo_id "
                       f"WHERE p.{own} AND c.captions_json ? 'im2txt'"),
        "ocr_rows": q(f"SELECT count(*) FROM api_photo_ocr o JOIN api_photo p ON p.id = o.photo_id WHERE p.{own}"),
        "clustered_faces": q(f"SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id "
                             f"WHERE p.{own} AND f.cluster_id IS NOT NULL"),
    }


def lrj_rows(db, uid):
    rows = psql("SELECT job_type, finished, failed, progress_current, progress_target, "
                "extract(epoch from started_at), extract(epoch from finished_at) FROM api_longrunningjob "
                f"WHERE started_by_id = {uid} ORDER BY queued_at", db)
    out = []
    for line in rows.splitlines():
        jt, fin, failed, cur, tgt, s, f = line.split("|")
        out.append({"job_type": int(jt), "finished": fin == "t", "failed": failed == "t",
                    "progress": f"{cur}/{tgt}", "seconds": round(float(f) - float(s), 1) if s and f else None})
    return out


def services_status(api):
    try:
        names = api.call("GET", "/api/services/", timeout=30).json()["services"]
    except Exception:
        return {}
    out = {}
    for n in names:
        try:
            st = api.call("GET", f"/api/services/{n}/", timeout=30).json()
        except Exception:
            continue
        if "model_loaded" in st:
            out[n] = {"loaded": st.get("model_loaded"), "models": st.get("models")}
    return out


# ------------------------------------------------------------------ modes

def cmd_scan(args):
    side, conc = args.side, args.concurrency
    tag = f"{side}{conc}"
    db, base = setup(side, tag, ROOT / "lib" / "foot")
    uid = int(psql(f"SELECT id FROM api_user WHERE username = '{USER}'", db))
    pin_postgres(PG_CPUS)
    roots = start(side, db, base, conc)
    sampler = Sampler(roots)
    result = {"side": side, "concurrency": conc, "db": db, "bin": str(RS_BIN) if side == "rs" else None}
    try:
        api, ready_s = wait_ready(side, roots)
        sampler.start()
        result["ready_s"] = ready_s
        log(f"{side} c={conc} ready in {ready_s} s")
        time.sleep(20)
        result["idle"] = snapshot(sampler, "idle (20 s after ready)")
        t0 = time.time()
        deadline = t0 + args.cap
        stages = {}
        r = api.call("POST", "/api/scanphotos/", json={})
        log("  scan:", r.status_code, r.text[:120])
        stages["scan+tags+clip+faces"], done = wait_quiet(side, db, uid, deadline, "scan + tags/CLIP/faces")
        result["after_scan"] = snapshot(sampler, "after scan + followups")
        result["counts_after_scan"] = counts(db, uid)
        if done:
            r = api.call("POST", "/api/trainfaces/", json={})
            stages["train_faces"], done = wait_quiet(side, db, uid, deadline, "face clustering + training")
        if done:
            r = api.call("POST", "/api/generateocr/", json={"full_scan": True})
            stages["ocr"], done = wait_quiet(side, db, uid, deadline, "OCR full scan")
        if done and args.captions:
            hashes = dict(line.split("|") for line in psql(
                "SELECT f.path, p.image_hash FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id "
                f"WHERE p.owner_id = {uid}", db).splitlines())
            picks = [h for path, h in sorted(hashes.items())
                     if any(path.replace("\\", "/").rsplit("/", 1)[-1].startswith(n) for n in CAPTION_PICKS)]
            picks = picks[: args.captions]
            tc, lat = time.time(), []
            for h in picks:
                if time.time() > deadline:
                    break
                t1 = time.time()
                r = api.call("POST", "/api/photosedit/generateim2txt", json={"image_hash": h})
                lat.append((round(time.time() - t1, 2), r.status_code))
            stages["captions"] = round(time.time() - tc, 1)
            result["caption_calls"] = lat
            log(f"  captions: {len(lat)} in {stages['captions']} s")
        result["stages_s"] = stages
        result["ml_wall_s"] = round(time.time() - t0, 1)
        result["completed"] = done
        result["end"] = snapshot(sampler, "end of run")
        result["peak"] = {"rss_mb": mb(sampler.peak["rss"]), "private_mb": mb(sampler.peak["private"]),
                          "by_label_mb": {k: mb(v) for k, v in sorted(sampler.peak["by_label"].items())},
                          "procs": sampler.peak.get("procs")}
        result["counts"] = counts(db, uid)
        result["lrj"] = lrj_rows(db, uid)
        n = result["counts_after_scan"]["photos"]
        sc = stages["scan+tags+clip+faces"]
        result["files_per_s"] = round(n / sc, 3) if sc else None
        if side == "rs":
            result["services"] = services_status(api)
        log(f"  peak rss {result['peak']['rss_mb']} MB, private {result['peak']['private_mb']} MB; "
            f"{n} photos in {sc} s = {result['files_per_s']} files/s")
    finally:
        sampler.stop_ev.set()
        stop(roots)
        time.sleep(2)
        pin_postgres(list(range(psutil.cpu_count())))
        t0 = sampler.samples[0][0] if sampler.samples else 0
        result["samples"] = [(round(t - t0, 1), mb(r), mb(p)) for t, r, p in sampler.samples[::4]]
        Path(args.out).write_text(json.dumps(result, indent=1))
        psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        cleanup(base)


ISOLATED = {
    # service: (FEATURE_* flags left on for the scan, trigger after the scan)
    "clip": ([], "search"),
    "tags": (["FEATURE_SCENE_CLASSIFICATION"], None),
    "faces": (["FEATURE_FACE_DETECTION"], None),
    "ocr": ([], "ocr"),
    "caption": ([], "caption"),
}


def cmd_isolated(args):
    """One service in a fresh process: scan the tiny library with every other ML
    step off (CLIP pointed at a dead sidecar URL so clip.embed fails at once),
    then trigger the one service. Delta = its model + ORT arena."""
    side, tag = "rs", f"iso_{args.only}"
    flags, trigger = ISOLATED[args.only]
    db, base = setup(side, tag, ROOT / "lib" / "tiny")
    uid = int(psql(f"SELECT id FROM api_user WHERE username = '{USER}'", db))
    pin_postgres(PG_CPUS)
    extra = {k: "0" for k in ("FEATURE_FACE_DETECTION", "FEATURE_FACE_CLUSTER", "FEATURE_IMAGE_CAPTIONING",
                              "FEATURE_SCENE_CLASSIFICATION")}
    extra.update({f: "1" for f in flags})
    if args.only != "clip":
        extra.update(LP_ML_CLIP="sidecar", LP_SIDECAR_CLIP_URL="http://127.0.0.1:9")
    if args.only == "caption":
        extra["FEATURE_IMAGE_CAPTIONING"] = "1"
    roots = start(side, db, base, 1, extra)
    sampler = Sampler(roots, interval=0.25)
    res = {"service": args.only, "steps": []}
    try:
        api, res["ready_s"] = wait_ready(side, roots)
        sampler.start()
        time.sleep(10)
        res["steps"].append(snapshot(sampler, "idle"))
        api.call("POST", "/api/scanphotos/", json={})
        wait_quiet(side, db, uid, time.time() + 300, "scan")
        time.sleep(3)
        res["steps"].append(snapshot(sampler, "after scan (no other model)"))
        t = time.time()
        if trigger == "search":
            api.call("GET", "/api/photos/searchlist/", params={"search": "a dog on the beach"})
        elif trigger == "ocr":
            api.call("POST", "/api/generateocr/", json={"full_scan": True})
            wait_quiet(side, db, uid, time.time() + 300, "ocr")
        elif trigger == "caption":
            h = psql(f"SELECT image_hash FROM api_photo WHERE owner_id = {uid} ORDER BY image_hash LIMIT 1", db)
            api.call("POST", "/api/photosedit/generateim2txt", json={"image_hash": h})
        res["trigger_s"] = round(time.time() - t, 1)
        time.sleep(2)
        res["steps"].append(snapshot(sampler, f"after {args.only}"))
        res["peak"] = {"rss_mb": mb(sampler.peak["rss"]), "private_mb": mb(sampler.peak["private"])}
        res["services"] = services_status(api)
        res["counts"] = counts(db, uid)
    finally:
        sampler.stop_ev.set()
        stop(roots)
        time.sleep(2)
        pin_postgres(list(range(psutil.cpu_count())))
        Path(args.out).write_text(json.dumps(res, indent=1))
        psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        cleanup(base)


def cmd_models(args):
    """Rust only: which model costs what. Jobs run one at a time (WORKER_CONCURRENCY=1)
    and a watcher snapshots the tree whenever a job finishes."""
    if args.only:
        return cmd_isolated(args)
    side, tag = "rs", "models"
    db, base = setup(side, tag, ROOT / "lib" / "tiny")
    uid = int(psql(f"SELECT id FROM api_user WHERE username = '{USER}'", db))
    pin_postgres(PG_CPUS)
    roots = start(side, db, base, 1)
    sampler = Sampler(roots, interval=0.25)
    res = {"steps": [], "bin": str(RS_BIN)}

    def step(label, **extra):
        s = snapshot(sampler, label)
        s.update(extra)
        res["steps"].append(s)
        return s

    try:
        api, res["ready_s"] = wait_ready(side, roots)
        sampler.start()
        time.sleep(15)
        step("idle, no model loaded")
        t = time.time()
        r = api.call("GET", "/api/photos/searchlist/", params={"search": "a dog on the beach"})
        step("+ CLIP text (semantic search)", status=r.status_code, seconds=round(time.time() - t, 2))

        seen = set()
        r = api.call("POST", "/api/scanphotos/", json={})
        deadline = time.time() + 300
        while time.time() < deadline:
            rows = psql("SELECT id, kind, status FROM job_queue WHERE kind NOT LIKE 'maintenance.%' ORDER BY id", db)
            for line in rows.splitlines():
                jid, kind, status = line.split("|")
                if status == "running" and ("run", jid) not in seen:
                    seen.add(("run", jid))
                    step(f"  job {kind} started")
                if status in ("done", "failed") and jid not in seen:
                    seen.add(jid)
                    step(f"+ job {kind} {status}")
            if busy(side, db, uid) == 0 and seen:
                time.sleep(2)
                if busy(side, db, uid) == 0:
                    break
            time.sleep(0.2)
        t = time.time()
        r = api.call("POST", "/api/generateocr/", json={"full_scan": True})
        wait_quiet(side, db, uid, time.time() + 300, "ocr")
        step("+ OCR (ppocrv6_small)", seconds=round(time.time() - t, 1))
        h = psql(f"SELECT image_hash FROM api_photo WHERE owner_id = {uid} ORDER BY image_hash LIMIT 1", db)
        t = time.time()
        r = api.call("POST", "/api/photosedit/generateim2txt", json={"image_hash": h})
        step("+ caption (lfm2_vl_450m)", status=r.status_code, seconds=round(time.time() - t, 1))
        t = time.time()
        r = api.call("POST", "/api/trainfaces/", json={})
        wait_quiet(side, db, uid, time.time() + 300, "trainfaces")
        step("+ face clustering + training", seconds=round(time.time() - t, 1))
        # Everything used within the last 120 s: touch the early ones again.
        api.call("GET", "/api/photos/searchlist/", params={"search": "a cat"})
        api.call("POST", "/api/photosedit/generateim2txt", json={"image_hash": h})
        res["services_all_loaded"] = services_status(api)
        step("all models loaded", loaded={k: v["loaded"] for k, v in res["services_all_loaded"].items()})
        res["peak_so_far"] = {"rss_mb": mb(sampler.peak["rss"]), "private_mb": mb(sampler.peak["private"])}
        log("  idle 140 s for the 120 s idle unload ...")
        time.sleep(140)
        res["services_after_unload"] = services_status(api)
        step("after 120 s idle unload",
             loaded={k: v["loaded"] for k, v in res["services_after_unload"].items()})
        res["peak"] = {"rss_mb": mb(sampler.peak["rss"]), "private_mb": mb(sampler.peak["private"])}
        res["counts"] = counts(db, uid)
    finally:
        sampler.stop_ev.set()
        stop(roots)
        time.sleep(2)
        pin_postgres(list(range(psutil.cpu_count())))
        t0 = sampler.samples[0][0] if sampler.samples else 0
        res["samples"] = [(round(t - t0, 2), mb(r), mb(p)) for t, r, p in sampler.samples]
        Path(args.out).write_text(json.dumps(res, indent=1))
        psql(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        cleanup(base)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("library")
    m = sub.add_parser("models")
    m.add_argument("--out", required=True)
    m.add_argument("--only", choices=sorted(ISOLATED))
    s = sub.add_parser("scan")
    s.add_argument("side", choices=["rs", "dj"])
    s.add_argument("--concurrency", type=int, default=1)
    s.add_argument("--out", required=True)
    s.add_argument("--cap", type=int, default=540, help="seconds for all ML stages")
    s.add_argument("--captions", type=int, default=10)
    args = ap.parse_args()
    if args.cmd == "library":
        library()
    elif args.cmd == "models":
        cmd_models(args)
    else:
        cmd_scan(args)


if __name__ == "__main__":
    sys.exit(main())
