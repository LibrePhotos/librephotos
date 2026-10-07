"""Cold start and idle memory of one contender each (API server only).

    python footprint_ts.py [--contenders django-shipped,rust,ts]
"""
import argparse
import json
import time

import lpb
from run_bench import PORTS, template_for


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contenders", default="django-shipped,rust,ts")
    args = ap.parse_args()
    token = lpb.mint_token()
    for name in args.contenders.split(","):
        db = f"{lpb.RUN_PREFIX}fp_{name.replace('-', '_')}"
        lpb.clone(template_for("50k"), db)
        s = lpb.Server(name, db, PORTS[name]).start()
        try:
            time.sleep(5)
            idle = s.stat()
            for path in ("/api/albums/date/list/", "/api/rqavailable/", "/api/photos/3e9367a8cf8bf783f50ade55282dc5022/"):
                lpb.http_get(s.base + path, token)
            lpb.lpbench("w1", "--base", s.base, "--path", "/api/albums/date/1010/?page=1", "--token", token,
                        "--concurrency", 32, "--warmup", 1, "--duration", 5, timeout=60)
            loaded = s.stat()
            print(json.dumps({"contender": name, "cold_start_s": round(s.cold_start_s, 2),
                              "idle_ws_mib": round(idle["working_set"] / 2**20, 1),
                              "after_load_ws_mib": round(loaded["working_set"] / 2**20, 1)}))
        finally:
            s.stop()
            lpb.drop(db)


if __name__ == "__main__":
    main()
