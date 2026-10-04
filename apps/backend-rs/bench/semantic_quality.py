"""Semantic-search quality of the stored embeddings of a kept ml_footprint run.

  python quality.py dump <db> <out.npz>        # stored clip_embeddings + file stems
  python quality.py eval <vit.npz> <mc.npz>    # 30 hand-labelled queries, P@10 / R@20 / MRR, thresholds

Ranking = raw inner product of the raw text embedding with the stored raw image
embeddings, exactly what the similarity index does.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

M = Path(r"C:\Users\Niaz\librephotos\rust-pg\ml\protected_media\data_models")
PSQL = r"C:\Users\Niaz\librephotos\rust-pg\pginstall\bin\psql.exe"

V = ["portrait_astronaut_big", "portrait_astronaut_bright", "portrait_astronaut_flip", "portrait_astronaut_orig",
     "portrait_astronaut_padded"]
H = ["portrait_hanks_big", "portrait_hanks_bright", "portrait_hanks_flip", "portrait_hanks_orig", "portrait_hanks_padded"]
G = ["group_t1_big", "group_t1_bright", "group_t1_flip", "group_t1_grey", "group_t1_left", "group_t1_orig",
     "group_t1_padded", "group_t1_right"]
SHAPES = ["admin_own_01", "IMG_20240301_120000_001", "IMG_20240301_120000_002", "IMG_20240301_120000_003",
          "IMG_20240301_120000_004", "dup_original", "dup_resized", "plain", "100% #1; semi", "Straße ☀ 東京",
          "DSC_0001", "Screenshot_20240115-093000", "xmp_photo", "manual_a", "manual_b", "hidden", "no_thumbnail",
          "no_timestamp", "trashed", "berlin_01", "berlin_02", "tokyo_01", "bob_own_01", "bob_own_02",
          "carol_own_01", "dave_own_01"]
QUERIES = {
    "a cat": ["scene_chelsea"],
    "a cup of coffee": ["scene_coffee"],
    "a horse": ["scene_horse"],
    "a rocket on a launch pad": ["scene_rocket"],
    "a red motorcycle": ["scene_motorcycle_left"],
    "an astronaut": V,
    "galaxies in deep space": ["scene_hubble_deep_field"],
    "the surface of the moon": ["scene_moon"],
    "old coins": ["scene_coins"],
    "a brick wall": ["scene_brick"],
    "grass": ["scene_grass"],
    "a flower": ["scene_flower"],
    "a chinese pagoda": ["scene_china"],
    "a man with a camera on a tripod": ["cameraman", "cameraman_flip"],
    "friends playing poker at a table": G,
    "a black and white portrait of a man": H,
    "a surgical face mask": ["mask_black", "mask_blue", "mask_green", "mask_white"],
    "a color wheel": ["scene_color"],
    "a photo of the retina of an eye": ["scene_retina"],
    "tissue under a microscope": ["scene_ihc"],
    "a logo": ["scene_logo"],
    "a green street sign": ["text_sign_900x500"],
    "a shopping receipt": ["text_receipt_720x1100"],
    "a printed document page": ["text_document_1240x1754", "text_big_2600x1800", "text_page"],
    "an event poster": ["text_poster_1400x900"],
    "handwritten notes": ["text_text"],
    "a blurry clock": ["scene_clock_motion"],
    "colorful abstract shapes": SHAPES,
    "opening hours": ["text_columns_1200x700"],
    "faded grey label text": ["text_lowcontrast_900x400"],
}


def psql(sql, db):
    r = subprocess.run([PSQL, "-h", "localhost", "-p", "5433", "-U", "postgres", "-X", "-q", "-At", "-d", db, "-c", sql],
                       capture_output=True, text=True, encoding="utf-8", check=True)
    return r.stdout


def dump(db, out):
    rows = psql("SELECT f.path, p.clip_embeddings::text FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id "
                "WHERE p.clip_embeddings IS NOT NULL ORDER BY p.image_hash", db).splitlines()
    stems, embs = [], []
    for line in rows:
        path, e = line.split("|", 1)
        stems.append(path.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0])
        e = json.loads(e)
        if isinstance(e, str):
            e = json.loads(e)
        embs.append(e)
    np.savez(out, stems=np.array(stems), embs=np.array(embs, dtype=np.float32))
    print(len(stems), "embeddings ->", out)


def text_embs(model, queries):
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    t = ort.InferenceSession(str(M / model / "text_model.onnx"), so)
    tok = Tokenizer.from_file(str(M / model / "tokenizer.json"))
    out = []
    for q in queries:
        ids = tok.encode(q).ids[:77]
        if model == "mobileclip_s2":
            ids = ids + [0] * (77 - len(ids))
        out.append(t.run(None, {t.get_inputs()[0].name: np.array([ids], dtype=np.int64)})[0][0])
    return np.array(out, dtype=np.float32)


def metrics(stems, embs, qembs):
    p10, r20, mrr = [], [], []
    for (q, rel), qe in zip(QUERIES.items(), qembs):
        rel = set(rel)
        missing = rel - set(stems)
        assert not missing, (q, missing)
        order = np.argsort(-(embs @ qe), kind="stable")
        ranked = [stems[i] for i in order]
        p10.append(sum(s in rel for s in ranked[:10]) / 10)
        r20.append(len(rel & set(ranked[:20])) / len(rel))
        first = next(i for i, s in enumerate(ranked) if s in rel)
        mrr.append(1 / (first + 1))
    return np.mean(p10), np.mean(r20), np.mean(mrr), p10, r20, mrr


def ev(vit_npz, mc_npz):
    res = {}
    qs = list(QUERIES)
    data = {}
    for name, f, model in [("clip_vit_b32", vit_npz, "clip_vit_b32"), ("mobileclip_s2", mc_npz, "mobileclip_s2")]:
        d = np.load(f)
        stems, embs = list(d["stems"]), d["embs"]
        qe = text_embs(model, qs)
        p, r, m, p10, r20, mrr = metrics(stems, embs, qe)
        # best achievable P@10 (number relevant capped at 10)
        ideal = np.mean([min(len(v), 10) / 10 for v in QUERIES.values()])
        data[name] = (stems, embs, qe)
        res[name] = {"photos": len(stems), "P@10": round(p, 3), "P@10_ideal": round(ideal, 3), "R@20": round(r, 3),
                     "MRR": round(m, 3), "per_query": {q: [a, b, round(c, 3)] for q, a, b, c in zip(qs, p10, r20, mrr)},
                     "img_norm_mean": round(float(np.linalg.norm(embs, axis=1).mean()), 3),
                     "text_norm_mean": round(float(np.linalg.norm(qe, axis=1).mean()), 3)}
    # Threshold calibration: same mean number of hits per query / similar photos per photo.
    stems, embs, qe = data["clip_vit_b32"]
    s_vit = qe @ embs.T
    hits_vit = (s_vit >= 27.0).sum(1).mean()
    sim_vit = embs @ embs.T
    simhits_vit = (sim_vit >= 90.0).sum(1).mean()
    stems2, embs2, qe2 = data["mobileclip_s2"]
    s_mc = qe2 @ embs2.T
    sim_mc = embs2 @ embs2.T
    def match(scores, target):
        cands = np.unique(np.round(scores.ravel(), 3))
        best = min(cands, key=lambda t: abs((scores >= t).sum(1).mean() - target))
        return float(best), float((scores >= best).sum(1).mean())
    t_search, h_mc = match(s_mc, hits_vit)
    t_sim, sh_mc = match(sim_mc, simhits_vit)
    def thr_prec(scores, stems, t):
        ps, rs = [], []
        for (q, rel), row in zip(QUERIES.items(), scores):
            got = [stems[i] for i in np.where(row >= t)[0]]
            if got:
                ps.append(sum(g in rel for g in got) / len(got))
            rs.append(sum(g in rel for g in got) / len(rel))
        return round(float(np.mean(ps)) if ps else 0.0, 3), round(float(np.mean(rs)), 3)
    res["calibration"] = {
        "vit_search_27_mean_hits": round(float(hits_vit), 2), "mc_search_threshold": t_search,
        "mc_mean_hits": round(h_mc, 2),
        "vit_similar_90_mean_hits": round(float(simhits_vit), 2), "mc_similar_threshold": t_sim,
        "mc_similar_mean_hits": round(sh_mc, 2),
        "vit_thresholded_precision_recall": thr_prec(s_vit, stems, 27.0),
        "mc_thresholded_precision_recall": thr_prec(s_mc, stems2, t_search),
        # similar-photo pairs that are variants of the same source (same family) at the cut
    }
    def fam(s):
        for pre in ("portrait_astronaut", "portrait_hanks", "group_t1", "cameraman", "mask_", "e2e_", "card_", "dup_"):
            if s.startswith(pre):
                return pre
        return s
    def sim_quality(sim, stems, t):
        good = tot = 0
        for i in range(len(stems)):
            for j in np.where(sim[i] >= t)[0]:
                if j == i:
                    continue
                tot += 1
                good += fam(stems[i]) == fam(stems[j])
        return tot, good
    res["calibration"]["vit_similar_pairs_same_family"] = sim_quality(sim_vit, stems, 90.0)
    res["calibration"]["mc_similar_pairs_same_family"] = sim_quality(sim_mc, stems2, t_sim)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "per_query"} for k, v in res.items()}, indent=1))
    Path("quality.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    if sys.argv[1] == "dump":
        dump(sys.argv[2], sys.argv[3])
    else:
        ev(sys.argv[2], sys.argv[3])
