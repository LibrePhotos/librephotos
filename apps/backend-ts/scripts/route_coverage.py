"""Route coverage: every (method, path) librephotos-rs serves vs the TS file routes.

    python apps/backend-ts/scripts/route_coverage.py [--verbose]

Parses the axum `.route("path", get(..).post(..))` calls in
apps/backend-rs/crates and the TanStack Start route files under
apps/backend-ts/src/routes (handler keys GET/POST/...). Path params are
normalized ({id} / $id -> {}, splats -> {*}). Exit status 1 when a Rust
route has no TS counterpart.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TS = os.path.dirname(HERE)
APPS = os.path.dirname(TS)
RS_CRATES = os.path.join(APPS, "backend-rs", "crates")
TS_ROUTES = os.path.join(TS, "src", "routes")
METHODS = ("get", "post", "put", "patch", "delete", "head")


def balanced(text, start):
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1 : i]
    return text[start + 1 :]


def norm(path):
    path = path.rstrip("/") or "/"
    path = re.sub(r"\{\*[^}]*\}", "{*}", path)
    return re.sub(r"\{[^}*]+\}", "{}", path)


def rust_routes():
    out = {}
    for root, _, files in os.walk(RS_CRATES):
        if "target" in root or os.sep + "tests" in root:
            continue
        for f in files:
            if not f.endswith(".rs"):
                continue
            src = open(os.path.join(root, f), encoding="utf-8").read()
            for m in re.finditer(r"\.route\(", src):
                body = balanced(src, m.end() - 1)
                pm = re.match(r'\s*"([^"]+)"\s*,(.*)', body, re.S)
                if not pm:
                    continue
                path, handlers = pm.groups()
                methods = set()
                for meth in METHODS:
                    if re.search(rf"(?:^|[\s.(]){meth}(?:_service)?\(", handlers):
                        methods.add(meth.upper())
                if re.search(r"\bany\(", handlers):
                    methods.add("ANY")
                for mm in re.finditer(r"MethodFilter::([A-Z]+)", handlers):
                    methods.add(mm.group(1))
                key = norm(path)
                out.setdefault(key, set()).update(methods)
                out[key].add("@" + os.path.relpath(os.path.join(root, f), RS_CRATES).replace(os.sep, "/"))
    return out


def ts_path(rel):
    rel = re.sub(r"\.(ts|tsx)$", "", rel.replace(os.sep, "/"))
    segs = []
    for part in rel.split("/"):
        # flat routes: a.b.c -> a/b/c, except inside [..] escapes
        for seg in re.split(r"\.(?![^\[]*\])", part):
            if seg in ("index", "route"):
                continue
            if seg.startswith("_") or (seg.startswith("(") and seg.endswith(")")):
                continue  # pathless layouts / groups
            seg = re.sub(r"\[([^\]]*)\]", r"\1", seg)
            if seg == "$":
                seg = "{*}"
            elif seg.startswith("$"):
                seg = "{}" + seg[len(re.match(r"\$[A-Za-z0-9_]*", seg).group(0)):]
            elif "$" in seg:
                seg = re.sub(r"\$[A-Za-z0-9_]+", "{}", seg)
            segs.append(seg)
    return norm("/" + "/".join(s for s in segs if s))


def ts_routes():
    out = {}
    for root, _, files in os.walk(TS_ROUTES):
        for f in files:
            if not f.endswith((".ts", ".tsx")) or f.startswith("__root"):
                continue
            full = os.path.join(root, f)
            src = open(full, encoding="utf-8").read()
            if "handlers" not in src or "Unknown /api/* paths" in src:
                continue
            methods = set(re.findall(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s*:", src))
            out.setdefault(ts_path(os.path.relpath(full, TS_ROUTES)), set()).update(methods)
    return out


def main():
    verbose = "--verbose" in sys.argv
    rs, ts = rust_routes(), ts_routes()
    missing, total = [], 0
    for path in sorted(rs):
        meths = sorted(m for m in rs[path] if not m.startswith("@"))
        src = next(m for m in rs[path] if m.startswith("@"))[1:]
        for m in meths:
            total += 1
            have = ts.get(path, set())
            # A splat TS route (e.g. /media/{*}) can cover several Rust paths.
            covered = m in have or "ANY" == m and have or any(
                p.endswith("{*}") and path.startswith(p[:-3]) and m in ts[p] for p in ts
            )
            if not covered:
                missing.append((m, path, src))
            elif verbose:
                print(f"ok      {m:6} {path}")
    for m, path, src in missing:
        print(f"MISSING {m:6} {path}    ({src})")
    print(f"\n{total - len(missing)}/{total} Rust (method, path) pairs covered by TS routes; {len(ts)} TS route files")
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
