//! The libvips JPEG decoder for in-process ML (`vips::install_ml_decoder`)
//! against cv2's decode of the OCR golden JPEGs (`tests/ml/golden_ocr.py`),
//! and the OCR answers on those files end to end. Needs `LP_VIPS_LIB` and
//! the goldens; the answers also need `LP_ORT_LIB`.

use std::path::Path;

use lp_ml::golden;
use lp_ml::ocr::ppocr::{Engine, Image3, Options, decode};

fn vips_lib() -> Option<std::path::PathBuf> {
    let lib = std::env::var_os("LP_VIPS_LIB").map(std::path::PathBuf::from);
    if lib.is_none() {
        eprintln!("no LP_VIPS_LIB; skipping");
    }
    lib
}

fn decoded_png(case_id: &str) -> std::path::PathBuf {
    golden::root()
        .join("_decoded")
        .join("ocr")
        .join(format!("{}.png", case_id.replace('/', "__")))
}

fn mean_bgr(img: &Image3) -> [f64; 3] {
    let n = (img.w * img.h) as f64;
    let mut m = [0f64; 3];
    for px in img.data.chunks_exact(3) {
        for (c, v) in px.iter().rev().enumerate() {
            m[c] += *v as f64;
        }
    }
    m.map(|s| s / n)
}

#[test]
fn jpegs_decode_like_cv2_and_read_the_same() {
    let Some(lib) = vips_lib() else { return };
    let Some(pipeline) = golden::load("ocr", "pipeline_tiny") else {
        return;
    };
    assert!(lp_ingest::vips::install_ml_decoder(Some(lib)));

    // A cut JPEG is refused like Pillow / cv2 do, not padded by libjpeg-turbo.
    if let Some(first) = pipeline.cases.iter().find_map(|c| {
        let p = Path::new(c.input["image"].as_str().unwrap());
        p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("jpg"))
            .then(|| p.to_path_buf())
    }) {
        let bytes = std::fs::read(&first).unwrap();
        let cut =
            std::env::temp_dir().join(format!("lp_ml_decoder_cut_{}.jpg", std::process::id()));
        std::fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
        let err = lp_ml::preprocess::load_rgb(&cut).expect_err("truncated JPEG is refused");
        let _ = std::fs::remove_file(&cut);
        assert!(format!("{err:#}").contains("truncated"), "{err:#}");
    }

    let mut fails = Vec::new();
    let mut jpegs = Vec::new();
    for c in &pipeline.cases {
        let path = Path::new(c.input["image"].as_str().unwrap());
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("jpg"))
        {
            continue;
        }
        let ours = decode::read_image(path).expect("decodes");
        let cv2 = decode::read_image(&decoded_png(&c.id)).expect("cv2 decode png");
        if ours != cv2 {
            let n = ours
                .data
                .iter()
                .zip(&cv2.data)
                .filter(|(a, b)| a != b)
                .count();
            fails.push(format!("{}: {n} samples differ from cv2", c.id));
        }
        jpegs.push(c);
    }
    eprintln!(
        "vips JPEG decode: {}/{} identical to cv2",
        jpegs.len() - fails.len(),
        jpegs.len()
    );

    // grey / progressive / EXIF-rotated (not applied) / CMYK (falls back to
    // the Rust decoder) JPEGs
    if let Some(edge) = golden::load("ocr", "edge_tiny") {
        for c in &edge.cases {
            let path = Path::new(c.input["image"].as_str().unwrap());
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if !name.ends_with(".jpg") || c.output.get("error").is_some() {
                continue;
            }
            let img = decode::read_image(path).expect("decodes");
            let want = c.output["decoded"]["mean_bgr"].as_array().unwrap();
            let got = mean_bgr(&img);
            let tol = if name == "cmyk.jpg" { 1.0 } else { 1e-9 };
            for (ch, w) in want.iter().enumerate() {
                if (got[ch] - w.as_f64().unwrap()).abs() > tol {
                    fails.push(format!("{name}: channel {ch} mean {} vs {w}", got[ch]));
                }
            }
        }
    }

    let ort = std::env::var_os("LP_ORT_LIB")
        .or_else(|| std::env::var_os("ORT_DYLIB_PATH"))
        .is_some();
    let dir = golden::data_models().join("ocr/ppocrv6_tiny");
    if ort && dir.join("rec.onnx").exists() {
        lp_ml::runtime::init().expect("ONNX Runtime loads");
        let mut engine = Engine::load(&dir).expect("bundle loads");
        let (mut lines, mut lines_same, mut answers) = (0, 0, 0);
        for c in &jpegs {
            let path = Path::new(c.input["image"].as_str().unwrap());
            let pred = engine.predict(path, Options::default()).unwrap().to_json();
            let want = &c.output["predict"];
            let want_lines: Vec<&str> = want["text"]
                .as_str()
                .unwrap()
                .split('\n')
                .filter(|l| !l.is_empty())
                .collect();
            let ours = pred["text"].as_str().unwrap().to_string();
            lines += want_lines.len();
            lines_same += want_lines
                .iter()
                .filter(|l| ours.split('\n').any(|o| o == **l))
                .count();
            if &pred == want {
                answers += 1;
            } else {
                fails.push(format!("{}: answer differs", c.id));
            }
        }
        eprintln!(
            "ocr tiny on JPEG files via libvips: lines {lines_same}/{lines}, answers identical {answers}/{}",
            jpegs.len()
        );
    }
    for f in &fails {
        eprintln!("  {f}");
    }
    assert!(fails.is_empty(), "{} mismatches", fails.len());
}
