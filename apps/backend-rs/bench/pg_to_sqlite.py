"""Convert a Postgres benchmark database into the SQLite file Django's
DB_BACKEND=sqlite would have written (plans: sqlite_design.md §6, P1b).

  python pg_to_sqlite.py lp_bench_50k [-o OUT.sqlite3] [--schema lp_django.sqlite3]

Django's dumpdata/loaddata is far too slow for 50k photos, so this copies the
rows directly. The output starts as a copy of --schema, an empty Django-migrated
SQLite file (tests/fixture/build_fixture.sh with LP_FIXTURE_BACKEND=sqlite
writes rust-pg/fixture-sqlite/lp_django.sqlite3, api.0144: the schema
migrations/sqlite/0000_baseline.sql was cut from). Every table both sides
have is emptied and refilled from Postgres, except django_migrations (the
file keeps its own, at 0144). Postgres-only tables and columns (the Rust
migrations: job_queue, site_settings, clip_embeddings_model, ...) are left
out and listed; librephotos-rs `adopt` recreates them on SQLite.

Values are written the way Django's SQLite backend stores them:
  timestamptz      "YYYY-MM-DD HH:MM:SS[.ffffff]" (naive UTC, str(datetime))
  uuid             32 lowercase hex digits (char(32))
  jsonb / json     json.dumps() text (", " / ": ", ensure_ascii); JSON null
                   stays the text 'null', SQL NULL stays NULL
  boolean          0 / 1
  date             "YYYY-MM-DD"
Key order inside JSON objects follows jsonb (sorted by length, then bytes),
not the order Django originally wrote: logically the same document.

Standard library + psycopg (the Django venv has both).
"""

import argparse
import datetime
import decimal
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SQLITE_ROOT = r"C:\Users\Niaz\librephotos\rust-pg\fixture-sqlite"
SKIP_TABLES = {"django_migrations", "sqlite_sequence"}
SQLITE_KINDS = {
    "datetime": "timestamp",
    "char(32)": "uuid",
    "bool": "bool",
    "date": "date",
}
JSON_CHECK_RE = re.compile(r'JSON_VALID\("([^"]+)"\)', re.IGNORECASE)
UTC = datetime.timezone.utc
BATCH = 5000


def pg_connect(db):
    import psycopg

    return psycopg.connect(
        host=os.environ.get("LP_PG_HOST", "localhost"),
        port=os.environ.get("LP_PG_PORT", "5433"),
        user=os.environ.get("LP_PG_USER", "postgres"),
        password=os.environ.get("PGPASSWORD", "x"),
        dbname=db,
    )


def pg_tables(pg):
    with pg.cursor() as cur:
        cur.execute(
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
        )
        out = {}
        for table, column, data_type in cur.fetchall():
            out.setdefault(table, {})[column] = data_type
    return out


def sqlite_tables(lite):
    out = {}
    for table, ddl in lite.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall():
        json_columns = set(JSON_CHECK_RE.findall(ddl or ""))
        cols = {}
        for _cid, column, decl, notnull, default, _pk in lite.execute(
            f'PRAGMA table_info("{table}")'
        ):
            kind = (
                "json"
                if column in json_columns
                else SQLITE_KINDS.get((decl or "").lower(), "other")
            )
            cols[column] = (kind, bool(notnull), default)
        out[table] = cols
    return out


def django_ts(value):
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return str(value)


def converter(kind, pg_type):
    """A function turning one psycopg value into its Django-on-SQLite form."""
    if kind == "json":
        # Selected as ::text, so JSON null and SQL NULL stay apart.
        return lambda v: None if v is None else json.dumps(json.loads(v))
    if kind == "timestamp" or pg_type.startswith("timestamp"):
        return django_ts
    if kind == "uuid" or pg_type == "uuid":
        return lambda v: (
            None
            if v is None
            else (v.hex if isinstance(v, uuid.UUID) else uuid.UUID(str(v)).hex)
        )
    if kind == "bool" or pg_type == "boolean":
        return lambda v: None if v is None else int(bool(v))
    if pg_type == "date":
        return lambda v: None if v is None else v.isoformat()
    if pg_type in ("numeric",):
        return lambda v: None if v is None else float(v)
    if pg_type == "bytea":
        return lambda v: None if v is None else bytes(v)
    if pg_type == "ARRAY":
        return lambda v: None if v is None else json.dumps(v)
    return None


def plain(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, memoryview):
        return bytes(v)
    return v


def copy_table(pg, lite, table, columns, pg_cols, lite_cols):
    select = ", ".join(
        f'"{c}"::text' if lite_cols[c][0] == "json" else f'"{c}"' for c in columns
    )
    convs = [converter(lite_cols[c][0], pg_cols[c]) for c in columns]
    insert = (
        f'INSERT INTO "{table}" ({", ".join(chr(34) + c + chr(34) for c in columns)}) '
        f"VALUES ({', '.join('?' for _ in columns)})"
    )
    lite.execute(f'DELETE FROM "{table}"')
    n = 0
    with pg.cursor(name=f"lp_copy_{table}") as cur:
        cur.itersize = BATCH
        cur.execute(f'SELECT {select} FROM "{table}"')
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                break
            lite.executemany(
                insert,
                [
                    tuple((f(v) if f else plain(v)) for f, v in zip(convs, row))
                    for row in rows
                ],
            )
            n += len(rows)
    return n


def convert(db, out, schema):
    t0 = time.perf_counter()
    if not os.path.isfile(schema):
        raise SystemExit(
            f"no schema file {schema} (LP_FIXTURE_BACKEND=sqlite build_fixture.sh)"
        )
    tmp = out + ".part"
    for p in (tmp, tmp + "-journal", tmp + "-wal", tmp + "-shm"):
        if os.path.exists(p):
            os.remove(p)
    shutil.copyfile(schema, tmp)
    lite = sqlite3.connect(tmp, isolation_level=None)
    lite.execute("PRAGMA journal_mode = OFF")
    lite.execute("PRAGMA synchronous = OFF")
    lite.execute("PRAGMA foreign_keys = OFF")
    lite.execute("PRAGMA cache_size = -262144")
    lite.execute("PRAGMA locking_mode = EXCLUSIVE")
    pg = pg_connect(db)
    pgt = pg_tables(pg)
    lt = sqlite_tables(lite)
    report = {
        "tables": {},
        "pg_only_tables": sorted(set(pgt) - set(lt)),
        "pg_only_columns": {},
        "sqlite_only_columns": {},
    }
    lite.execute("BEGIN")
    for table in sorted(set(pgt) & set(lt) - SKIP_TABLES):
        pg_cols, lite_cols = pgt[table], lt[table]
        columns = [c for c in lite_cols if c in pg_cols]
        extra = sorted(set(pg_cols) - set(lite_cols))
        missing = [c for c in lite_cols if c not in pg_cols]
        if extra:
            report["pg_only_columns"][table] = extra
        if missing:
            report["sqlite_only_columns"][table] = missing
            required = [
                c for c in missing if lite_cols[c][1] and lite_cols[c][2] is None
            ]
            if required:
                raise SystemExit(
                    f"{table}: NOT NULL columns {required} have no Postgres source"
                )
        t = time.perf_counter()
        n = copy_table(pg, lite, table, columns, pg_cols, lite_cols)
        report["tables"][table] = n
        dt = time.perf_counter() - t
        if n >= 10000 or dt > 2:
            print(f"  {table}: {n} rows in {dt:.1f}s", flush=True)
    lite.execute("COMMIT")
    pg.close()
    problems = lite.execute("PRAGMA foreign_key_check").fetchall()
    report["foreign_key_violations"] = len(problems)
    lite.execute("PRAGMA locking_mode = NORMAL")
    lite.close()
    # Back to how Django leaves a database: WAL, rows checked.
    lite = sqlite3.connect(tmp)
    lite.execute("PRAGMA journal_mode = WAL")
    lite.close()
    if os.path.exists(out):
        os.remove(out)
    os.replace(tmp, out)
    report["seconds"] = round(time.perf_counter() - t0, 1)
    report["bytes"] = os.path.getsize(out)
    return report


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("db", help="Postgres database, e.g. lp_bench_50k")
    ap.add_argument("-o", "--output", help=f"default {SQLITE_ROOT}\\<db>.sqlite3")
    ap.add_argument(
        "--schema",
        default=os.path.join(SQLITE_ROOT, "lp_django.sqlite3"),
        help="empty Django-migrated SQLite file to start from",
    )
    args = ap.parse_args()
    out = args.output or os.path.join(SQLITE_ROOT, f"{args.db}.sqlite3")
    report = convert(args.db, out, args.schema)
    rows = sum(report["tables"].values())
    print(json.dumps({k: v for k, v in report.items() if k != "tables"}, indent=1))
    print(
        f"{args.db} -> {out}: {len(report['tables'])} tables, {rows} rows, "
        f"{report['bytes'] / 1e6:.0f} MB in {report['seconds']} s"
    )
    if report["foreign_key_violations"]:
        print(
            f"warning: {report['foreign_key_violations']} foreign key violations",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
