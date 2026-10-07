"""Compare the `api_*` tables of two clones after the same task ran on each.

    python compare.py <ref_db> <rs_db> --baseline <db> --ref-media DIR --rs-media DIR
                      [--ignore table | table.column ...] [--count-only link_table ...]

Uses dump_state.py's table reader, but keeps row identities (dump_state
turns the photo ids of new link rows into ``<new-uuid>``, which merges
distinct link rows) and re-keys rows whose ids only record creation order:
AlbumThing by (owner, type, title), AlbumPlace by (owner, title), their link
tables alike, Person by (owner, kind, name), Cluster by (owner, cluster_id,
name), Face by (photo, box) with every reference to them following, and
LongRunningJob by (type, user, n-th). Timestamps become
``<unchanged>`` / ``<bumped>`` / ``<set>`` against the baseline row, the two
media roots ``<media>``, and fresh job ids ``<uuid>``.

Prints one line per difference; exit status 1 when there are any.
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "fixture"))

import dump_state  # noqa: E402

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NATURAL = {
    "api_albumthing": ("owner_id", "thing_type", "title"),
    "api_albumplace": ("owner_id", "title"),
    "api_person": ("cluster_owner_id", "kind", "name"),
    "api_cluster": ("owner_id", "cluster_id", "name"),
    "api_face": ("photo_id", "location_top", "location_right", "location_bottom", "location_left"),
}
# Columns pointing at a NATURAL table, rewritten to the target's natural key.
FKS = {
    "api_face": {
        "person_id": "api_person",
        "classification_person_id": "api_person",
        "cluster_person_id": "api_person",
        "cluster_id": "api_cluster",
    },
    "api_cluster": {"person_id": "api_person"},
    "api_person": {"cover_face_id": "api_face"},
}
LINKS = {
    "api_albumthing_photos": ("api_albumthing", "albumthing_id"),
    "api_albumthing_cover_photos": ("api_albumthing", "albumthing_id"),
    "api_albumthing_shared_to": ("api_albumthing", "albumthing_id"),
    "api_albumplace_photos": ("api_albumplace", "albumplace_id"),
    "api_albumplace_shared_to": ("api_albumplace", "albumplace_id"),
}


def canonical(state, baseline, roots):
    out = {}
    natural_ids = {}
    for table, fields in NATURAL.items():
        if table in state:
            natural_ids[table] = {
                row["id"]: "|".join(str(row[f]) for f in fields)
                for row in state[table]["rows"].values()
            }
    for table, info in state.items():
        old_rows = baseline.get(table, {}).get("rows", {})
        rows = {}
        ordinal = {}
        for key, row in sorted(info["rows"].items()):
            old = old_rows.get(key)
            canon = {}
            for column, value in row.items():
                if column in info["timestamps"]:
                    if value is None:
                        canon[column] = None
                    elif old is None:
                        canon[column] = "<set>"
                    else:
                        canon[column] = "<unchanged>" if old.get(column) == value else "<bumped>"
                elif old is None and isinstance(value, str) and UUID_RE.match(value) and column == "job_id":
                    canon[column] = "<uuid>"
                else:
                    canon[column] = dump_state.replace_root(value, roots)
            for column, target in FKS.get(table, {}).items():
                if row.get(column) is not None:
                    canon[column] = natural_ids.get(target, {}).get(row[column], row[column])
            new_key = key
            if table in NATURAL:
                new_key = natural_ids[table][row["id"]]
                canon["id"] = new_key
            elif table in LINKS:
                parent, fk = LINKS[table]
                canon[fk] = natural_ids.get(parent, {}).get(row[fk], row[fk])
                other = [c for c in row if c not in ("id", fk)]
                canon.pop("id", None)
                new_key = json.dumps([canon[fk]] + [canon[c] for c in other], default=str)
            elif table == "api_longrunningjob":
                pair = (row["job_type"], row["started_by_id"])
                ordinal[pair] = ordinal.get(pair, 0) + 1
                new_key = f"{pair[0]}|{pair[1]}|{ordinal[pair]}"
                canon["id"] = "<id>" if old is None else row["id"]
            rows[new_key] = canon
        out[table] = rows
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ref")
    p.add_argument("rs")
    p.add_argument("--baseline", required=True)
    p.add_argument("--ref-media", default="")
    p.add_argument("--rs-media", default="")
    p.add_argument("--ignore", nargs="*", default=[])
    p.add_argument(
        "--count-only",
        nargs="*",
        default=[],
        help="link tables compared by rows per parent only (e.g. covers picked in processing order)",
    )
    p.add_argument("--like", default="api_%")
    args = p.parse_args()
    baseline = dump_state.read_tables(args.baseline, args.like)
    ref = canonical(dump_state.read_tables(args.ref, args.like), baseline, dump_state.media_roots(args.ref_media))
    rs = canonical(dump_state.read_tables(args.rs, args.like), baseline, dump_state.media_roots(args.rs_media))
    ignore = set(args.ignore)
    for table in args.count_only:
        for side in (ref, rs):
            parent = LINKS[table][1]
            counts = {}
            for row in side.get(table, {}).values():
                counts[row[parent]] = counts.get(row[parent], 0) + 1
            side[table] = {str(k): {"rows": v} for k, v in counts.items()}
    lines = []
    for table in sorted(set(ref) | set(rs)):
        if table in ignore:
            continue
        a, b = ref.get(table, {}), rs.get(table, {})
        for key in sorted(set(a) | set(b)):
            ra, rb = a.get(key), b.get(key)
            if ra is None:
                lines.append(f"+ {table} {key}: {json.dumps(rb, ensure_ascii=False, default=str)}")
            elif rb is None:
                lines.append(f"- {table} {key}: {json.dumps(ra, ensure_ascii=False, default=str)}")
            else:
                for column in sorted(set(ra) | set(rb)):
                    if f"{table}.{column}" in ignore:
                        continue
                    va, vb = ra.get(column), rb.get(column)
                    if va != vb:
                        lines.append(
                            f"~ {table} {key} {column}: "
                            f"{json.dumps(va, ensure_ascii=False, default=str)[:300]} -> "
                            f"{json.dumps(vb, ensure_ascii=False, default=str)[:300]}"
                        )
    for line in lines:
        print(line)
    print(f"{len(lines)} difference(s)", file=sys.stderr)
    sys.exit(1 if lines else 0)


if __name__ == "__main__":
    main()
