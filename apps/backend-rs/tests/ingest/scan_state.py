"""Order-independent dump of what a scan wrote, for Django/Rust parity.

    python scan_state.py dump <db> <media_dir> -o out.json
    python scan_state.py diff ref.json rs.json [--ignore table.column ...]

Rows are keyed by content (image hash, file hash, owner + date, owner +
name) instead of ids and UUIDs, which depend on insertion order and
concurrency. Timestamps become present/absent. The clone's media directory
is replaced by ``<media>``. ``files`` lists protected_media with size and
sha256 (``--no-content`` for names only).
"""

import argparse
import hashlib
import json
import os
import sys

import psycopg


def connect(db):
    return psycopg.connect(
        host=os.environ.get("LP_PG_HOST", "localhost"),
        port=os.environ.get("LP_PG_PORT", "5433"),
        user=os.environ.get("LP_PG_USER", "postgres"),
        password=os.environ.get("PGPASSWORD", "x"),
        dbname=db,
        autocommit=True,
    )


def roots_of(media):
    media = os.path.abspath(media).rstrip("\\/")
    return sorted({media, media.replace("\\", "/"), media.replace("/", "\\")}, key=len, reverse=True)


def canon(value, roots):
    if isinstance(value, str):
        for r in roots:
            value = value.replace(r, "<media>")
        return value
    if isinstance(value, float):
        return round(value, 9)
    if isinstance(value, dict):
        return {k: canon(v, roots) for k, v in value.items()}
    if isinstance(value, list):
        return [canon(v, roots) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def rows(cur, sql):
    cur.execute(sql)
    names = [d.name for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def dump(args):
    roots = roots_of(args.media)
    conn = connect(args.db)
    out = {}
    with conn.cursor() as cur:
        photos = rows(cur, "SELECT p.*, u.username FROM api_photo p JOIN api_user u ON u.id = p.owner_id")
        key_of = {p["id"]: f"{p['username']}:{p['image_hash']}" for p in photos}
        files_of = {}
        for r in rows(cur, "SELECT photo_id, file_id FROM api_photo_files"):
            files_of.setdefault(key_of.get(r["photo_id"]), []).append(r["file_id"])
        t = {}
        for p in photos:
            k = key_of[p["id"]]
            row = {c: v for c, v in p.items() if c not in ("id", "owner_id", "clip_embeddings", "clip_embeddings_model")}
            for c in ("added_on", "last_modified"):
                row[c] = row[c] is not None
            row["files"] = sorted(files_of.get(k, []))
            t[k] = canon(row, roots)
        out["api_photo"] = t
        out["api_file"] = {
            r["hash"]: canon({"path": r["path"], "type": r["type"], "missing": r["missing"]}, roots)
            for r in rows(cur, "SELECT * FROM api_file")
        }
        out["api_file_embedded_media"] = {
            f"{r['from_file_id']}>{r['to_file_id']}": True
            for r in rows(cur, "SELECT * FROM api_file_embedded_media")
        }
        for table, skip in (
            ("api_thumbnail", ()),
            ("api_photometadata", ("id", "created_at", "updated_at")),
            ("api_photo_search", ("created_at", "updated_at")),
            ("api_photo_caption", ("created_at", "updated_at")),
        ):
            t = {}
            for r in rows(cur, f"SELECT * FROM {table}"):
                k = key_of.get(r["photo_id"], r["photo_id"])
                t[k] = canon({c: v for c, v in r.items() if c not in skip and c != "photo_id"}, roots)
            out[table] = t
        members = {}
        for r in rows(cur, "SELECT albumdate_id, photo_id FROM api_albumdate_photos"):
            members.setdefault(r["albumdate_id"], []).append(key_of.get(r["photo_id"]))
        out["api_albumdate"] = {
            f"{r['username']}:{r['date']}": {
                "title": r["title"],
                "favorited": r["favorited"],
                "location": r["location"],
                "photos": sorted(members.get(r["id"], [])),
            }
            for r in rows(cur, "SELECT a.*, u.username FROM api_albumdate a JOIN api_user u ON u.id = a.owner_id")
        }
        tag_members = {}
        for r in rows(cur, "SELECT tag_id, photo_id FROM api_tag_photos"):
            tag_members.setdefault(r["tag_id"], []).append(key_of.get(r["photo_id"]))
        out["api_tag"] = {
            f"{r['username']}:{r['name']}": {"photo_count": r["photo_count"], "photos": sorted(tag_members.get(r["id"], []))}
            for r in rows(cur, "SELECT t.*, u.username FROM api_tag t JOIN api_user u ON u.id = t.owner_id")
        }
        thing_members = {}
        for r in rows(cur, "SELECT albumthing_id, photo_id FROM api_albumthing_photos"):
            thing_members.setdefault(r["albumthing_id"], []).append(key_of.get(r["photo_id"]))
        out["api_albumthing"] = {
            f"{r['username']}:{r['thing_type']}:{r['title']}": {
                "photo_count": r["photo_count"],
                "photos": sorted(thing_members.get(r["id"], [])),
            }
            for r in rows(cur, "SELECT a.*, u.username FROM api_albumthing a JOIN api_user u ON u.id = a.owner_id")
        }
        out["api_longrunningjob"] = {
            f"{r['username']}:{r['job_type']}:{n}": canon(
                {
                    "finished": r["finished"],
                    "failed": r["failed"],
                    "cancelled": r["cancelled"],
                    "progress_current": r["progress_current"],
                    "progress_target": r["progress_target"],
                    "result": r["result"],
                    "started": r["started_at"] is not None,
                    "finished_at": r["finished_at"] is not None,
                },
                roots,
            )
            for n, r in enumerate(
                rows(
                    cur,
                    "SELECT j.*, u.username FROM api_longrunningjob j JOIN api_user u ON u.id = j.started_by_id "
                    "ORDER BY u.username, j.job_type, j.queued_at",
                )
            )
        }
    conn.close()
    files = {}
    pm = os.path.join(args.media, "protected_media")
    for dirpath, _dirs, names in os.walk(pm):
        for name in names:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, pm).replace("\\", "/")
            entry = {"size": os.path.getsize(path)}
            if not args.no_content:
                with open(path, "rb") as fh:
                    entry["sha256"] = hashlib.sha256(fh.read()).hexdigest()
            files[rel] = entry
    out["files"] = files
    text = json.dumps(out, indent=1, sort_keys=True, ensure_ascii=False, default=str)
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")


def diff(args):
    a = json.load(open(args.a, encoding="utf-8"))
    b = json.load(open(args.b, encoding="utf-8"))
    ignore = set(args.ignore or [])
    lines = []
    for table in sorted(set(a) | set(b)):
        if table in ignore:
            continue
        ta, tb = a.get(table, {}), b.get(table, {})
        for key in sorted(set(ta) | set(tb)):
            ra, rb = ta.get(key), tb.get(key)
            if ra is None or rb is None:
                lines.append(f"{'+' if ra is None else '-'} {table} {key}: {json.dumps(ra or rb, ensure_ascii=False, sort_keys=True)}")
                continue
            if not isinstance(ra, dict):
                if ra != rb:
                    lines.append(f"~ {table} {key}: {ra} -> {rb}")
                continue
            for col in sorted(set(ra) | set(rb)):
                if f"{table}.{col}" in ignore:
                    continue
                if ra.get(col) != rb.get(col):
                    lines.append(
                        f"~ {table} {key} {col}: {json.dumps(ra.get(col), ensure_ascii=False)} -> {json.dumps(rb.get(col), ensure_ascii=False)}"
                    )
    sys.stdout.write("\n".join(lines) + ("\n" if lines else ""))
    return 1 if lines else 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dump")
    d.add_argument("db")
    d.add_argument("media")
    d.add_argument("-o", "--output", required=True)
    d.add_argument("--no-content", action="store_true")
    f = sub.add_parser("diff")
    f.add_argument("a")
    f.add_argument("b")
    f.add_argument("--ignore", nargs="*")
    args = ap.parse_args()
    if args.cmd == "dump":
        dump(args)
        return 0
    return diff(args)


if __name__ == "__main__":
    sys.exit(main())
