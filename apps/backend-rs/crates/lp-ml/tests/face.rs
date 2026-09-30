//! In-process faces against the Python sidecar's goldens
//! (`tests/ml/golden_face.py`): boxes, landmarks, the aligned crop and the
//! embeddings per face pack, `/face-encodings` matching, and the error path.
//! Skipped without goldens, models or `LP_ORT_LIB`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use lp_ml::face::{self, FacePack, Want};
use lp_ml::golden::{self, Array};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{FaceBox, SidecarError, Sidecars};
use serde_json::Value;

fn runtime() -> bool {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return false;
    }
    lp_ml::runtime::init().expect("ONNX Runtime loads");
    true
}

fn pack_dir(model: &str) -> Option<PathBuf> {
    let d = golden::data_models()
        .join("face_recognition/models")
        .join(model);
    if !d.is_dir() {
        eprintln!("{} missing; skipping", d.display());
        return None;
    }
    Some(d)
}

fn bbox4(v: &[f32]) -> [f64; 4] {
    [v[0] as f64, v[1] as f64, v[2] as f64, v[3] as f64]
}

fn loc(v: &Value) -> FaceBox {
    let a: Vec<i32> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_i64().unwrap() as i32)
        .collect();
    [a[0], a[1], a[2], a[3]]
}

#[derive(Default, Debug)]
struct Stats {
    faces: usize,
    exact_locations: usize,
    min_iou: f64,
    max_bbox_diff: f32,
    max_kps_diff: f32,
    crops_identical: usize,
    max_crop_diff: u8,
    min_cosine: f64,
    /// Over PNG / WebP inputs (decoded bit-identically to Pillow).
    min_cosine_lossless: f64,
    max_crop_diff_lossless: u8,
    min_cosine_same_crop: f64,
    /// Embeddings of Python's own crop that are bit-identical.
    same_crop_identical: usize,
}

fn check_model(model: &str) {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", model) else {
        return;
    };
    let Some(dir) = pack_dir(model) else {
        return;
    };
    let mut pack = FacePack::load(&dir).expect("face pack loads");
    let mut st = Stats {
        min_iou: 1.0,
        min_cosine: 1.0,
        min_cosine_lossless: 1.0,
        min_cosine_same_crop: 1.0,
        ..Default::default()
    };
    for c in &g.cases {
        let src = Path::new(c.input["source"].as_str().unwrap());
        let image = lp_ml::preprocess::load_rgb(src).expect("decodes");
        let faces = pack.analyze(&image, Want::All).expect("analyze");
        let lossless = !c.id.to_ascii_lowercase().ends_with(".jpg");
        let want = c.output["faces"].as_array().unwrap();
        let want_locs: Vec<FaceBox> = c.output["face_locations"]
            .as_array()
            .unwrap()
            .iter()
            .map(loc)
            .collect();
        assert_eq!(
            faces.len(),
            want.len(),
            "{model} {}: face count (rust {:?} vs python {:?})",
            c.id,
            faces.iter().map(|f| f.location).collect::<Vec<_>>(),
            want_locs
        );
        for (i, w) in want.iter().enumerate() {
            st.faces += 1;
            let wb = Array::from_json(&w["bbox"]).f32();
            // Same order as Python; fall back to the best overlap if two
            // scores tie differently.
            let (j, iou) = faces
                .iter()
                .enumerate()
                .map(|(j, f)| (j, golden::iou(bbox4(&f.detection.bbox), bbox4(&wb))))
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap();
            assert_eq!(j, i, "{model} {}: face order", c.id);
            let f = &faces[j];
            assert!(iou >= 0.95, "{model} {} face {i}: box IoU {iou}", c.id);
            st.min_iou = st.min_iou.min(iou);
            st.max_bbox_diff = st
                .max_bbox_diff
                .max(golden::max_abs_diff(&f.detection.bbox, &wb));
            if f.location == want_locs[i] {
                st.exact_locations += 1;
            }
            let kps: Vec<f32> = f.detection.kps.unwrap().iter().flatten().copied().collect();
            st.max_kps_diff = st.max_kps_diff.max(golden::max_abs_diff(
                &kps,
                &Array::from_json(&w["kps"]).f32(),
            ));

            let crop = pack.align(&image, &f.detection).unwrap();
            let want_crop = Array::from_json(&w["crop"]);
            let (d, n) = golden::u8_diff(&crop, want_crop.u8());
            if n == 0 {
                st.crops_identical += 1;
            }
            st.max_crop_diff = st.max_crop_diff.max(d);

            let want_emb = Array::from_json(&w["embedding"]).f32();
            let emb = f.embedding.as_ref().unwrap();
            let cos = golden::cosine(emb, &want_emb);
            assert!(cos >= 0.99, "{model} {} face {i}: cosine {cos}", c.id);
            st.min_cosine = st.min_cosine.min(cos);
            if lossless {
                st.min_cosine_lossless = st.min_cosine_lossless.min(cos);
                st.max_crop_diff_lossless = st.max_crop_diff_lossless.max(d);
            }
            // The recogniser alone, on Python's own crop (ours when equal).
            let same = if n == 0 {
                emb.clone()
            } else {
                pack.recognizer.embed(want_crop.u8()).unwrap()
            };
            st.min_cosine_same_crop = st
                .min_cosine_same_crop
                .min(golden::cosine(&same, &want_emb));
            if same == want_emb {
                st.same_crop_identical += 1;
            }
            // The reply's encodings are the same numbers.
            let reply = Array::from_json(&c.output["encodings"][i]).f32();
            assert_eq!(reply, want_emb);
        }
    }
    eprintln!("{model}: {st:?}");
    assert!(st.min_cosine_same_crop > 0.99999, "{model}: {st:?}");
    assert!(st.min_cosine_lossless >= 0.999, "{model}: {st:?}");
}

#[test]
fn buffalo_sc_matches_python() {
    check_model("buffalo_sc");
}

#[test]
fn buffalo_l_matches_python() {
    check_model("buffalo_l");
}

#[test]
fn buffalo_s_matches_python() {
    check_model("buffalo_s");
}

#[test]
fn buffalo_m_matches_python() {
    check_model("buffalo_m");
}

#[test]
fn antelopev2_matches_python() {
    check_model("antelopev2");
}

fn ml() -> Ml {
    let ml = Ml::new(
        MlConfig::new(golden::ml_root().join("protected_media")),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    );
    ml.set_mode(Service::Face, Mode::InProcess);
    ml
}

#[tokio::test]
async fn face_encodings_match_python() {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", "encodings") else {
        return;
    };
    if pack_dir("buffalo_sc").is_none() {
        return;
    }
    let ml = ml();
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let api = ml.view(&sidecars).face();
    let mut compared = 0;
    for c in &g.cases {
        let locations: Vec<FaceBox> = c.input["face_locations"]
            .as_array()
            .unwrap()
            .iter()
            .map(loc)
            .collect();
        let got = api
            .face_encodings(
                c.input["source"].as_str().unwrap(),
                &locations,
                c.input["model_name"].as_str().unwrap(),
            )
            .await
            .expect("face_encodings");
        let want = c.output["encodings"].as_array().unwrap();
        assert_eq!(got.len(), want.len(), "{}", c.id);
        for (k, (g, w)) in got.iter().zip(want).enumerate() {
            match (g, w.is_null()) {
                (None, true) => {}
                (Some(g), false) => {
                    let g: Vec<f32> = g.iter().map(|v| *v as f32).collect();
                    golden::assert_cosine(
                        &g,
                        &Array::from_json(w).f32(),
                        0.99,
                        &format!("{} #{k}", c.id),
                    );
                    compared += 1;
                }
                _ => panic!(
                    "{} #{k}: matched {} vs python {}",
                    c.id,
                    g.is_some(),
                    !w.is_null()
                ),
            }
        }
    }
    eprintln!(
        "face_encodings: {} cases, {compared} embeddings",
        g.cases.len()
    );
}

#[tokio::test]
async fn detect_faces_through_the_api() {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", "buffalo_sc") else {
        return;
    };
    if pack_dir("buffalo_sc").is_none() {
        return;
    }
    let ml = ml();
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let api = ml.view(&sidecars).face();
    let c = g.cases.iter().find(|c| c.id.ends_with("t1.jpg")).unwrap();
    // An unknown model name is served by buffalo_sc, like the sidecar.
    let got = api
        .detect_faces(c.input["source"].as_str().unwrap(), "no-such-pack")
        .await
        .unwrap();
    let want: Vec<FaceBox> = c.output["face_locations"]
        .as_array()
        .unwrap()
        .iter()
        .map(loc)
        .collect();
    assert_eq!(got.len(), want.len());
    for (f, w) in got.iter().zip(&want) {
        let to = |b: &FaceBox| b.map(f64::from);
        assert!(golden::iou_trbl(to(&f.location), to(w)) >= 0.95);
        assert_eq!(f.encoding.as_ref().map(Vec::len), Some(512));
    }
    assert_eq!(ml.loaded_models(Service::Face).len(), 1);

    // A missing file is the sidecar's 500.
    let err = api
        .detect_faces("C:/definitely/missing.jpg", "buffalo_sc")
        .await
        .unwrap_err();
    assert!(
        matches!(err, SidecarError::Status { status: 500, .. }),
        "{err:?}"
    );
    // A pack that is not installed looks like a stopped sidecar.
    let dir = tempfile::tempdir().unwrap();
    let empty = Ml::new(
        MlConfig::new(dir.path().to_path_buf()),
        Arc::new(Selection::default),
    );
    empty.set_mode(Service::Face, Mode::InProcess);
    let err = empty
        .view(&sidecars)
        .face()
        .detect_faces(c.input["source"].as_str().unwrap(), "buffalo_sc")
        .await
        .unwrap_err();
    assert!(matches!(err, SidecarError::Unreachable { .. }), "{err:?}");
}

#[test]
fn model_routing_follows_insightface() {
    let Some(dir) = pack_dir("buffalo_l") else {
        return;
    };
    let tasks: Vec<(String, usize, Vec<String>)> =
        ["det_10g.onnx", "w600k_r50.onnx", "2d106det.onnx"]
            .iter()
            .map(|f| {
                let i = face::onnx_meta::read(&dir.join(f)).unwrap();
                (f.to_string(), i.outputs, i.first_nodes)
            })
            .collect();
    assert_eq!(tasks[0].1, 9);
    assert_eq!(tasks[1].1, 1);
    assert_eq!(tasks[2].2[..2], ["_minusscalar0", "_mulscalar0"]);
    let rec = face::onnx_meta::read(&dir.join("w600k_r50.onnx")).unwrap();
    assert_eq!(rec.input_dim(2), Some(112));
    assert_eq!(rec.input_dim(3), Some(112));
    let det = face::onnx_meta::read(&dir.join("det_10g.onnx")).unwrap();
    assert_eq!(det.input_dim(2), None);
}

/// The lossy WebP thumbnails of the faces.scan end-to-end test.
#[test]
fn e2e_thumbnails_match_python() {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", "e2e") else {
        return;
    };
    let Some(dir) = pack_dir("buffalo_sc") else {
        return;
    };
    let mut pack = FacePack::load(&dir).expect("face pack loads");
    let mut min_cos = 1.0f64;
    for c in &g.cases {
        let image = lp_ml::preprocess::load_rgb(Path::new(c.input["source"].as_str().unwrap()))
            .expect("decodes");
        let faces = pack.analyze(&image, Want::All).expect("analyze");
        let want: Vec<FaceBox> = c.output["face_locations"]
            .as_array()
            .unwrap()
            .iter()
            .map(loc)
            .collect();
        let got: Vec<FaceBox> = faces.iter().map(|f| f.location).collect();
        assert_eq!(got, want, "{}", c.id);
        for (i, f) in faces.iter().enumerate() {
            let w = Array::from_json(&c.output["encodings"][i]).f32();
            min_cos = min_cos.min(golden::cosine(f.embedding.as_ref().unwrap(), &w));
        }
    }
    eprintln!("e2e thumbnails: min cosine {min_cos}");
    assert!(min_cos >= 0.999);
}

/// t1.jpg in other modes, bit depths and containers, and the inputs the
/// sidecar answers with a 500 (`golden_face.py --edge`).
#[tokio::test]
async fn odd_inputs_match_python() {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", "edge") else {
        return;
    };
    if pack_dir("buffalo_sc").is_none() {
        return;
    }
    let ml = ml();
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let api = ml.view(&sidecars).face();
    let mut min_cos = 1.0f64;
    for c in &g.cases {
        let got = api
            .detect_faces(c.input["source"].as_str().unwrap(), "buffalo_sc")
            .await;
        let status = c.output["status"].as_i64().unwrap();
        if status != 200 {
            assert!(
                matches!(got, Err(SidecarError::Status { status: 500, .. })),
                "{}: python {status}, rust {got:?}",
                c.id
            );
            continue;
        }
        let got = got.unwrap_or_else(|e| panic!("{}: {e:?}", c.id));
        let want: Vec<FaceBox> = c.output["face_locations"]
            .as_array()
            .unwrap()
            .iter()
            .map(loc)
            .collect();
        assert_eq!(got.len(), want.len(), "{}: {got:?} vs {want:?}", c.id);
        let (mut case_iou, mut case_cos) = (1.0f64, 1.0f64);
        for (i, (f, w)) in got.iter().zip(&want).enumerate() {
            let to = |b: &FaceBox| b.map(f64::from);
            let iou = golden::iou_trbl(to(&f.location), to(w));
            assert!(iou >= 0.95, "{} face {i}: IoU {iou}", c.id);
            let e: Vec<f32> = f
                .encoding
                .as_ref()
                .unwrap()
                .iter()
                .map(|v| *v as f32)
                .collect();
            let cos = golden::cosine(&e, &Array::from_json(&c.output["encodings"][i]).f32());
            assert!(cos >= 0.99, "{} face {i}: cosine {cos}", c.id);
            min_cos = min_cos.min(cos);
            case_iou = case_iou.min(iou);
            case_cos = case_cos.min(cos);
        }
        eprintln!(
            "{}: {} faces, min IoU {case_iou:.4}, min cosine {case_cos:.6}",
            c.id,
            got.len()
        );
    }
    eprintln!("odd inputs: {} cases, min cosine {min_cos}", g.cases.len());
}

/// Parallel calls through a two-copy pool answer exactly what one call does,
/// keep at most two packs in memory, and unload cleanly afterwards.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_calls_agree() {
    if !runtime() {
        return;
    }
    let Some(g) = golden::load("face", "encodings") else {
        return;
    };
    if pack_dir("buffalo_sc").is_none() {
        return;
    }
    let sources: Vec<String> = g
        .cases
        .iter()
        .map(|c| c.input["source"].as_str().unwrap().to_string())
        .filter(|s| s.ends_with("t1.jpg") || s.ends_with("t1_small_320.png"))
        .collect();
    assert!(!sources.is_empty());
    let mut config = MlConfig::new(golden::ml_root().join("protected_media"));
    config.concurrency.insert(Service::Face, 2);
    let ml = Arc::new(Ml::new(
        config,
        Arc::new(|| Selection {
            face_recognition_model: "buffalo_sc".into(),
            ..Selection::default()
        }),
    ));
    ml.set_mode(Service::Face, Mode::InProcess);
    let sidecars = Arc::new(Sidecars::new(reqwest::Client::new(), "127.0.0.1"));
    let mut want = Vec::new();
    for s in &sources {
        want.push(
            ml.view(&sidecars)
                .face()
                .detect_faces(s, "buffalo_sc")
                .await
                .unwrap(),
        );
    }
    let mut calls = tokio::task::JoinSet::new();
    for round in 0..3 {
        for (i, s) in sources.iter().enumerate() {
            let (ml, sidecars, s) = (ml.clone(), sidecars.clone(), s.clone());
            calls.spawn(async move {
                let got = ml
                    .view(&sidecars)
                    .face()
                    .detect_faces(&s, "buffalo_sc")
                    .await;
                (round, i, got)
            });
        }
    }
    while let Some(r) = calls.join_next().await {
        let (round, i, got) = r.unwrap();
        let got = got.unwrap();
        assert_eq!(got.len(), want[i].len(), "round {round} {}", sources[i]);
        for (a, b) in got.iter().zip(&want[i]) {
            assert_eq!(a.location, b.location);
            assert_eq!(a.encoding, b.encoding, "round {round} {}", sources[i]);
        }
    }
    let loaded = ml.loaded_models(Service::Face);
    assert!(
        loaded.len() == 1 && (1..=2).contains(&loaded[0].1),
        "{loaded:?}"
    );
    assert!(ml.unload(Service::Face));
    assert!(ml.loaded_models(Service::Face).is_empty());
}

/// A half-copied or incomplete pack is an error, never a panic, and macOS
/// `._*` resource-fork copies next to the models are ignored like
/// insightface's `glob("*.onnx")` does.
#[test]
fn broken_packs_fail_cleanly() {
    if !runtime() {
        return;
    }
    let Some(src) = pack_dir("buffalo_sc") else {
        return;
    };
    let det = std::fs::read(src.join("det_500m.onnx")).unwrap();
    let rec = std::fs::read(src.join("w600k_mbf.onnx")).unwrap();
    let load = |files: &[(&str, &[u8])]| {
        let dir = tempfile::tempdir().unwrap();
        for (name, bytes) in files {
            std::fs::write(dir.path().join(name), bytes).unwrap();
        }
        FacePack::load(dir.path()).map(|_| ())
    };

    let err = load(&[("det_500m.onnx", &det)]).unwrap_err();
    assert!(
        format!("{err:#}").contains("no recognition model"),
        "{err:#}"
    );
    assert!(
        load(&[
            ("det_500m.onnx", &det),
            ("w600k_mbf.onnx", &rec[..rec.len() / 2])
        ])
        .is_err()
    );
    assert!(load(&[("det_500m.onnx", &det[..1000]), ("w600k_mbf.onnx", &rec)]).is_err());
    assert!(load(&[("det_500m.onnx", b"not a model"), ("w600k_mbf.onnx", &rec)]).is_err());
    // "._det_500m.onnx" sorts first and would be read (and fail) otherwise.
    load(&[
        ("._det_500m.onnx", b"\x00\x05\x16\x07 AppleDouble"),
        ("det_500m.onnx", &det),
        ("w600k_mbf.onnx", &rec),
    ])
    .unwrap();
}
