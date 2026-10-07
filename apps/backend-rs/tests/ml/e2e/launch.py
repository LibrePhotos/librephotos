"""Start / stop one side of the E2E ML run, recording the PIDs it started.

  launch.py start rs   Rust server (in-process ML, embedded worker) on :8751
  launch.py start dj   Django uvicorn :8750 + qcluster + the 7 ML sidecars (fixed
                       ports 8002-8012; exif is served in-process, djmods/)
  launch.py stop  rs|dj  taskkill /T /F only the PIDs recorded at start
"""

import json
import os
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "bench"))
import no_console  # noqa: F401,E402  (no console windows on Windows)

HERE = Path(__file__).resolve().parent
WT = HERE.parents[4]
E = Path(os.environ.get("LP_E2E_ROOT", WT.parent / "rust-pg" / "e2e-ml"))
BACKEND = WT / "apps/backend"
RS = WT / "apps/backend-rs"
VENV = Path(os.environ.get("LP_E2E_VENV", WT.parent / "wt-windev/apps/backend/.venv-win"))
PY = VENV / "Scripts/python.exe"
SP = VENV / "Lib/site-packages"
FLAGS = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
SIDECARS = {
    "image_similarity": "image_similarity/main.py",
    "thumbnail": "service/thumbnail/main.py",
    "face_recognition": "service/face_recognition/main.py",
    "clip_embeddings": "service/clip_embeddings/main.py",
    "image_captioning": "service/image_captioning/main.py",
    "tags": "service/tags/main.py",
    "ocr": "service/ocr/main.py",
}


def common(side, db):
    base = E / side
    env = dict(os.environ)
    env.update(
        BASE_DATA=str(base).replace("\\", "/"),
        PHOTOS=str(base / "data").replace("\\", "/"),
        BASE_LOGS=str(base / "logs").replace("\\", "/"),
        SECRET_KEY="rust-bench-secret",
        DB_BACKEND="postgresql", DB_NAME=db, DB_USER="postgres", DB_PASS="x",
        DB_HOST="localhost", DB_PORT="5433",
        FEATURE_FACE_DETECTION="1", FEATURE_FACE_CLUSTER="1",
        FEATURE_IMAGE_CAPTIONING="1", FEATURE_SCENE_CLASSIFICATION="1",
        FEATURE_REVERSE_GEOCODING="0",
        WORKER_CONCURRENCY="2", LOG_LEVEL="INFO",
        PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
    )
    env["PATH"] = os.pathsep.join([str(SP / "exiftool_bin"), str(SP / "ffmpeg_bin" / "bin"), env["PATH"]])
    return env


def spawn(argv, env, cwd, log):
    f = open(log, "ab")
    p = subprocess.Popen(argv, env=env, cwd=cwd, stdout=f, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, creationflags=FLAGS)
    return p.pid


def start(side):
    pids = {}
    logs = E / side / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    if side == "rs":
        env = common(side, "lp_run_e2e_rs")
        env.update(
            LP_BIND="127.0.0.1:8751", LP_MEDIA_MODE="direct",
            LP_ORT_LIB=str(SP / "onnxruntime/capi/onnxruntime.dll"),
            LP_VIPS_LIB=str(SP / "libvips-42-e6cc51bbc763e7deda536c6f56ce96b4.dll"),
            LP_EXIFTOOL=str(SP / "exiftool_bin/exiftool.exe"),
            LP_FFMPEG=str(SP / "ffmpeg_bin/bin/ffmpeg.exe"),
            LP_FFPROBE=str(SP / "ffmpeg_bin/bin/ffprobe.exe"),
            LP_ML_AUTO_DOWNLOAD="0",
        )
        for k in list(env):
            if k.startswith("LP_SIDECAR_") or k.startswith("LP_ML_") and k != "LP_ML_AUTO_DOWNLOAD":
                del env[k]
        pids["server"] = spawn([str(RS / "target/debug/librephotos-rs.exe"), "serve"], env, RS, logs / "server.out")
    else:
        env = common(side, "lp_run_e2e_dj")
        env.update(
            DJANGO_SETTINGS_MODULE="lp_e2e_settings", BACKEND_HOST="127.0.0.1",
            PYTHONPATH=os.pathsep.join([str(HERE / "djmods"), str(RS / "tests/fixture"), str(BACKEND)]),
            MPLCONFIGDIR=str(E / side / "mpl"),
        )
        for name, script in SIDECARS.items():
            pids[name] = spawn([str(PY), script], env, BACKEND, logs / f"sidecar_{name}.out")
        pids["qcluster"] = spawn([str(PY), "manage.py", "qcluster"], env, BACKEND, logs / "qcluster.out")
        pids["uvicorn"] = spawn(
            [str(PY), "-m", "uvicorn", "librephotos.asgi:application", "--host", "127.0.0.1",
             "--port", "8750", "--workers", "1", "--no-access-log"],
            env, BACKEND, logs / "uvicorn.out")
    (E / f"pids_{side}.json").write_text(json.dumps(pids))
    print(side, pids)


def stop(side):
    f = E / f"pids_{side}.json"
    pids = json.loads(f.read_text())
    for name, pid in pids.items():
        r = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
        print(name, pid, r.returncode)
    f.unlink()


{"start": start, "stop": stop}[sys.argv[1]](sys.argv[2])
