"""Canonical state dumps for mutation diffs (plans/rust-backend/06 §5).

Run a mutation on two clones of lp_fixture (one served by Django, one by the
server under test), dump both, and diff:

    python dump_state.py db lp_mut_ref  --baseline lp_fixture --media-root D:/m/ref -o ref.json
    python dump_state.py db lp_mut_rs   --baseline lp_fixture --media-root D:/m/rs  -o rs.json
    python dump_state.py diff ref.json rs.json            # exit 1 on differences

    python dump_state.py files D:/m/ref -o ref-files.json [--content]

Every ``api_*`` table is dumped as rows keyed by primary key (M2M through
tables by their two foreign keys). Timestamps are compared against the
baseline row: ``<unchanged>``, ``<bumped>``, or ``<set>`` for new rows. UUIDs
minted by the mutation become ``<new-uuid>``, and the clone's media root
becomes ``<media>``, so two clones with separate media trees compare equal.

Needs only psycopg (the Django venv has it); connection settings come from
LP_PG_HOST / LP_PG_PORT / LP_PG_USER / PGPASSWORD (defaults: localhost:5433,
postgres).
"""

import argparse
import datetime
import decimal
import hashlib
import json
import os
import re
import sys
import uuid

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
TIMESTAMP_TYPES = {"timestamp with time zone", "timestamp without time zone"}


def connect(db):
    import psycopg

    return psycopg.connect(
        host=os.environ.get("LP_PG_HOST", "localhost"),
        port=os.environ.get("LP_PG_PORT", "5433"),
        user=os.environ.get("LP_PG_USER", "postgres"),
        password=os.environ.get("PGPASSWORD", "x"),
        dbname=db,
        autocommit=True,
    )


def table_layout(conn, like):
    tables = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name LIKE %s
            ORDER BY table_name, ordinal_position
            """,
            (like,),
        )
        for table, column, data_type in cur.fetchall():
            tables.setdefault(table, []).append((column, data_type))
        cur.execute(
            """
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
              AND tc.table_name LIKE %s
            ORDER BY tc.table_name, kcu.ordinal_position
            """,
            (like,),
        )
        pks = {}
        for table, column in cur.fetchall():
            pks.setdefault(table, []).append(column)
    return tables, pks


def key_columns(columns, pk):
    names = [c for c, _ in columns]
    fks = [c for c in names if c != "id" and c.endswith("_id")]
    if len(names) == 3 and "id" in names and len(fks) == 2:
        return fks, True
    return pk or names, False


def plain(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, float):
        return round(value, 9)
    if isinstance(value, (bytes, memoryview)):
        return bytes(value).hex()
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value


def read_tables(db, like):
    conn = connect(db)
    tables, pks = table_layout(conn, like)
    out = {}
    with conn.cursor() as cur:
        for table, columns in tables.items():
            keys, is_through = key_columns(columns, pks.get(table))
            names = [c for c, _ in columns if not (is_through and c == "id")]
            cur.execute(
                f'SELECT {", ".join(chr(34) + n + chr(34) for n in names)} FROM "{table}"'
            )
            rows = {}
            for record in cur.fetchall():
                row = {n: plain(v) for n, v in zip(names, record)}
                rows[json.dumps([row[k] for k in keys], default=str)] = row
            out[table] = {
                "rows": rows,
                "timestamps": [c for c, t in columns if t in TIMESTAMP_TYPES],
                "uuid_pk": [c for c, t in columns if t == "uuid" and c in keys],
            }
    conn.close()
    return out


def replace_root(value, roots):
    if isinstance(value, str):
        for root in roots:
            if root and root in value:
                value = value.replace(root, "<media>")
        return value
    if isinstance(value, dict):
        return {k: replace_root(v, roots) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_root(v, roots) for v in value]
    return value


def media_roots(root):
    if not root:
        return []
    root = os.path.abspath(root).rstrip("\\/")
    return sorted(
        {root, root.replace("\\", "/"), root.replace("/", "\\")}, key=len, reverse=True
    )


def dump_db(args):
    state = read_tables(args.db, args.like)
    baseline = read_tables(args.baseline, args.like) if args.baseline else {}
    new_uuids = set()
    for table, info in state.items():
        old = baseline.get(table, {}).get("rows", {})
        for key, row in info["rows"].items():
            if key not in old:
                new_uuids.update(row[c] for c in info["uuid_pk"] if row.get(c))

    roots = media_roots(args.media_root)
    tables = {}
    for table, info in sorted(state.items()):
        old_rows = baseline.get(table, {}).get("rows", {})
        rows = []
        for key, row in info["rows"].items():
            old = old_rows.get(key)
            canon = {}
            for column, value in row.items():
                if column in info["timestamps"]:
                    if value is None:
                        canon[column] = None
                    elif old is None:
                        canon[column] = "<set>"
                    else:
                        canon[column] = (
                            "<unchanged>" if old.get(column) == value else "<bumped>"
                        )
                elif (
                    isinstance(value, str)
                    and value in new_uuids
                    or old is None
                    and isinstance(value, str)
                    and UUID_RE.match(value)
                ):
                    canon[column] = "<new-uuid>"
                else:
                    canon[column] = replace_root(value, roots)
            display_key = json.loads(key)
            display_key = [("<new-uuid>" if k in new_uuids else k) for k in display_key]
            rows.append({"_key": replace_root(display_key, roots), **canon})
        rows.sort(key=lambda r: json.dumps(r, sort_keys=True, default=str))
        tables[table] = rows
    write({"source": args.db, "baseline": args.baseline, "tables": tables}, args.output)


def dump_files(args):
    root = os.path.abspath(args.root)
    rows = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            if args.skip and any(rel.startswith(s) for s in args.skip):
                continue
            row = {"_key": [rel], "size": os.path.getsize(path)}
            if args.content:
                with open(path, "rb") as fh:
                    row["sha256"] = hashlib.sha256(fh.read()).hexdigest()
            rows.append(row)
    rows.sort(key=lambda r: r["_key"])
    write({"source": root, "tables": {"files": rows}}, args.output)


def write(doc, output):
    text = json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False, default=str)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    else:
        sys.stdout.write(text + "\n")


def diff(args):
    with open(args.a, encoding="utf-8") as fh:
        a = json.load(fh)["tables"]
    with open(args.b, encoding="utf-8") as fh:
        b = json.load(fh)["tables"]
    lines = []
    ignore = set(args.ignore or [])
    for table in sorted(set(a) | set(b)):
        if table in ignore:
            continue
        rows_a = {json.dumps(r["_key"]): r for r in a.get(table, [])}
        rows_b = {json.dumps(r["_key"]): r for r in b.get(table, [])}
        for key in sorted(set(rows_a) | set(rows_b)):
            ra, rb = rows_a.get(key), rows_b.get(key)
            if ra is None:
                lines.append(
                    f"+ {table} {key}: {json.dumps(rb, sort_keys=True, ensure_ascii=False)}"
                )
            elif rb is None:
                lines.append(
                    f"- {table} {key}: {json.dumps(ra, sort_keys=True, ensure_ascii=False)}"
                )
            else:
                for column in sorted(set(ra) | set(rb)):
                    if f"{table}.{column}" in ignore:
                        continue
                    if ra.get(column) != rb.get(column):
                        lines.append(
                            f"~ {table} {key} {column}: "
                            f"{json.dumps(ra.get(column), ensure_ascii=False)} -> "
                            f"{json.dumps(rb.get(column), ensure_ascii=False)}"
                        )
    sys.stdout.write("\n".join(lines) + ("\n" if lines else ""))
    return 1 if lines else 0


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("db", help="dump the api_* tables of a database")
    p.add_argument("db")
    p.add_argument(
        "--baseline", help="database the mutation started from (usually lp_fixture)"
    )
    p.add_argument("--media-root", help="this clone's media tree; replaced by <media>")
    p.add_argument("--like", default="api\\_%", help="table name pattern (SQL LIKE)")
    p.add_argument("-o", "--output")
    p.set_defaults(func=dump_db)

    p = sub.add_parser(
        "files", help="dump a media tree (paths, sizes, optional hashes)"
    )
    p.add_argument("root")
    p.add_argument(
        "--content", action="store_true", help="include sha256 of every file"
    )
    p.add_argument(
        "--skip", action="append", help="relative path prefix to leave out (repeatable)"
    )
    p.add_argument("-o", "--output")
    p.set_defaults(func=dump_files)

    p = sub.add_parser("diff", help="diff two dumps; exit status 1 when they differ")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument(
        "--ignore",
        action="append",
        help="table or table.column to leave out (repeatable)",
    )
    p.set_defaults(func=diff)

    args = parser.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
