"""Canonical state dumps for mutation diffs (plans/rust-backend/06 §5).

Run a mutation on two clones of lp_fixture (one served by Django, one by the
server under test), dump both, and diff:

    python dump_state.py db lp_mut_ref  --baseline lp_fixture --media-root D:/m/ref -o ref.json
    python dump_state.py db lp_mut_rs   --baseline lp_fixture --media-root D:/m/rs  -o rs.json
    python dump_state.py diff ref.json rs.json            # exit 1 on differences

    python dump_state.py files D:/m/ref -o ref-files.json [--content]

SQLite clones (Django's DB_BACKEND=sqlite file) dump to the same format:

    python dump_state.py db --sqlite D:/c/mut_ref.sqlite3 --baseline D:/fx/lp_fixture.sqlite3 ...

``--baseline`` is a database name or, when it looks like a path, a SQLite
file. The SQLite reader takes the column types from ``PRAGMA table_info`` and
the CHECK constraints: ``datetime`` text (naive UTC) is parsed, ``char(32)``
UUIDs become the dashed spelling Postgres returns, JSON text is parsed, and
``bool`` 0/1 become booleans. ``--raw`` skips the baseline placeholders and
prints the values themselves (timestamps in UTC), for comparing two
databases that were built separately, e.g. the Postgres and SQLite fixtures.

Every ``api_*`` table is dumped as rows keyed by primary key (M2M through
tables by their two foreign keys). Timestamps are compared against the
baseline row: ``<unchanged>``, ``<bumped>``, or ``<set>`` for new rows. UUIDs
minted by the mutation become ``<new-uuid>``, and the clone's media root
becomes ``<media>``, so two clones with separate media trees compare equal.

Needs only psycopg (the Django venv has it; SQLite uses the standard
library); connection settings come from LP_PG_HOST / LP_PG_PORT / LP_PG_USER /
PGPASSWORD (defaults: localhost:5433, postgres).
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
UTC = datetime.timezone.utc

# Column kinds the dump normalizes, per backend (anything else is "other").
PG_KINDS = {
    "timestamp with time zone": "timestamp",
    "timestamp without time zone": "timestamp",
    "uuid": "uuid",
    "json": "json",
    "jsonb": "json",
    "boolean": "bool",
    "date": "date",
}
# Django's SQLite data types (django/db/backends/sqlite3/base.py data_types).
SQLITE_KINDS = {
    "datetime": "timestamp",
    "char(32)": "uuid",
    "bool": "bool",
    "date": "date",
}
JSON_CHECK_RE = re.compile(r'JSON_VALID\("([^"]+)"\)', re.IGNORECASE)


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


def is_sqlite_path(name):
    return bool(name) and (
        "/" in name or "\\" in name or name.endswith((".sqlite3", ".sqlite", ".db"))
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
            tables.setdefault(table, []).append(
                (column, PG_KINDS.get(data_type, "other"))
            )
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
    # Sorted, so the key does not depend on the column order (SQLite table
    # rebuilds reorder columns).
    fks = sorted(c for c in names if c != "id" and c.endswith("_id"))
    if len(names) == 3 and "id" in names and len(fks) == 2:
        return fks, True
    return pk or names, False


def plain(value):
    if isinstance(value, datetime.datetime) and value.tzinfo is not None:
        return value.astimezone(UTC).isoformat()
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


def sqlite_layout(conn, like):
    """Tables, column kinds and primary keys of a SQLite file, from
    sqlite_master (JSONField CHECK constraints) and PRAGMA table_info."""
    tables, pks = {}, {}
    found = conn.execute(
        "SELECT name, sql FROM sqlite_master"
        " WHERE type = 'table' AND name LIKE ? ESCAPE '\\' ORDER BY name",
        (like,),
    ).fetchall()
    for table, ddl in found:
        json_columns = set(JSON_CHECK_RE.findall(ddl or ""))
        info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
        columns = []
        for _cid, column, decl, _notnull, _default, _pk in info:
            kind = SQLITE_KINDS.get((decl or "").lower(), "other")
            if column in json_columns:
                kind = "json"
            columns.append((column, kind))
        tables[table] = columns
        pks[table] = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5]]
    return tables, pks


def parse_sqlite_timestamp(value):
    """Django's SQLite datetime text (naive UTC) as an aware datetime."""
    if value is None or isinstance(value, datetime.datetime):
        return value
    dt = datetime.datetime.fromisoformat(str(value).replace("T", " "))
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def sqlite_value(kind, value):
    if value is None:
        return None
    if kind == "timestamp":
        return parse_sqlite_timestamp(value)
    if kind == "uuid":
        return uuid.UUID(str(value))
    if kind == "bool":
        return bool(value)
    if kind == "json":
        return json.loads(value)
    return value


# Tables keyed by content instead of their serial id: rows a mutation inserts
# in an order that is not part of the contract (one tombstone per photo of a
# bulk delete). The key is the listed columns plus an occurrence number, so
# duplicate rows still count.
CONTENT_KEYED = {"api_deletionlog": ["owner_id", "entity", "entity_id"]}


def fetch_pg(db, like):
    conn = connect(db)
    tables, pks = table_layout(conn, like)
    out = {}
    with conn.cursor() as cur:
        for table, columns in tables.items():
            keys, is_through = key_columns(columns, pks.get(table))
            names = [
                c
                for c, _ in columns
                if not ((is_through or table in CONTENT_KEYED) and c == "id")
            ]
            cur.execute(
                f'SELECT {", ".join(chr(34) + n + chr(34) for n in names)} FROM "{table}"'
            )
            out[table] = (columns, keys, names, cur.fetchall())
    conn.close()
    return out


def fetch_sqlite(path, like):
    import sqlite3

    if not os.path.isfile(path):
        raise SystemExit(f"no such SQLite file: {path}")
    # Read-write on purpose: a server killed mid-run leaves its WAL behind, and
    # only a writable connection replays it (and checkpoints it away on close).
    conn = sqlite3.connect(path)
    tables, pks = sqlite_layout(conn, like)
    out = {}
    for table, columns in tables.items():
        keys, is_through = key_columns(columns, pks.get(table))
        kinds = dict(columns)
        names = [
            c
            for c, _ in columns
            if not ((is_through or table in CONTENT_KEYED) and c == "id")
        ]
        cur = conn.execute(
            f'SELECT {", ".join(chr(34) + n + chr(34) for n in names)} FROM "{table}"'
        )
        records = [
            tuple(sqlite_value(kinds[n], v) for n, v in zip(names, record))
            for record in cur.fetchall()
        ]
        out[table] = (columns, keys, names, records)
    conn.close()
    return out


def read_tables(db, like, sqlite=None):
    """{table: {rows, timestamps, uuid_pk}} of the Postgres database ``db``
    or, with ``sqlite``, of that SQLite file."""
    fetched = fetch_sqlite(sqlite, like) if sqlite else fetch_pg(db, like)
    out = {}
    for table, (columns, keys, names, records) in fetched.items():
        rows = {}
        seen = {}
        content = CONTENT_KEYED.get(table)
        for record in records:
            row = {n: plain(v) for n, v in zip(names, record)}
            if content:
                base = json.dumps([row[k] for k in content], default=str)
                seen[base] = seen.get(base, 0) + 1
                key = json.dumps([*json.loads(base), seen[base]], default=str)
            else:
                key = json.dumps([row[k] for k in keys], default=str)
            rows[key] = row
        out[table] = {
            "rows": rows,
            "timestamps": [c for c, t in columns if t == "timestamp"],
            "uuid_pk": [c for c, t in columns if t == "uuid" and c in keys],
        }
    return out


def read_source(name, like):
    """A database name, or a SQLite file when ``name`` looks like a path."""
    if is_sqlite_path(name):
        return read_tables(None, like, sqlite=name)
    return read_tables(name, like)


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
    if args.sqlite:
        source = args.sqlite
        state = read_tables(None, args.like, sqlite=args.sqlite)
    elif args.db:
        source = args.db
        state = read_tables(args.db, args.like)
    else:
        raise SystemExit("dump_state.py db: give a database name or --sqlite PATH")
    baseline = read_source(args.baseline, args.like) if args.baseline else {}
    if args.raw:
        roots = media_roots(args.media_root)
        tables = {}
        for table, info in sorted(state.items()):
            rows = [
                {
                    "_key": replace_root(json.loads(key), roots),
                    **replace_root(row, roots),
                }
                for key, row in info["rows"].items()
            ]
            rows.sort(key=lambda r: json.dumps(r, sort_keys=True, default=str))
            tables[table] = rows
        write({"source": source, "baseline": None, "tables": tables}, args.output)
        return
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
    write({"source": source, "baseline": args.baseline, "tables": tables}, args.output)


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
    p.add_argument("db", nargs="?", help="Postgres database (or use --sqlite)")
    p.add_argument("--sqlite", metavar="PATH", help="dump this SQLite file instead")
    p.add_argument(
        "--baseline",
        help="database the mutation started from (usually lp_fixture), or a SQLite file",
    )
    p.add_argument(
        "--raw",
        action="store_true",
        help="no baseline placeholders: the values themselves (timestamps in UTC)",
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
