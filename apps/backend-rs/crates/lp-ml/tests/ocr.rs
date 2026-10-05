//! PP-OCRv6 port vs the Python sidecar code (`tests/ml/golden_ocr.py`).
//!
//! `geometry`: the cv2 / pyclipper primitives on seeded random inputs,
//! expected bit-exact. `pipeline_<tier>`: decode, detection boxes, crops,
//! recognition and the final answer per image (needs `LP_ORT_LIB` and the
//! bundles). Run with `--nocapture` for the parity numbers.

use std::path::Path;

use lp_ml::golden::{self, Array};
use lp_ml::ocr::ppocr::{
    self, Engine, Image3, Options, Quad, contours, decode, hull, hull::Pts, poly, warp,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn f32_quad(a: &Array) -> [[f32; 2]; 4] {
    let v = a.f32();
    [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]]
}

fn points_i32(a: &Array) -> Vec<[i32; 2]> {
    a.i64()
        .chunks_exact(2)
        .map(|p| [p[0] as i32, p[1] as i32])
        .collect()
}

fn image3(a: &Array) -> Image3 {
    Image3 {
        w: a.shape[1],
        h: a.shape[0],
        data: a.u8().to_vec(),
    }
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The pipeline keeps RGB; the goldens hash cv2's BGR.
fn bgr(img: &Image3) -> Vec<u8> {
    let mut out = img.data.clone();
    for px in out.chunks_exact_mut(3) {
        px.swap(0, 2);
    }
    out
}

#[test]
fn geometry_matches_opencv_and_pyclipper() {
    let Some(g) = golden::load("ocr", "geometry") else {
        return;
    };
    let (mut contour_sets, mut minis, mut scores, mut unclips, mut crops, mut norms) =
        (0, 0, 0, 0, 0, 0);
    let mut fails: Vec<String> = Vec::new();
    for c in &g.cases {
        let kind = c.input["kind"].as_str().unwrap();
        match kind {
            "contours" => {
                let bm = Array::from_json(&c.input["bitmap"]);
                let (h, w) = (bm.shape[0], bm.shape[1]);
                let ours = contours::find_contours(bm.u8(), w, h);
                let want: Vec<Vec<[i32; 2]>> = c.output["contours"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| points_i32(&Array::from_json(a)))
                    .collect();
                if ours != want {
                    fails.push(format!(
                        "{}: contours differ ({} vs {})",
                        c.id,
                        ours.len(),
                        want.len()
                    ));
                    continue;
                }
                contour_sets += 1;
                for (contour, m) in ours.iter().zip(c.output["mini"].as_array().unwrap()) {
                    let (quad, sside) = hull::get_mini_boxes(&Pts::Int(contour));
                    let want_q = f32_quad(&Array::from_json(&m["box"]));
                    let want_s = m["sside"].as_f64().unwrap() as f32;
                    if quad != want_q || sside != want_s {
                        let r = hull::min_area_rect(&Pts::Int(contour));
                        fails.push(format!(
                            "{}: mini box {quad:?}/{sside} vs {want_q:?}/{want_s}; rect {r:?} vs {}",
                            c.id, m["rect"]
                        ));
                    } else {
                        minis += 1;
                    }
                }
            }
            "score" => {
                let prob = Array::from_json(&c.input["prob"]);
                let quad = f32_quad(&Array::from_json(&c.input["box"]));
                let s = poly::box_score_fast(&prob.f32(), prob.shape[1], prob.shape[0], &quad);
                let want = c.output["score"].as_f64().unwrap();
                if s != want {
                    fails.push(format!("{}: score {s} vs {want}", c.id));
                } else {
                    scores += 1;
                }
            }
            "unclip" => {
                let quad = f32_quad(&Array::from_json(&c.input["box"]));
                let ours = poly::unclip(&quad, 1.4);
                let want = c.output["expanded"]
                    .as_object()
                    .map(|_| points_i32(&Array::from_json(&c.output["expanded"])));
                let ours_i32 = ours.as_ref().map(|v| {
                    v.iter()
                        .map(|p| [p[0] as i32, p[1] as i32])
                        .collect::<Vec<_>>()
                });
                if ours_i32 != want {
                    fails.push(format!("{}: unclip {ours_i32:?} vs {want:?}", c.id));
                    continue;
                }
                let Some(exp) = ours_i32.filter(|e| e.len() >= 4) else {
                    unclips += 1;
                    continue;
                };
                let pts: Vec<[f32; 2]> = exp.iter().map(|p| [p[0] as f32, p[1] as f32]).collect();
                let (q, s) = hull::get_mini_boxes(&Pts::Float(&pts));
                let want_q = f32_quad(&Array::from_json(&c.output["mini"]));
                let want_s = c.output["sside"].as_f64().unwrap() as f32;
                let ordered = poly::order_points_clockwise(&q);
                let want_o = f32_quad(&Array::from_json(&c.output["ordered"]));
                let dest = &c.output["dest"];
                let dest = (
                    dest[0].as_u64().unwrap() as usize,
                    dest[1].as_u64().unwrap() as usize,
                );
                let rescaled = poly::rescale_quad(&ordered, (448, 320), dest);
                let want_r: Vec<[i32; 2]> = points_i32(&Array::from_json(&c.output["rescaled"]));
                if q != want_q || s != want_s || ordered != want_o || rescaled.to_vec() != want_r {
                    fails.push(format!(
                        "{}: mini {q:?}/{s} vs {want_q:?}/{want_s}, ordered {ordered:?} vs {want_o:?}, rescaled {rescaled:?} vs {want_r:?}",
                        c.id
                    ));
                } else {
                    unclips += 1;
                }
            }
            "crop" => {
                let img = image3(&Array::from_json(&c.input["image"]));
                let q = points_i32(&Array::from_json(&c.input["box"]));
                let quad: Quad = [q[0], q[1], q[2], q[3]];
                let ours = warp::rotate_crop(&img, &quad);
                let want = Array::from_json(&c.output["crop"]);
                let (maxd, n) = if ours.w == want.shape[1] && ours.h == want.shape[0] {
                    golden::u8_diff(&ours.data, want.u8())
                } else {
                    (255, usize::MAX)
                };
                if n != 0 {
                    fails.push(format!(
                        "{}: crop {}x{} vs {:?}: {n} values differ, max {maxd}",
                        c.id, ours.w, ours.h, want.shape
                    ));
                } else {
                    crops += 1;
                }
            }
            "recnorm" => {
                // the pipeline keeps RGB; the golden holds cv2's BGR
                let mut img = image3(&Array::from_json(&c.input["image"]));
                img.data = bgr(&img);
                let ours = ppocr::resize_norm_img(&img, [3, 48, 320]);
                let want = Array::from_json(&c.output["tensor"]).f32();
                let d = golden::max_abs_diff(&ours, &want);
                if d != 0.0 {
                    fails.push(format!("{}: rec tensor max diff {d}", c.id));
                } else {
                    norms += 1;
                }
            }
            other => panic!("unknown case kind {other}"),
        }
    }
    eprintln!(
        "ocr geometry: contour sets {contour_sets}, mini boxes {minis}, scores {scores}, unclips {unclips}, crops {crops}, rec tensors {norms}; {} mismatches",
        fails.len()
    );
    for f in fails.iter().take(20) {
        eprintln!("  {f}");
    }
    assert!(fails.is_empty(), "{} geometry mismatches", fails.len());
}

fn ort_ready() -> bool {
    let ok = std::env::var_os("LP_ORT_LIB")
        .or_else(|| std::env::var_os("ORT_DYLIB_PATH"))
        .is_some();
    if !ok {
        eprintln!("no LP_ORT_LIB; skipping");
    }
    ok
}

fn quad_of(v: &Value) -> Quad {
    let p = |i: usize| {
        [
            v[i][0].as_i64().unwrap() as i32,
            v[i][1].as_i64().unwrap() as i32,
        ]
    };
    [p(0), p(1), p(2), p(3)]
}

fn bbox(q: &Quad) -> [f64; 4] {
    let xs = q.iter().map(|p| p[0] as f64);
    let ys = q.iter().map(|p| p[1] as f64);
    [
        xs.clone().fold(f64::INFINITY, f64::min),
        ys.clone().fold(f64::INFINITY, f64::min),
        xs.fold(f64::NEG_INFINITY, f64::max),
        ys.fold(f64::NEG_INFINITY, f64::max),
    ]
}

#[derive(Default, Debug)]
struct Tally {
    images: usize,
    /// Files whose own decode matches cv2 (PNG, WebP); the rest are JPEGs,
    /// checked on cv2's pixels (`_decoded/ocr`) and, separately, as files.
    decode_exact: usize,
    prob_maps: usize,
    prob_max_diff: f32,
    boxes_exact_images: usize,
    boxes_py: usize,
    boxes_ours: usize,
    boxes_matched: usize,
    min_iou: f64,
    crops_exact: usize,
    crops: usize,
    rec_text_same: usize,
    rec_conf_max_diff: f64,
    lines_py: usize,
    lines_same: usize,
    answers_exact: usize,
    // JPEG files through this crate's default decoder (zune-jpeg)
    jpeg_files: usize,
    jpeg_lines_py: usize,
    jpeg_lines_same: usize,
    jpeg_answers_same_text: usize,
}

fn lines(text: &str) -> Vec<&str> {
    text.split('\n').filter(|l| !l.is_empty()).collect()
}

fn decoded_png(case_id: &str) -> std::path::PathBuf {
    golden::root()
        .join("_decoded")
        .join("ocr")
        .join(format!("{}.png", case_id.replace('/', "__")))
}

fn run_pipeline(tier: &str) {
    if !ort_ready() {
        return;
    }
    let Some(g) = golden::load("ocr", &format!("pipeline_{tier}")) else {
        return;
    };
    let dir = golden::data_models()
        .join("ocr")
        .join(format!("ppocrv6_{tier}"));
    if !dir.join("rec.onnx").exists() {
        eprintln!("{} missing; skipping", dir.display());
        return;
    }
    lp_ml::runtime::init().expect("ONNX Runtime loads");
    let mut engine = Engine::load(&dir).expect("bundle loads");
    let max_side = engine.config.det_max_side;
    let opts = Options {
        min_confidence: 0.6,
        ..Options::default()
    };
    let mut t = Tally {
        min_iou: 1.0,
        ..Tally::default()
    };
    let mut notes: Vec<String> = Vec::new();
    for c in &g.cases {
        let path = Path::new(c.input["image"].as_str().unwrap());
        let out = &c.output;
        if out.get("error").is_some() {
            assert!(
                decode::read_image(path).is_err(),
                "{}: Python could not decode it",
                c.id
            );
            continue;
        }
        t.images += 1;
        let want_sha = out["decoded"]["sha256"].as_str().unwrap();
        let from_file = decode::read_image(path).unwrap_or_else(|e| panic!("{}: {e}", c.id));
        let exact = sha(&bgr(&from_file)) == want_sha;
        let img = if exact {
            t.decode_exact += 1;
            from_file.clone()
        } else {
            let png = decode::read_image(&decoded_png(&c.id))
                .unwrap_or_else(|e| panic!("{}: cv2 pixels missing, run golden_ocr.py: {e}", c.id));
            assert_eq!(sha(&bgr(&png)), want_sha, "{}: decoded png", c.id);
            png
        };

        // detection on cv2's pixels
        if let Some(p) = out.get("prob") {
            let want = Array::from_json(p).f32();
            let (ours, _, _) = engine.prob_map(&img, max_side).unwrap();
            t.prob_maps += 1;
            t.prob_max_diff = t.prob_max_diff.max(golden::max_abs_diff(&ours, &want));
        }
        let (boxes, det_size) = engine.detect(&img, max_side).unwrap();
        let want_det = &out["det_size"];
        assert_eq!(
            [det_size.0 as u64, det_size.1 as u64],
            [want_det[0].as_u64().unwrap(), want_det[1].as_u64().unwrap()],
            "{}: detection input size",
            c.id
        );
        let py_boxes: Vec<Quad> = out["boxes"]
            .as_array()
            .unwrap()
            .iter()
            .map(quad_of)
            .collect();
        if boxes == py_boxes {
            t.boxes_exact_images += 1;
        } else {
            notes.push(format!("{}: boxes {boxes:?} vs python {py_boxes:?}", c.id));
        }
        t.boxes_py += py_boxes.len();
        t.boxes_ours += boxes.len();
        for pb in &py_boxes {
            let best = boxes
                .iter()
                .map(|b| golden::iou(bbox(b), bbox(pb)))
                .fold(0.0, f64::max);
            if best > 0.0 {
                t.boxes_matched += 1;
            }
            t.min_iou = t.min_iou.min(best);
        }

        // crops and recognition on Python's boxes: isolates the recognizer
        let crops: Vec<Image3> = py_boxes
            .iter()
            .map(|q| warp::rotate_crop(&img, q))
            .collect();
        for (crop, want) in crops.iter().zip(out["crops"].as_array().unwrap()) {
            t.crops += 1;
            if sha(&bgr(crop)) == want["sha256"].as_str().unwrap() {
                t.crops_exact += 1;
            }
        }
        let rec = engine.recognize(&crops).unwrap();
        for ((text, conf), want) in rec.iter().zip(out["recognized"].as_array().unwrap()) {
            let wt = want[0].as_str().unwrap();
            t.rec_conf_max_diff = t
                .rec_conf_max_diff
                .max((conf - want[1].as_f64().unwrap()).abs());
            if text == wt {
                t.rec_text_same += 1;
            } else {
                notes.push(format!("{}: recognized {text:?} vs {wt:?}", c.id));
            }
        }

        // the whole answer
        let pred = engine.finish(&img, &boxes, opts).unwrap();
        let want_pred = &out["predict"];
        let py_lines = lines(want_pred["text"].as_str().unwrap());
        let our_lines = lines(&pred.text);
        t.lines_py += py_lines.len();
        t.lines_same += py_lines.iter().filter(|l| our_lines.contains(l)).count();
        let ours_json = pred.to_json();
        let block_keys = |v: &Value| -> Vec<(Value, Value)> {
            v["blocks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|b| (b["text"].clone(), b["box"].clone()))
                .collect()
        };
        let close = |a: &Value, b: &Value| (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-4;
        if block_keys(&ours_json) == block_keys(want_pred)
            && ours_json["text"] == want_pred["text"]
            && ours_json["image_width"] == want_pred["image_width"]
            && ours_json["image_height"] == want_pred["image_height"]
            && close(&ours_json["mean_confidence"], &want_pred["mean_confidence"])
            && close(
                &ours_json["text_area_fraction"],
                &want_pred["text_area_fraction"],
            )
        {
            t.answers_exact += 1;
        } else {
            notes.push(format!(
                "{}: answer differs:\n    ours {ours_json}\n    py   {want_pred}",
                c.id
            ));
        }
        let det = engine
            .finish(
                &img,
                &boxes,
                Options {
                    det_only: true,
                    ..opts
                },
            )
            .unwrap()
            .to_json();
        assert_eq!(
            det["box_count"], out["det_only"]["box_count"],
            "{}: det_only",
            c.id
        );
        assert!(close(
            &det["text_area_fraction"],
            &out["det_only"]["text_area_fraction"]
        ));

        // JPEG files through the default decoder
        if !exact {
            t.jpeg_files += 1;
            let p = engine.predict_image(&from_file, opts).unwrap();
            let ours = lines(&p.text);
            t.jpeg_lines_py += py_lines.len();
            t.jpeg_lines_same += py_lines.iter().filter(|l| ours.contains(l)).count();
            if p.text == want_pred["text"].as_str().unwrap() {
                t.jpeg_answers_same_text += 1;
            }
        }
    }
    eprintln!("ocr pipeline {tier}: {t:#?}");
    for n in &notes {
        eprintln!("  {n}");
    }
    let line_rate = t.lines_same as f64 / t.lines_py.max(1) as f64;
    eprintln!(
        "ocr pipeline {tier} (cv2's pixels): lines identical {}/{} ({:.2}%), boxes identical on {}/{} images, python boxes matched {}/{} (min IoU {:.3}), answers identical {}/{}",
        t.lines_same,
        t.lines_py,
        line_rate * 100.0,
        t.boxes_exact_images,
        t.images,
        t.boxes_matched,
        t.boxes_py,
        t.min_iou,
        t.answers_exact,
        t.images
    );
    assert!(line_rate >= 0.98, "line parity {line_rate}");
    assert!(t.min_iou >= 0.9, "box IoU {}", t.min_iou);
    let jpeg_rate = t.jpeg_lines_same as f64 / t.jpeg_lines_py.max(1) as f64;
    eprintln!(
        "ocr pipeline {tier} (JPEG files, default decoder): lines identical {}/{} ({:.2}%), same text {}/{}",
        t.jpeg_lines_same,
        t.jpeg_lines_py,
        jpeg_rate * 100.0,
        t.jpeg_answers_same_text,
        t.jpeg_files
    );
    assert!(jpeg_rate >= 0.9, "JPEG line parity {jpeg_rate}");
}

#[test]
fn pipeline_tiny_matches_python() {
    run_pipeline("tiny");
}

/// ~7 min on the dev box; run with `--ignored`.
#[test]
#[ignore]
fn pipeline_small_matches_python() {
    run_pipeline("small");
}

#[test]
fn charset_loading_keeps_spaces_and_line_structure() {
    use ppocr::config::load_charset;
    assert_eq!(load_charset("a\n \nb\n"), vec!["a", " ", "b"]);
    assert_eq!(load_charset("a\r\nb"), vec!["a", "b"]);
    assert_eq!(load_charset("a\n\n"), vec!["a"]);
    assert_eq!(load_charset("a\n\n\n"), vec!["a", ""]);
}

#[test]
fn reading_order_groups_rows_then_left_to_right() {
    let block = |text: &str, x: i32, y: i32| ppocr::Block {
        text: text.into(),
        quad: [[x, y], [x + 50, y], [x + 50, y + 20], [x, y + 20]],
        confidence: 0.9,
    };
    let sorted = ppocr::reading_order_sort(vec![
        block("c", 10, 100),
        block("b", 200, 12),
        block("a", 10, 10),
    ]);
    let texts: Vec<&str> = sorted.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(texts, ["a", "b", "c"]);
}

#[test]
fn numpy_pairwise_sum() {
    let v: Vec<f64> = (0..300).map(|i| 1.0 / (i as f64 + 1.0)).collect();
    // numpy: np.add.reduce(1 / np.arange(1, 301)) == 6.282663880299504
    assert_eq!(ppocr::np_sum(&v), 6.282663880299504);
}

fn ml_with(media_root: &Path, ocr_model: &str) -> lp_ml::Ml {
    let model = ocr_model.to_string();
    // The first Ml of a process fixes the runtime config: keep LP_ORT_LIB.
    let mut config = lp_ml::MlConfig::new(media_root.to_path_buf());
    config.runtime = lp_ml::runtime::RuntimeConfig::from_env();
    lp_ml::Ml::new(
        config,
        std::sync::Arc::new(move || lp_ml::Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: model.clone(),
            captioning_model: "lfm2_vl_450m".into(),
            semantic_search_model: String::new(),
        }),
    )
}

fn status_of(e: lp_sidecars::SidecarError) -> Option<(u16, String)> {
    match e {
        lp_sidecars::SidecarError::Status { status, detail, .. } => Some((status, detail)),
        _ => None,
    }
}

/// The sidecar's error contract: a missing file is a 400 before any model
/// load, no installed bundle is "unreachable", an undecodable file a 400.
#[tokio::test]
async fn errors_follow_the_sidecar_contract() {
    use lp_ml::Service;
    let dir = tempfile::tempdir().unwrap();
    let sidecars = lp_sidecars::Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let ml = ml_with(dir.path(), "ppocrv6_tiny");
    ml.set_mode(Service::Ocr, lp_ml::Mode::InProcess);
    let view = ml.view(&sidecars);
    let missing = dir.path().join("nope.png");
    let e = view
        .ocr()
        .ocr(&missing.display().to_string(), 0.6)
        .await
        .unwrap_err();
    assert_eq!(status_of(e), Some((400, "Image not found".into())));

    let junk = dir.path().join("junk.png");
    std::fs::write(&junk, b"not an image").unwrap();
    let e = view
        .ocr()
        .ocr(&junk.display().to_string(), 0.6)
        .await
        .unwrap_err();
    assert!(
        matches!(e, lp_sidecars::SidecarError::Unreachable { .. }),
        "no bundle installed: {e:?}"
    );

    // with the bundle
    if !ort_ready() {
        return;
    }
    let bundle = golden::data_models().join("ocr/ppocrv6_tiny");
    if !bundle.join("rec.onnx").exists() {
        return;
    }
    let to = dir.path().join("data_models/ocr/ppocrv6_tiny");
    std::fs::create_dir_all(&to).unwrap();
    for e in std::fs::read_dir(&bundle).unwrap() {
        let e = e.unwrap();
        std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
    }
    ml.set_mode(Service::Ocr, lp_ml::Mode::Auto);
    let view = ml.view(&sidecars);
    assert!(
        view.is_inprocess(Service::Ocr),
        "auto picks the installed port"
    );
    let e = view
        .ocr()
        .ocr(&junk.display().to_string(), 0.6)
        .await
        .unwrap_err();
    assert_eq!(status_of(e), Some((400, "Failed to decode image".into())));
    let text = golden::root().join("_images/text_900x260.png");
    if text.exists() {
        let r = view
            .ocr()
            .ocr(&text.display().to_string(), 0.6)
            .await
            .unwrap();
        assert_eq!(
            r.text.as_deref(),
            Some("LibrePhotos 2026\nReceipt total: 42.50 EUR")
        );
        assert_eq!((r.image_width, r.image_height), (Some(900), Some(260)));
        assert_eq!(r.blocks.unwrap().as_array().unwrap().len(), 2);
        assert_eq!(
            ml.loaded_models(Service::Ocr),
            vec![("ppocrv6".to_string(), 1)]
        );
        assert!(ml.unload(Service::Ocr));
        assert!(ml.loaded_models(Service::Ocr).is_empty());
    }
}

/// `cv2.resize` INTER_LINEAR (both directions) and INTER_AREA (the 40 MP
/// cap) on seeded random sizes: bit-exact.
#[test]
fn cv2_resize_is_exact() {
    let Some(g) = golden::load("ocr", "resize") else {
        return;
    };
    let mut fails = Vec::new();
    for c in &g.cases {
        let src = Array::from_json(&c.input["image"]);
        let (h, w) = (src.shape[0], src.shape[1]);
        let size = &c.input["size"];
        let (dw, dh) = (
            size[0].as_u64().unwrap() as usize,
            size[1].as_u64().unwrap() as usize,
        );
        let ours = match c.input["interp"].as_str().unwrap() {
            "area" => lp_ml::preprocess::cv2::resize_area(src.u8(), w, h, 3, dw, dh),
            _ => lp_ml::preprocess::cv2::resize_linear(src.u8(), w, h, 3, dw, dh),
        };
        let want = Array::from_json(&c.output["image"]);
        if ours != want.u8() {
            let n = ours.iter().zip(want.u8()).filter(|(a, b)| a != b).count();
            fails.push(format!(
                "{}: {w}x{h} -> {dw}x{dh}: {n} samples differ",
                c.id
            ));
        }
    }
    for f in &fails {
        eprintln!("  {f}");
    }
    eprintln!(
        "ocr cv2.resize: {}/{} exact",
        g.cases.len() - fails.len(),
        g.cases.len()
    );
    assert!(fails.is_empty());
}

/// Formats and damaged files the ocr job can send (originals `.jpg .png
/// .webp .bmp .tif .tiff`): decoded like `cv2.imdecode(IMREAD_UNCHANGED)`
/// (bit-exact unless JPEG-coded, then within a level on average; over 40 MP
/// incl. the `INTER_AREA` cap) or refused where cv2 refuses them, and read
/// the same text (a truncated JPEG is refused too, through `load_rgb`).
#[test]
fn edge_cases_match_python() {
    run_edge("tiny");
}

/// The medium bundle (only `box_thresh` differs from small) on the same set.
#[test]
#[ignore]
fn edge_cases_match_python_medium() {
    run_edge("medium");
}

fn run_edge(tier: &str) {
    if !ort_ready() {
        return;
    }
    let Some(g) = golden::load("ocr", &format!("edge_{tier}")) else {
        return;
    };
    let dir = golden::data_models().join(format!("ocr/ppocrv6_{tier}"));
    if !dir.join("rec.onnx").exists() {
        return;
    }
    lp_ml::runtime::init().expect("ONNX Runtime loads");
    let mut engine = Engine::load(&dir).expect("bundle loads");
    let mut fails = Vec::new();
    let mut checked = 0;
    for c in &g.cases {
        let path = Path::new(c.input["image"].as_str().unwrap());
        let name = path.file_name().unwrap().to_string_lossy();
        let lossy = name.ends_with(".jpg") || name == "jpeg.tif";
        let ours = decode::read_image(path);
        if let Some(err) = c.output.get("error") {
            match ours {
                Ok(img) => fails.push(format!(
                    "{}: decoded {}x{}, cv2 refused it ({err})",
                    c.id, img.w, img.h
                )),
                Err(_) => checked += 1,
            }
            continue;
        }
        let img = match ours {
            Ok(img) => img,
            Err(e) => {
                fails.push(format!("{}: {e}, cv2 decodes it", c.id));
                continue;
            }
        };
        let want = &c.output["decoded"];
        let shape = want["shape"].as_array().unwrap();
        if [img.h as u64, img.w as u64] != [shape[0].as_u64().unwrap(), shape[1].as_u64().unwrap()]
        {
            fails.push(format!("{}: size {}x{} vs {shape:?}", c.id, img.w, img.h));
            continue;
        }
        let px = bgr(&img);
        if lossy {
            let n = (img.w * img.h) as f64;
            for (ch, m) in want["mean_bgr"].as_array().unwrap().iter().enumerate() {
                let ours = px
                    .iter()
                    .skip(ch)
                    .step_by(3)
                    .map(|&v| v as f64)
                    .sum::<f64>()
                    / n;
                if (ours - m.as_f64().unwrap()).abs() > 1.0 {
                    fails.push(format!("{}: channel {ch} mean {ours:.2} vs {m}", c.id));
                }
            }
        } else if sha(&px) != want["sha256"].as_str().unwrap() {
            fails.push(format!("{}: pixels differ from cv2", c.id));
        }
        let pred = engine
            .predict_image(
                &img,
                Options {
                    min_confidence: 0.6,
                    ..Options::default()
                },
            )
            .unwrap();
        let want_text = c.output["predict"]["text"].as_str().unwrap();
        if pred.text != want_text {
            fails.push(format!("{}: text {:?} vs {want_text:?}", c.id, pred.text));
        }
        checked += 1;
    }
    for f in &fails {
        eprintln!("  {f}");
    }
    eprintln!("ocr edge cases {tier}: {checked}/{} match", g.cases.len());
    assert!(fails.is_empty(), "{} edge-case mismatches", fails.len());
}
