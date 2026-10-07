"""Compare the E2E dumps of the Rust (in-process ML) and Django (sidecar) runs."""

import json
import struct
import sys

import numpy as np
from sklearn.metrics import adjusted_rand_score

rs = json.load(open(sys.argv[1], encoding="utf8"))
dj = json.load(open(sys.argv[2], encoding="utf8"))


def enc(hexs):
    b = bytes.fromhex(hexs)
    return np.array(struct.unpack(f"<{len(b) // 8}d", b))


def cos(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    return float(a @ b / (na * nb)) if na and nb else float("nan")


def iou(a, b):
    t, r, bo, le = a[:4]
    t2, r2, bo2, le2 = b[:4]
    iw = max(0, min(r, r2) - max(le, le2))
    ih = max(0, min(bo, bo2) - max(t, t2))
    inter = iw * ih
    u = (r - le) * (bo - t) + (r2 - le2) * (bo2 - t2) - inter
    return inter / u if u else 0.0


def clip_vec(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = json.loads(v)
    return v or None


names = sorted(set(rs["photos"]) & set(dj["photos"]))
only = sorted(set(rs["photos"]) ^ set(dj["photos"]))
res = {"photos_common": len(names), "photos_only_one_side": only}

face_count_eq = 0
ious, coss = [], []
rs_lab, dj_lab, rs_person, dj_person = [], [], [], []
face_tot = [0, 0]
unmatched = 0
for n in names:
    a = [f for f in rs["photos"][n]["faces"] if not f[9]]
    b = [f for f in dj["photos"][n]["faces"] if not f[9]]
    face_tot[0] += len(a)
    face_tot[1] += len(b)
    face_count_eq += len(a) == len(b)
    used = set()
    for fa in a:
        best, bj = 0, None
        for j, fb in enumerate(b):
            if j in used:
                continue
            v = iou(fa, fb)
            if v > best:
                best, bj = v, j
        if bj is None or best < 0.3:
            unmatched += 1
            continue
        used.add(bj)
        fb = b[bj]
        ious.append(best)
        coss.append(cos(enc(fa[4]), enc(fb[4])))
        rs_lab.append(fa[6] if fa[6] is not None else -1)
        dj_lab.append(fb[6] if fb[6] is not None else -1)
        rs_person.append(fa[7] if fa[7] is not None else (fa[5] or -1))
        dj_person.append(fb[7] if fb[7] is not None else (fb[5] or -1))
    unmatched += len(b) - len(used)

res["faces"] = {
    "total_rs": face_tot[0],
    "total_dj": face_tot[1],
    "photos_same_count": f"{face_count_eq}/{len(names)}",
    "matched": len(ious),
    "unmatched": unmatched,
    "iou_min": round(min(ious), 4) if ious else None,
    "iou_mean": round(float(np.mean(ious)), 4) if ious else None,
    "cos_min": round(min(coss), 6) if coss else None,
    "cos_mean": round(float(np.mean(coss)), 6) if coss else None,
    "ari_cluster_id": round(adjusted_rand_score(dj_lab, rs_lab), 4) if ious else None,
    "ari_person": round(adjusted_rand_score(dj_person, rs_person), 4) if ious else None,
    "clusters_rs": len(set(rs_lab)),
    "clusters_dj": len(set(dj_lab)),
}

keys = set()
for n in names:
    for side in (rs, dj):
        cj = side["photos"][n]["captions_json"] or {}
        keys |= set(cj)
cap = {}
for k in sorted(keys):
    same = total = 0
    diffs = []
    jacc = []
    for n in names:
        va = (rs["photos"][n]["captions_json"] or {}).get(k)
        vb = (dj["photos"][n]["captions_json"] or {}).get(k)
        if va is None and vb is None:
            continue
        total += 1
        if va == vb:
            same += 1
        else:
            diffs.append((n, va, vb))
        if isinstance(va, list) and isinstance(vb, list):
            sa, sb = set(map(str, va)), set(map(str, vb))
            jacc.append(len(sa & sb) / len(sa | sb) if sa | sb else 1.0)
    cap[k] = {"exact": f"{same}/{total}", "mean_jaccard": round(float(np.mean(jacc)), 4) if jacc else None,
              "diffs": diffs[:6]}
res["captions_json"] = cap

same = total = 0
ocr_diffs = []
for n in names:
    a, b = rs["photos"][n]["ocr"], dj["photos"][n]["ocr"]
    if a is None and b is None:
        continue
    total += 1
    if (a or "") == (b or ""):
        same += 1
    else:
        ocr_diffs.append((n, a, b))
res["ocr"] = {"exact": f"{same}/{total}", "diffs": ocr_diffs[:6]}

cc = []
missing = []
for n in names:
    a, b = clip_vec(rs["photos"][n]["clip"]), clip_vec(dj["photos"][n]["clip"])
    if a is None or b is None:
        if (a is None) != (b is None):
            missing.append(n)
        continue
    cc.append((cos(a, b), n))
cc.sort()
res["clip"] = {"n": len(cc), "cos_min": round(cc[0][0], 6) if cc else None,
               "cos_mean": round(float(np.mean([c for c, _ in cc])), 6) if cc else None,
               "worst": [(n, round(c, 6)) for c, n in cc[:3]], "one_side_missing": missing}

h2n_rs = {v["hash"]: n for n, v in rs["photos"].items()}
h2n_dj = {v["hash"]: n for n, v in dj["photos"].items()}
same = total = 0
jac = []
sdiff = []
for n in names:
    a, b = rs["photos"][n]["similar"], dj["photos"][n]["similar"]
    if a is None or b is None:
        continue
    sa = {h2n_rs.get(h, h) for h in a}
    sb = {h2n_dj.get(h, h) for h in b}
    total += 1
    same += sa == sb
    jac.append(len(sa & sb) / len(sa | sb) if sa | sb else 1.0)
    if sa != sb:
        sdiff.append((n, sorted(sa - sb), sorted(sb - sa)))
res["similar"] = {"identical_sets": f"{same}/{total}", "mean_jaccard": round(float(np.mean(jac)), 4) if jac else None,
                  "diffs": sdiff[:6]}
res["timing"] = {"rs": rs["timing"], "dj": dj["timing"]}
res["failed_jobs"] = {"rs": [j for j in rs["jobs"] if j[2]], "dj": [j for j in dj["jobs"] if j[2]]}
res["caption_status"] = {
    "rs": sorted({v["caption_status"] for v in rs["photos"].values()}),
    "dj": sorted({v["caption_status"] for v in dj["photos"].values()}),
}
print(json.dumps(res, indent=1, ensure_ascii=False, default=str))
