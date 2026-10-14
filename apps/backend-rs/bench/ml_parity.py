"""Compare the ML results of two kept `ml_footprint.py --keep` runs (same library, user `foot`):
tags, search embeddings and faces per photo (matched by image_hash).

  python ml_parity.py <db A> <db B> [--model mobileclip_s2]

Reports: photos tagged in both, identical tag lists (and sets), embedding cosine (min / mean),
faces per photo (same count), box IoU and encoding cosine of matched faces.
"""

import argparse
import json
import math
import subprocess
from pathlib import Path
import no_console  # noqa: F401,E402  (no console windows on Windows)

PG_BIN = Path(__file__).resolve().parents[4] / "rust-pg" / "pginstall" / "bin"


def q(db, sql):
    r = subprocess.run([str(PG_BIN / "psql.exe"), "-h", "localhost", "-p", "5433", "-U", "postgres", "-X", "-q", "-At",
                        "-F", "\t", "-d", db, "-c", sql], capture_output=True, text=True, encoding="utf-8", check=True)
    return [line.split("\t") for line in r.stdout.splitlines() if line]


def load(db, model):
    uid = q(db, "SELECT id FROM api_user WHERE username = 'foot'")[0][0]
    tags, emb, faces = {}, {}, {}
    for h, cj, ce in q(db, f"SELECT p.image_hash, c.captions_json::text, p.clip_embeddings::text FROM api_photo p "
                           f"LEFT JOIN api_photo_caption c ON c.photo_id = p.id WHERE p.owner_id = {uid}"):
        if cj:
            t = (json.loads(cj).get(model) or {}).get("tags")
            if t is not None:
                tags[h] = t
        if ce:
            v = json.loads(ce)
            emb[h] = json.loads(v) if isinstance(v, str) else v
    for h, top, right, bottom, left, enc in q(db, "SELECT p.image_hash, f.location_top, f.location_right, "
                                                  "f.location_bottom, f.location_left, f.encoding FROM api_face f "
                                                  f"JOIN api_photo p ON p.id = f.photo_id WHERE p.owner_id = {uid}"):
        e = None
        if enc:
            b = bytes.fromhex(enc)
            import struct
            e = list(struct.unpack(f"<{len(b) // 8}d", b))
        faces.setdefault(h, []).append(((int(top), int(right), int(bottom), int(left)), e))
    return tags, emb, faces


def cos(a, b):
    d = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return d / (na * nb) if na and nb else 0.0


def iou(a, b):
    t, r, bo, le = max(a[0], b[0]), min(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3])
    inter = max(0, r - le) * max(0, bo - t)
    area = lambda x: (x[1] - x[3]) * (x[2] - x[0])  # noqa: E731
    u = area(a) + area(b) - inter
    return inter / u if u > 0 else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--model", default="mobileclip_s2")
    args = ap.parse_args()
    ta, ea, fa = load(args.a, args.model)
    tb, eb, fb = load(args.b, args.model)
    both = sorted(set(ta) & set(tb))
    same_list = sum(ta[h] == tb[h] for h in both)
    same_set = sum(set(ta[h]) == set(tb[h]) for h in both)
    top1 = sum(bool(ta[h]) and bool(tb[h]) and ta[h][0] == tb[h][0] for h in both)
    jac = [len(set(ta[h]) & set(tb[h])) / max(1, len(set(ta[h]) | set(tb[h]))) for h in both]
    print(f"tags: {len(ta)} / {len(tb)} photos, {len(both)} in both; identical lists {same_list}, sets {same_set}, "
          f"top-1 {top1}, mean Jaccard {sum(jac) / max(1, len(jac)):.4f}")
    eb_both = sorted(set(ea) & set(eb))
    cs = [cos(ea[h], eb[h]) for h in eb_both]
    if cs:
        print(f"embeddings: {len(eb_both)} in both; cosine min {min(cs):.6f} mean {sum(cs) / len(cs):.6f}")
    hs = sorted(set(fa) | set(fb))
    same_n = sum(len(fa.get(h, [])) == len(fb.get(h, [])) for h in hs)
    ious, ecos = [], []
    for h in hs:
        for box, enc in fa.get(h, []):
            best = max(fb.get(h, []), key=lambda f: iou(box, f[0]), default=None)
            if best is None:
                continue
            ious.append(iou(box, best[0]))
            if enc and best[1]:
                ecos.append(cos(enc, best[1]))
    print(f"faces: {sum(len(v) for v in fa.values())} / {sum(len(v) for v in fb.values())} on {len(hs)} photos, "
          f"same count on {same_n}; matched IoU min {min(ious, default=0):.4f} mean "
          f"{sum(ious) / max(1, len(ious)):.4f}; encoding cosine min {min(ecos, default=0):.6f} "
          f"mean {sum(ecos) / max(1, len(ecos)):.6f}")
    diff = [h for h in both if set(ta[h]) != set(tb[h])][:5]
    for h in diff:
        print("  ", h[:12], ta[h], "|", tb[h])


if __name__ == "__main__":
    main()
