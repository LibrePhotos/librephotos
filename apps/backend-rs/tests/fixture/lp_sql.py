"""lp_sql: the psql of the SQLite harness (env.sh wraps it as `lp_sql`).

    lp_sql.py FILE -c "UPDATE ..."          run one statement (or a script)
    lp_sql.py FILE -f presql.sqlite.sql     run a script file
    lp_sql.py FILE < script.sql             run stdin
    lp_sql.py FILE -At -c "SELECT ..."      print rows unaligned, '|'-separated

A script runs in one transaction; the process exits non-zero on the first
error (like psql -v ON_ERROR_STOP=1). The connection uses Django's pragmas
(WAL, foreign keys on, 5 s busy timeout) and registers SQL functions that
write values the way Django's SQLite backend stores them:

    now()                  current time, "YYYY-MM-DD HH:MM:SS.ffffff" (naive UTC)
    dj_ts(text)            a stored or ISO timestamp, re-rendered in that format
                           (microseconds only when non-zero, as str(datetime))
    dj_add_days(text, n)   the timestamp moved by n days, same format; NULL stays NULL
    py_json(text)          JSON re-serialized as json.dumps() writes it
                           (", " / ": " separators, ensure_ascii, Python float repr)
    uuid_hex()             a random UUID as 32 lowercase hex digits (UUIDField)
    uuid_hex(text)         any UUID spelling as 32 lowercase hex digits

Standard library only.
"""

import argparse
import datetime
import json
import os
import sqlite3
import sys
import uuid

UTC = datetime.timezone.utc


def parse_ts(value):
    """A Django/ISO timestamp as a naive UTC datetime (None passes through)."""
    if value is None:
        return None
    text = str(value).strip().replace("T", " ")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.datetime.fromisoformat(text)
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def dj_ts(value):
    dt = parse_ts(value)
    return None if dt is None else str(dt)


def dj_add_days(value, days):
    dt = parse_ts(value)
    if dt is None:
        return None
    return str(dt + datetime.timedelta(days=int(days or 0)))


def now():
    return str(datetime.datetime.now(UTC).replace(tzinfo=None))


def py_json(value):
    if value is None:
        return None
    return json.dumps(json.loads(value))


def uuid_hex(*value):
    if not value:
        return uuid.uuid4().hex
    if value[0] is None:
        return None
    return uuid.UUID(str(value[0])).hex


def connect(path, timeout=5.0):
    if not os.path.isfile(path):
        raise sqlite3.OperationalError(f"no such database file: {path}")
    conn = sqlite3.connect(path, timeout=timeout, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.create_function("now", 0, now)
    conn.create_function("dj_ts", 1, dj_ts, deterministic=True)
    conn.create_function("dj_add_days", 2, dj_add_days, deterministic=True)
    conn.create_function("py_json", 1, py_json, deterministic=True)
    conn.create_function("uuid_hex", 0, uuid_hex)
    conn.create_function("uuid_hex", 1, uuid_hex, deterministic=True)
    return conn


def split_statements(script):
    """Split a script into complete statements: cut at every ';' and keep
    extending the piece until sqlite3.complete_statement() accepts it, so
    semicolons inside literals and trigger bodies stay put."""
    out, buf = [], ""
    for piece in script.split(";"):
        buf += piece + ";"
        if sqlite3.complete_statement(buf):
            if _has_sql(buf):
                out.append(buf.strip())
            buf = ""
    buf = buf[:-1]  # the ';' the last piece never had
    if _has_sql(buf):
        out.append(buf.strip())
    return out


def _has_sql(text):
    return any(
        ln.strip() and not ln.strip().startswith("--")
        for ln in text.rstrip(";").splitlines()
    )


def render(value):
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def run(path, script, unaligned=False, out=sys.stdout):
    conn = connect(path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        for stmt in split_statements(script):
            cur = conn.execute(stmt)
            if cur.description is not None:
                for row in cur.fetchall():
                    out.write("|".join(render(v) for v in row) + "\n")
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("db", help="SQLite file")
    ap.add_argument("-c", dest="command", help="SQL to run")
    ap.add_argument("-f", dest="file", help="SQL file to run")
    ap.add_argument("-A", action="store_true", help="unaligned output (always on)")
    ap.add_argument("-t", action="store_true", help="tuples only (always on)")
    args = ap.parse_args()
    if args.command is not None:
        script = args.command
    elif args.file:
        with open(args.file, encoding="utf-8") as fh:
            script = fh.read()
    else:
        script = sys.stdin.read()
    try:
        run(args.db, script)
    except sqlite3.Error as e:
        sys.stderr.write(f"lp_sql: {args.db}: {e}\n")
        sys.exit(3)


if __name__ == "__main__":
    main()
