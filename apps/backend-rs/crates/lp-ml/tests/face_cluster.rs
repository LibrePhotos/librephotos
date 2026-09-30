//! The in-process face_cluster service against the Python sidecar's goldens
//! (`tests/ml/golden_face_cluster.py`): HDBSCAN labels (adjusted Rand
//! index), the MLPClassifier fits (RNG, iterations, probabilities), `/train`
//! predictions and held-out accuracy, PCA coordinates. Skips without goldens.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use lp_ml::face_cluster::mlp::{Mlp, Mt19937};
use lp_ml::golden::{self, Array, Case};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{
    ClusterFace, ClusterRequest, FacePrediction, LabelledEncoding, SidecarError, Sidecars,
    TrainRequest,
};
use ndarray::Array2;
use serde_json::Value;

fn ml() -> Ml {
    let ml = Ml::new(
        MlConfig::new(std::env::temp_dir()),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    );
    ml.set_mode(Service::FaceCluster, Mode::InProcess);
    ml
}

fn sidecars() -> Sidecars {
    Sidecars::new(reqwest::Client::new(), "127.0.0.1")
}

fn rows(v: &Value) -> Vec<Vec<f64>> {
    if v.is_null() {
        return Vec::new();
    }
    let a = Array::from_json(v);
    assert_eq!(a.dtype, "float64");
    let d = if a.shape.len() > 1 { a.shape[1] } else { 1 };
    let flat: Vec<f64> = a
        .bytes
        .chunks_exact(8)
        .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
        .collect();
    if d == 0 {
        return vec![Vec::new(); a.shape[0]];
    }
    flat.chunks(d).map(<[f64]>::to_vec).collect()
}

fn matrix(v: &Value) -> Array2<f64> {
    let r = rows(v);
    let d = r.first().map_or(0, Vec::len);
    Array2::from_shape_vec((r.len(), d), r.concat()).unwrap()
}

fn hex(v: &[f64]) -> String {
    v.iter()
        .flat_map(|x| x.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn ints(v: &Value) -> Vec<i64> {
    v.as_array()
        .map(|a| a.iter().map(|x| x.as_i64().unwrap()).collect())
        .unwrap_or_default()
}

/// Adjusted Rand index (Hubert & Arabie), noise (-1) counted as one label
/// like sklearn's `adjusted_rand_score` does.
fn ari(a: &[i64], b: &[i64]) -> f64 {
    let n = a.len() as f64;
    let comb = |x: f64| x * (x - 1.0) / 2.0;
    let mut table: HashMap<(i64, i64), f64> = HashMap::new();
    let mut ra: HashMap<i64, f64> = HashMap::new();
    let mut rb: HashMap<i64, f64> = HashMap::new();
    for (x, y) in a.iter().zip(b) {
        *table.entry((*x, *y)).or_default() += 1.0;
        *ra.entry(*x).or_default() += 1.0;
        *rb.entry(*y).or_default() += 1.0;
    }
    let index: f64 = table.values().map(|v| comb(*v)).sum();
    let sa: f64 = ra.values().map(|v| comb(*v)).sum();
    let sb: f64 = rb.values().map(|v| comb(*v)).sum();
    let expected = sa * sb / comb(n);
    let max = (sa + sb) / 2.0;
    if max == expected {
        return 1.0;
    }
    (index - expected) / (max - expected)
}

/// The cases of every golden file present (the main set, then the
/// `<name>_edge` set: non-finite input, 5k faces, hard splits).
fn cases(name: &str) -> Vec<Case> {
    [name.to_string(), format!("{name}_edge")]
        .iter()
        .filter_map(|n| golden::load("face_cluster", n))
        .flat_map(|g| g.cases)
        .collect()
}

fn error_detail(e: SidecarError) -> String {
    match e {
        SidecarError::Status { detail, .. } => detail,
        other => panic!("not a fit error: {other}"),
    }
}

async fn cluster_case(ml: &Ml, c: &Case) -> Result<Vec<i64>, String> {
    let enc = rows(&c.input["encodings"]);
    let req = ClusterRequest {
        faces: enc
            .iter()
            .enumerate()
            .map(|(i, e)| ClusterFace {
                id: i as i32 + 1,
                encoding: hex(e),
            })
            .collect(),
        min_cluster_size: c.input["min_cluster_size"].as_i64().unwrap() as i32,
        min_samples: c.input["min_samples"].as_i64().unwrap() as i32,
        cluster_selection_epsilon: c.input["cluster_selection_epsilon"].as_f64().unwrap(),
    };
    let sc = sidecars();
    match ml.view(&sc).face_cluster().cluster(&req).await {
        Ok(r) => {
            assert_eq!(r.ids, (1..=enc.len() as i32).collect::<Vec<_>>());
            Ok(r.labels)
        }
        Err(e) => Err(error_detail(e)),
    }
}

#[tokio::test]
async fn hdbscan_matches_python() {
    let cases = cases("cluster");
    let ml = ml();
    let mut worst: f64 = 1.0;
    for c in &cases {
        let t = Instant::now();
        let ours = cluster_case(&ml, c).await;
        let secs = t.elapsed().as_secs_f64();
        if c.output["status"] != 200 {
            assert_eq!(
                ours.unwrap_err(),
                c.output["error"].as_str().unwrap(),
                "{}",
                c.id
            );
            continue;
        }
        let ours = ours.unwrap_or_else(|e| panic!("{}: {e}", c.id));
        let want = ints(&c.output["labels"]);
        let truth = ints(&c.input["truth"]);
        let same = ours.iter().zip(&want).filter(|(a, b)| a == b).count();
        let score = ari(&ours, &want);
        worst = worst.min(score);
        eprintln!(
            "{:<28} n={:<5} ARI(rust, python)={score:.4} identical={same}/{} ARI vs truth: rust {:.3} python {:.3} ({secs:.2}s)",
            c.id,
            want.len(),
            want.len(),
            ari(&ours, &truth),
            ari(&want, &truth),
        );
        assert!(score >= 0.9, "{}: ARI {score}", c.id);
    }
    eprintln!("worst ARI {worst:.4}");
}

#[test]
fn numpy_random_state() {
    let Some(g) = golden::load("face_cluster", "mlp") else {
        return;
    };
    let c = g.cases.iter().find(|c| c.id == "rng").unwrap();
    let want = Array::from_json(&c.output["uniform"]);
    let want: Vec<f64> = want
        .bytes
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
        .collect();
    let mut r = Mt19937::new(1);
    let ours: Vec<f64> = (0..want.len()).map(|_| r.uniform(-0.1, 0.1)).collect();
    assert_eq!(ours, want, "uniform draws are bit-identical");
    // `permutation(n)` = shuffle(arange(n)).
    let mut p: Vec<i64> = (0..1000).collect();
    r.shuffle(&mut p);
    assert_eq!(p, ints(&c.output["shuffle_1000"]));
}

#[test]
fn mlp_matches_sklearn() {
    let Some(g) = golden::load("face_cluster", "mlp") else {
        return;
    };
    for c in g.cases.iter().filter(|c| c.id != "rng") {
        let x = matrix(&c.input["x"]);
        let y = ints(&c.input["y"]);
        let t = Instant::now();
        let m = Mlp::fit(x.view(), &y).unwrap();
        let secs = t.elapsed().as_secs_f64();
        assert_eq!(m.classes, ints(&c.output["classes"]), "{}", c.id);
        let p = m.predict_proba(matrix(&c.input["x_test"]).view());
        let want = matrix(&c.output["proba"]);
        assert_eq!(p.dim(), want.dim(), "{}", c.id);
        let diff = p
            .iter()
            .zip(want.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max);
        let argmax_same = p
            .rows()
            .into_iter()
            .zip(want.rows())
            .filter(|(a, b)| argmax(a.as_slice().unwrap()) == argmax(b.as_slice().unwrap()))
            .count();
        let n_iter = c.output["n_iter"].as_u64().unwrap() as usize;
        eprintln!(
            "mlp {:<8} n_iter rust {} sklearn {n_iter}, max |dp| {diff:.2e}, argmax same {argmax_same}/{} ({secs:.2}s)",
            c.id,
            m.n_iter,
            p.nrows()
        );
        assert!(m.n_iter.abs_diff(n_iter) <= 2, "{}", c.id);
        assert!(diff < 1e-4, "{}: {diff}", c.id);
        assert_eq!(argmax_same, p.nrows(), "{}", c.id);
    }
}

fn argmax(v: &[f64]) -> usize {
    let mut best = 0;
    for (i, x) in v.iter().enumerate() {
        if *x > v[best] {
            best = i;
        }
    }
    best
}

fn labelled(ids: &Value, enc: &Value) -> Vec<LabelledEncoding> {
    ints(ids)
        .into_iter()
        .zip(rows(enc))
        .map(|(p, e)| LabelledEncoding {
            person_id: p as i32,
            encoding: hex(&e),
        })
        .collect()
}

#[tokio::test]
async fn train_matches_sidecar() {
    let cases = cases("train");
    let ml = ml();
    let sc = sidecars();
    for c in &cases {
        let i = &c.input;
        let req = TrainRequest {
            known: labelled(&i["known"]["ids"], &i["known"]["encodings"]),
            clusters: labelled(&i["clusters"]["ids"], &i["clusters"]["encodings"]),
            unknown: ints(&i["unknown"]["ids"])
                .into_iter()
                .zip(rows(&i["unknown"]["encodings"]))
                .map(|(id, e)| ClusterFace {
                    id: id as i32,
                    encoding: hex(&e),
                })
                .collect(),
        };
        let t = Instant::now();
        let res = ml.view(&sc).face_cluster().train(&req).await;
        let secs = t.elapsed().as_secs_f64();
        if c.output["status"] != 200 {
            assert_eq!(
                error_detail(res.unwrap_err()),
                c.output["error"].as_str().unwrap(),
                "{}",
                c.id
            );
            continue;
        }
        let ours = res.unwrap_or_else(|e| panic!("{}: {e}", c.id)).predictions;
        let want: Vec<FacePrediction> =
            serde_json::from_value(c.output["predictions"].clone()).unwrap();
        assert_eq!(ours.len(), want.len(), "{}", c.id);
        let mut same_cluster = 0;
        let mut same_class = 0;
        let mut dp: f64 = 0.0;
        for (a, b) in ours.iter().zip(&want) {
            assert_eq!(a.id, b.id);
            same_cluster += usize::from(a.cluster_person_id == b.cluster_person_id);
            same_class += usize::from(a.classification_person_id == b.classification_person_id);
            dp = dp
                .max((a.cluster_probability - b.cluster_probability).abs())
                .max((a.classification_probability - b.classification_probability).abs());
        }
        let truth: HashMap<i32, i32> = c.input["truth"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.parse().unwrap(), v.as_i64().unwrap() as i32))
            .collect();
        let hits: Vec<bool> = ours
            .iter()
            .filter_map(|p| {
                truth
                    .get(&p.id)
                    .map(|t| p.classification_person_id == Some(*t))
            })
            .collect();
        let acc = (!hits.is_empty())
            .then(|| hits.iter().filter(|h| **h).count() as f64 / hits.len() as f64);
        let py_acc = c.output["accuracy"].as_f64();
        eprintln!(
            "train {:<26} n={:<5} cluster person same {same_cluster}/{n} classification same {same_class}/{n} max |dp| {dp:.2e} accuracy rust {acc:?} sklearn {py_acc:?} ({secs:.2}s, python {:.2}s)",
            c.id,
            want.len(),
            c.output["seconds"].as_f64().unwrap_or(0.0),
            n = want.len(),
        );
        if let (Some(a), Some(b)) = (acc, py_acc) {
            assert!((a - b).abs() <= 0.02, "{}: accuracy {a} vs {b}", c.id);
        }
        assert!(
            same_cluster as f64 >= 0.99 * want.len() as f64,
            "{}: {same_cluster}/{}",
            c.id,
            want.len()
        );
    }
}

#[tokio::test]
async fn pca_matches_sklearn() {
    let cases = cases("pca");
    let ml = ml();
    let sc = sidecars();
    for c in &cases {
        let enc: Vec<String> = rows(&c.input["x"]).iter().map(|r| hex(r)).collect();
        let res = ml.view(&sc).face_cluster().pca(&enc).await;
        if let Some(err) = c.output["error"].as_str() {
            assert_eq!(error_detail(res.unwrap_err()), err, "{}", c.id);
            continue;
        }
        let ours = res.unwrap();
        let want = rows(&c.output["coordinates"]);
        let scale = want
            .iter()
            .flatten()
            .fold(0.0f64, |m, v| m.max(v.abs()))
            .max(1e-12);
        let per_comp: Vec<f64> = (0..3)
            .map(|k| {
                ours.iter()
                    .zip(&want)
                    .map(|(a, b)| (a[k] - b[k]).abs())
                    .fold(0.0f64, f64::max)
            })
            .collect();
        // Variance captured per component: exact eigenvectors capture at
        // least as much as sklearn's randomized SVD (used below 10x more
        // samples than features), which is itself approximate and unseeded.
        let var = |m: &dyn Fn(usize) -> f64| (0..want.len()).map(m).map(|v| v * v).sum::<f64>();
        let ours_var: Vec<f64> = (0..3).map(|k| var(&|i| ours[i][k])).collect();
        let want_var: Vec<f64> = (0..3).map(|k| var(&|i| want[i][k])).collect();
        eprintln!(
            "pca {:<16} n={} max |d| per component {per_comp:?} (scale {scale:.3}), variance rust {ours_var:.6?} sklearn {want_var:.6?}",
            c.id,
            want.len()
        );
        let exact_solver = want.len() >= 10 * 512;
        let tol = 1e-6 * scale;
        if exact_solver {
            assert!(per_comp.iter().all(|d| *d <= tol), "{}: {per_comp:?}", c.id);
        } else {
            for k in 0..3 {
                let (o, w): (f64, f64) = (ours_var[..=k].iter().sum(), want_var[..=k].iter().sum());
                assert!(o >= w * (1.0 - 1e-9), "{}: top {} {o} < {w}", c.id, k + 1);
            }
        }
    }
}
