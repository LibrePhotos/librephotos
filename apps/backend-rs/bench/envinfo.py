"""Write <results dir>/env.json: hardware, software versions, commit, Postgres settings.

    python envinfo.py <results dir>
"""

import json
import os
import platform
import subprocess
import sys

import lpb


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"<{e}>"


def main():
    out = sys.argv[1]
    ps = lambda q: run(["powershell", "-NoProfile", "-Command", q])  # noqa: E731
    cpu = ps("(Get-CimInstance Win32_Processor).Name")
    ram = ps("[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)")
    osv = ps("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version")
    py = run([lpb.DJANGO_PY, "-c", "import sys, django, uvicorn, psycopg, a2wsgi, django_q, pyvips; "
              "from importlib.metadata import version as v; "
              "print(sys.version.split()[0], django.__version__, uvicorn.__version__, psycopg.__version__, "
              "v('a2wsgi'), v('django-q2'), pyvips.version(0), pyvips.version(1))"]).split()
    pg = {k: lpb.psql(f"SHOW {k}") for k in ("server_version", "shared_buffers", "work_mem", "effective_cache_size",
                                              "max_connections", "fsync", "synchronous_commit", "full_page_writes", "jit")}
    env = {
        "commit": lpb.git_commit(),
        "cpu": cpu, "logical_cpus": os.cpu_count(), "ram_gb": ram, "os": osv, "platform": platform.platform(),
        "rustc": run(["rustc", "--version"]),
        "python": py[0] if py else None,
        "django": py[1] if len(py) > 1 else None, "uvicorn": py[2] if len(py) > 2 else None,
        "psycopg": py[3] if len(py) > 3 else None, "a2wsgi": py[4] if len(py) > 4 else None,
        "django_q2": py[5] if len(py) > 5 else None, "libvips": ".".join(py[6:8]) if len(py) > 7 else None,
        "postgres": pg,
        "cpu_sets": {"server": lpb.MASK_SERVER, "postgres": lpb.MASK_PG, "client": lpb.MASK_CLIENT},
        "contenders": lpb.CONTENDERS,
    }
    env["summary"] = {
        "Hardware": f"{cpu}, {os.cpu_count()} logical CPUs (6 cores × SMT), {ram} GB RAM, NVMe SSD",
        "OS": osv,
        "Commit": f"experiment/rust-backend @ {env['commit']} (Django = apps/backend of the same commit)",
        "Rust": f"{env['rustc']}, release profile lto=thin, codegen-units=1",
        "Python": f"CPython {env['python']}, Django {env['django']}, uvicorn {env['uvicorn']}, a2wsgi {env['a2wsgi']}, "
                  f"psycopg {env['psycopg']}, django-q2 {env['django_q2']}, libvips {env['libvips']}",
        "Postgres": f"{pg['server_version']} on localhost:5433, shared_buffers {pg['shared_buffers']}, work_mem {pg['work_mem']}, "
                    f"fsync={pg['fsync']}, synchronous_commit={pg['synchronous_commit']}, full_page_writes={pg['full_page_writes']} "
                    "(dev server, same for both backends)",
        "CPU sets": "server CPUs 0-5 (mask 0x3f), Postgres 6-9 (0x3c0), load client 10-11 (0xc00); "
                    "set with SetProcessAffinityMask on the process trees after start-up",
        "Contenders": "django-shipped = uvicorn 1 worker × WEB_THREADS=16; django-tuned = uvicorn 6 workers × "
                      "WEB_THREADS=4; rust = librephotos-rs serve, tokio default workers, LP_DB_POOL=12, "
                      "LP_MEDIA_MODE=direct. Django: production settings, DEBUG off, CONN_MAX_AGE=600, no "
                      "access log, SERVE_FRONTEND direct media (no nginx on this box). Same SECRET_KEY, same "
                      "JWT for all.",
    }
    with open(os.path.join(out, "env.json"), "w", encoding="utf-8") as f:
        json.dump(env, f, indent=1)
    print(json.dumps(env["summary"], indent=1))


if __name__ == "__main__":
    main()
