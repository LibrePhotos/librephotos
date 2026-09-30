//! lp_ml::tags against the Python taggers (goldens from
//! `tests/ml/golden_tags.py`). Skipped without goldens, models or
//! `LP_ORT_LIB`. `cargo test -p lp-ml --test tags -- --nocapture` prints the
//! parity summary.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use lp_ml::golden::{self, Array};
use lp_ml::tags::tagger::{self, MAX_TAGS, Model, Tagger};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{SidecarError, Sidecars};

fn has_runtime() -> bool {
    let ok =
        std::env::var_os("LP_ORT_LIB").is_some() || std::env::var_os("ORT_DYLIB_PATH").is_some();
    if !ok {
        eprintln!("no LP_ORT_LIB; skipping");
    }
    ok
}

fn model_dir(model: Model) -> Option<PathBuf> {
    let d = golden::data_models().join(model.name());
    if d.join("vision_model.onnx").exists() {
        Some(d)
    } else {
        eprintln!("{} missing; skipping", d.display());
        None
    }
}

fn model_of(id: &str) -> Model {
    Model::from_name(id).expect("golden model")
}

fn strings(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .expect("string list")
        .iter()
        .map(|s| s.as_str().expect("string").to_string())
        .collect()
}

#[test]
fn prompt_token_ids_match_python() {
    let Some(g) = golden::load("tags", "text") else {
        return;
    };
    for c in &g.cases {
        let model = model_of(&c.id);
        let dir = golden::data_models().join(model.name());
        if !dir.exists() {
            eprintln!("{} missing; skipping", dir.display());
            continue;
        }
        let prompts = strings(&c.input["prompts"]);
        let want = Array::from_json(&c.output["input_ids"]);
        let (ids, _) = tagger::tokenize_prompts(model, &dir, &prompts).expect("tokenize");
        assert_eq!(ids.len(), want.len(), "{}: size", c.id);
        let want_ids = want.i64();
        let per = want.shape[1];
        for (i, p) in prompts.iter().enumerate() {
            assert_eq!(
                ids[i * per..(i + 1) * per],
                want_ids[i * per..(i + 1) * per],
                "{}: {p:?}",
                c.id
            );
        }
        let extra = strings(&c.input["extra_texts"]);
        let want = Array::from_json(&c.output["extra_ids"]).i64();
        let (ids, _) = tagger::tokenize_prompts(model, &dir, &extra).expect("tokenize");
        for (i, t) in extra.iter().enumerate() {
            assert_eq!(
                ids[i * per..(i + 1) * per],
                want[i * per..(i + 1) * per],
                "{}: {t:?}",
                c.id
            );
        }
        eprintln!(
            "{}: {} prompts + {} edge cases tokenised identically",
            c.id,
            prompts.len(),
            extra.len()
        );
    }
}

/// Rebuilding the tag-embedding cache with the Rust text path gives the
/// Python cache. SigLIP 2's 1.1 GB text tower takes a while on CPU, so it
/// only runs with `LP_ML_SLOW_TESTS=1`.
#[test]
fn tag_embeddings_match_python() {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", "text") else {
        return;
    };
    for c in &g.cases {
        let model = model_of(&c.id);
        if model == Model::Siglip2 && std::env::var_os("LP_ML_SLOW_TESTS").is_none() {
            eprintln!("siglip2 text tower: set LP_ML_SLOW_TESTS=1 to run");
            continue;
        }
        let Some(dir) = model_dir(model) else {
            continue;
        };
        let want = Array::from_json(&c.output["tag_embeddings"]);
        let started = std::time::Instant::now();
        let (dim, ours) = tagger::build_tag_embeddings(model, &dir, &tagger::TAGS).expect("build");
        assert_eq!(dim, want.shape[1], "{}: dim", c.id);
        let want = want.f32();
        let mut worst = 1f64;
        for (a, b) in ours.chunks(dim).zip(want.chunks(dim)) {
            worst = worst.min(golden::cosine(a, b));
        }
        let diff = golden::max_abs_diff(&ours, &want);
        eprintln!(
            "{}: {} tag embeddings in {:.1}s, min cosine {worst:.7}, max |diff| {diff:.2e}",
            c.id,
            ours.len() / dim,
            started.elapsed().as_secs_f64()
        );
        assert!(worst > 0.9999, "{}: min cosine {worst}", c.id);
    }
}

#[derive(Default)]
struct Parity {
    images: usize,
    same_tags: usize,
    same_order: usize,
    max_score_diff: f32,
    min_cosine: f64,
    mismatches: Vec<String>,
}

impl Parity {
    fn new() -> Self {
        Parity {
            min_cosine: 1.0,
            ..Default::default()
        }
    }

    fn record(&mut self, id: &str, ours: &tagger::Prediction, want: &serde_json::Value) {
        let want_tags = strings(&want["tags"]["tags"]);
        let want_scores = Array::from_json(&want["scores"]).f32();
        let want_emb = Array::from_json(&want["embedding"]).f32();
        let (mut a, mut b) = (ours.tags.clone(), want_tags.clone());
        a.sort();
        b.sort();
        self.images += 1;
        self.same_tags += usize::from(a == b);
        self.same_order += usize::from(ours.tags == want_tags);
        self.max_score_diff = self
            .max_score_diff
            .max(golden::max_abs_diff(&ours.scores, &want_scores));
        self.min_cosine = self
            .min_cosine
            .min(golden::cosine(&ours.embedding, &want_emb));
        if a != b {
            self.mismatches
                .push(format!("{id}: ours {:?} python {:?}", ours.tags, want_tags));
        }
    }

    fn report(&self, model: Model, what: &str) {
        eprintln!(
            "{} [{what}]: {}/{} same tag set, {}/{} same order, max |score diff| {:.2e}, min embedding cosine {:.6}",
            model.name(),
            self.same_tags,
            self.images,
            self.same_order,
            self.images,
            self.max_score_diff,
            self.min_cosine
        );
        for m in &self.mismatches {
            eprintln!("  {m}");
        }
    }
}

/// `golden_tags.py`'s Pillow decode of a JPEG case, if written.
fn pillow_decoded(id: &str) -> Option<PathBuf> {
    let p = golden::root()
        .join("_decoded")
        .join("tags")
        .join(format!("{}.png", id.replace('/', "__")));
    p.exists().then_some(p)
}

/// Model parity runs every image on the pixels Pillow decoded (JPEGs via
/// their lossless copy); the end-to-end run feeds the files as they are,
/// where our JPEG decoder may differ from libjpeg-turbo by a few levels.
fn check_images(model: Model) {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", model.name()) else {
        return;
    };
    let Some(dir) = model_dir(model) else { return };
    let mut t = Tagger::load(model, &dir).expect("tagger loads");
    let (mut pixels, mut files, mut jpeg_files) = (Parity::new(), Parity::new(), Parity::new());
    let (mut total, mut timed) = (0f64, 0usize);
    for c in &g.cases {
        let path = c.input["image"].as_str().expect("image path");
        if !Path::new(path).exists() {
            eprintln!("{path} missing; skipping");
            continue;
        }
        let started = std::time::Instant::now();
        let ours = t.predict(Path::new(path), model.threshold(), MAX_TAGS);
        total += started.elapsed().as_secs_f64();
        timed += 1;
        if c.output.get("error").is_some() {
            assert!(
                ours.is_err(),
                "{}: Python failed ({}), Rust did not",
                c.id,
                c.output["error"]
            );
            continue;
        }
        let ours = ours.unwrap_or_else(|e| panic!("{}: {e:#}", c.id));
        files.record(&c.id, &ours, &c.output);
        let is_jpeg = [".jpg", ".jpeg"]
            .iter()
            .any(|e| path.to_ascii_lowercase().ends_with(e));
        if !is_jpeg {
            pixels.record(&c.id, &ours, &c.output);
            continue;
        }
        jpeg_files.record(&c.id, &ours, &c.output);
        if let Some(decoded) = pillow_decoded(&c.id) {
            let ours = t
                .predict(&decoded, model.threshold(), MAX_TAGS)
                .unwrap_or_else(|e| panic!("{}: {e:#}", c.id));
            pixels.record(&c.id, &ours, &c.output);
        }
    }
    pixels.report(model, "same pixels");
    files.report(model, "files as is");
    jpeg_files.report(model, "jpeg files only");
    eprintln!(
        "{}: {:.1} ms per image (this build)",
        model.name(),
        total * 1000.0 / timed.max(1) as f64
    );
    assert!(pixels.images > 0, "{}: no images", model.name());
    assert!(
        pixels.same_tags * 100 >= pixels.images * 99,
        "{}: tag sets differ on too many images",
        model.name()
    );
    assert!(
        pixels.max_score_diff <= 1e-3,
        "{}: scores differ by {}",
        model.name(),
        pixels.max_score_diff
    );
    assert!(
        files.same_tags * 100 >= files.images * 95,
        "{}: tag sets of the files as is differ on too many images",
        model.name()
    );
}

#[test]
fn mobileclip_images_match_python() {
    check_images(Model::MobileClipS2);
}

#[test]
fn siglip2_images_match_python() {
    check_images(Model::Siglip2);
}

fn ml(model: &'static str) -> Ml {
    let media_root = golden::ml_root().join("protected_media");
    let ml = Ml::new(
        MlConfig::from_env(media_root),
        Arc::new(move || Selection {
            tagging_model: model.into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    );
    ml.set_auto_download(false);
    ml
}

/// The switch picks the in-process tagger and it answers like the sidecar:
/// `{"tags": {"tags": [...]}}`, 400 for an unknown model, 500 for an
/// unreadable image, an empty model name meaning MobileCLIP.
#[tokio::test]
async fn inprocess_service_answers_like_the_sidecar() {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", "mobileclip_s2") else {
        return;
    };
    if model_dir(Model::MobileClipS2).is_none() {
        return;
    }
    let ml = ml("mobileclip_s2");
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    assert!(
        view.is_inprocess(Service::Tags),
        "auto picks the in-process tagger"
    );

    let case = g
        .cases
        .iter()
        .find(|c| {
            c.id.ends_with(".webp")
                && c.output["tags"]["tags"]
                    .as_array()
                    .is_some_and(|t| !t.is_empty())
        })
        .expect("a tagged golden image");
    let image = case.input["image"].as_str().unwrap();
    let reply = view
        .tags()
        .generate_tags(image, 0.4, "")
        .await
        .expect("tags");
    assert_eq!(reply, serde_json::json!({"tags": case.output["tags"]}));
    assert_eq!(
        ml.loaded_models(Service::Tags),
        vec![("tagger".to_string(), 1)]
    );

    match view.tags().generate_tags(image, 0.4, "places365").await {
        Err(SidecarError::Status {
            status: 400,
            detail,
            ..
        }) => {
            assert_eq!(detail, "Unknown tagging model 'places365'")
        }
        other => panic!("unknown model: {other:?}"),
    }
    // Only an empty name falls back to the default (`tagging_model or ...`).
    match view
        .tags()
        .generate_tags(image, 0.4, " mobileclip_s2")
        .await
    {
        Err(SidecarError::Status { status: 400, .. }) => {}
        other => panic!("padded model name: {other:?}"),
    }
    match view
        .tags()
        .generate_tags("/no/such/photo.webp", 0.4, "mobileclip_s2")
        .await
    {
        Err(SidecarError::Status { status: 500, .. }) => {}
        other => panic!("missing image: {other:?}"),
    }
    assert!(ml.unload(Service::Tags));
    assert!(ml.loaded_models(Service::Tags).is_empty());

    ml.set_mode(Service::Tags, Mode::Sidecar);
    assert!(!view.is_inprocess(Service::Tags));
}

fn rss_mb() -> f64 {
    let pid = sysinfo::get_current_pid().expect("pid");
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).map_or(0.0, |p| p.memory() as f64 / 1e6)
}

/// Per-photo latency and resident memory of each tagger on the fixture's
/// big thumbnails (what `tags.generate` feeds it). Counterpart of
/// `tests/ml/bench_tags.py`. Run alone, ideally in release:
/// `cargo test --release -p lp-ml --test tags -- --ignored --nocapture bench_`
/// (`LP_BENCH_MODEL=mobileclip_s2` or `siglip2` for one model).
#[test]
#[ignore]
fn bench_tagger_latency_and_memory() {
    if !has_runtime() {
        return;
    }
    let thumbs = golden::root()
        .parent()
        .expect("rust-pg")
        .join("fixture/protected_media/thumbnails_big");
    let mut images: Vec<PathBuf> = std::fs::read_dir(&thumbs)
        .expect("fixture thumbnails")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "webp"))
        .collect();
    images.sort();
    lp_ml::runtime::init().expect("runtime");
    let only = std::env::var("LP_BENCH_MODEL").ok();
    for model in [Model::MobileClipS2, Model::Siglip2] {
        if only.as_deref().is_some_and(|m| m != model.name()) {
            continue;
        }
        let Some(dir) = model_dir(model) else {
            continue;
        };
        let before = rss_mb();
        let started = std::time::Instant::now();
        let mut t = Tagger::load(model, &dir).expect("load");
        let load = started.elapsed().as_secs_f64();
        let loaded = rss_mb();
        t.predict(&images[0], model.threshold(), MAX_TAGS)
            .expect("warm-up");
        let mut ms: Vec<f64> = Vec::new();
        for p in &images {
            let s = std::time::Instant::now();
            t.predict(p, model.threshold(), MAX_TAGS).expect("predict");
            ms.push(s.elapsed().as_secs_f64() * 1000.0);
        }
        let after = rss_mb();
        drop(t);
        lp_ml::slot::release_memory();
        let unloaded = rss_mb();
        ms.sort_by(f64::total_cmp);
        let mean = ms.iter().sum::<f64>() / ms.len() as f64;
        eprintln!(
            "{}: load {load:.2}s | {} images: mean {mean:.1} ms, p50 {:.1} ms, max {:.1} ms | RSS {before:.0} MB -> loaded {loaded:.0} MB (+{:.0}) -> after inference {after:.0} MB (+{:.0}) -> unloaded {unloaded:.0} MB",
            model.name(),
            ms.len(),
            ms[ms.len() / 2],
            ms[ms.len() - 1],
            loaded - before,
            after - before,
        );
    }
}

/// A 1-pixel-high panorama thumbnail: MobileCLIP's shortest-edge resize
/// would be 3,840,000 x 256 (about 3 GB) before the centre crop; only the
/// crop is resampled, so this stays small and answers.
#[test]
fn panorama_thumbnail_is_tagged_without_a_huge_resize() {
    if !has_runtime() {
        return;
    }
    let Some(dir) = model_dir(Model::MobileClipS2) else {
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("panorama.png");
    image::RgbImage::from_fn(15_000, 1, |x, _| {
        image::Rgb([(x % 256) as u8, 90, (255 - x % 256) as u8])
    })
    .save(&path)
    .unwrap();
    let mut t = Tagger::load(Model::MobileClipS2, &dir).expect("tagger loads");
    let p = t
        .predict(&path, Model::MobileClipS2.threshold(), MAX_TAGS)
        .expect("tags");
    assert_eq!(p.scores.len(), tagger::TAGS.len());
    assert!(p.tags.len() <= MAX_TAGS);
}

/// Image modes and broken files (goldens from `tests/ml/golden_tags_edge.py`).
/// On Pillow's pixels every case matches the Python tagger. The files as they
/// are: PNG/GIF/BMP/TIFF/WebP decode to Pillow's exact pixels; JPEGs (grey,
/// CMYK, progressive, EXIF-rotated, neither side applies the orientation) and
/// 16-bit RGB PNGs differ by a few levels. Known differences: Pillow clips a
/// 16-bit grey PNG to white where we scale it, and a truncated JPEG is a 500
/// in Python but decodes partially here.
#[test]
fn edge_case_images_match_python() {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", "edge") else {
        return;
    };
    const INEXACT: [&str; 2] = ["rgb16.png", "gray16.png"];
    for model in [Model::MobileClipS2, Model::Siglip2] {
        let Some(dir) = model_dir(model) else {
            continue;
        };
        let mut t = Tagger::load(model, &dir).expect("tagger loads");
        let mut checked = 0;
        for c in g.cases.iter().filter(|c| c.input["model"] == model.name()) {
            let path = Path::new(c.input["image"].as_str().expect("image"));
            if !path.exists() {
                eprintln!("{} missing; skipping", path.display());
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let ours = t.predict(path, model.threshold(), MAX_TAGS);
            if c.output.get("error").is_some() {
                if name == "truncated.jpg" {
                    continue;
                }
                assert!(ours.is_err(), "{name}: Python failed, Rust did not");
                continue;
            }
            let ours = ours.unwrap_or_else(|e| panic!("{name}: {e:#}"));
            let want_tags = strings(&c.output["tags"]["tags"]);
            let want_scores = Array::from_json(&c.output["scores"]).f32();
            let decoded = c.input["decoded"].as_str().expect("decoded copy");
            let on_pixels = t
                .predict(Path::new(decoded), model.threshold(), MAX_TAGS)
                .unwrap_or_else(|e| panic!("{name}: {e:#}"));
            assert_eq!(on_pixels.tags, want_tags, "{} {name}", model.name());
            let diff = golden::max_abs_diff(&on_pixels.scores, &want_scores);
            assert!(
                diff <= 1e-4,
                "{} {name}: scores differ by {diff}",
                model.name()
            );
            let is_jpeg = name.ends_with(".jpg");
            if !is_jpeg && !INEXACT.contains(&name.as_str()) {
                let a = lp_ml::preprocess::load_rgb(path).expect("decode");
                let b = lp_ml::preprocess::load_rgb(Path::new(decoded)).expect("decode");
                assert_eq!(a.dimensions(), b.dimensions(), "{name}");
                assert_eq!(
                    golden::u8_diff(a.as_raw(), b.as_raw()).0,
                    0,
                    "{name}: pixels"
                );
                assert_eq!(ours.tags, want_tags, "{} {name}: file", model.name());
            }
            checked += 1;
        }
        eprintln!("{}: {checked} edge-case images match", model.name());
        assert!(checked > 0);
    }
}

/// The Rust text path against tag embeddings Python computed with the text
/// tower in memory (`golden_tags_edge.py` `text_fresh`), not read back from
/// the shared `tag_embeddings.npy`, for a sample of prompts including every
/// non-ASCII tag. SigLIP 2 needs `LP_ML_SLOW_TESTS=1`.
#[test]
fn fresh_text_embeddings_match_python() {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", "text_fresh") else {
        return;
    };
    for c in &g.cases {
        let model = model_of(&c.id);
        if model == Model::Siglip2 && std::env::var_os("LP_ML_SLOW_TESTS").is_none() {
            eprintln!("siglip2 text tower: set LP_ML_SLOW_TESTS=1 to run");
            continue;
        }
        let Some(dir) = model_dir(model) else {
            continue;
        };
        let tags: Vec<String> = c.input["indices"]
            .as_array()
            .expect("indices")
            .iter()
            .map(|i| tagger::TAGS[i.as_u64().expect("index") as usize].clone())
            .collect();
        assert!(
            tags.iter().any(|t| !t.is_ascii()),
            "sample has non-ASCII tags"
        );
        let want = Array::from_json(&c.output["embeddings"]);
        let (dim, ours) = tagger::build_tag_embeddings(model, &dir, &tags).expect("build");
        assert_eq!(dim, want.shape[1], "{}: dim", c.id);
        let want = want.f32();
        let mut worst = 1f64;
        for (a, b) in ours.chunks(dim).zip(want.chunks(dim)) {
            worst = worst.min(golden::cosine(a, b));
        }
        let diff = golden::max_abs_diff(&ours, &want);
        eprintln!(
            "{}: {} fresh prompt embeddings, min cosine {worst:.7}, max |diff| {diff:.2e}",
            c.id,
            tags.len()
        );
        assert!(worst > 0.99999, "{}: min cosine {worst}", c.id);
        assert!(diff < 1e-4, "{}: max diff {diff}", c.id);
    }
}

/// Concurrent calls (two loaded copies) give the goldens' answers, and the
/// inference runs off the async runtime: a single-threaded runtime keeps
/// ticking while photos are tagged.
#[tokio::test(flavor = "current_thread")]
async fn concurrent_calls_agree_and_do_not_block_the_runtime() {
    if !has_runtime() {
        return;
    }
    let Some(g) = golden::load("tags", "mobileclip_s2") else {
        return;
    };
    if model_dir(Model::MobileClipS2).is_none() {
        return;
    }
    let cases: Vec<_> = g
        .cases
        .iter()
        .filter(|c| c.id.ends_with(".webp"))
        .filter(|c| Path::new(c.input["image"].as_str().unwrap()).exists())
        .take(6)
        .collect();
    if cases.is_empty() {
        return;
    }
    let media_root = golden::ml_root().join("protected_media");
    let mut cfg = MlConfig::from_env(media_root);
    cfg.concurrency.insert(Service::Tags, 2);
    cfg.modes.insert(Service::Tags, Mode::InProcess);
    let ml = Ml::new(
        cfg,
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    );
    ml.set_auto_download(false);
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);

    let done = std::sync::atomic::AtomicBool::new(false);
    // Longest wait between two ticks: an inference on the runtime thread
    // would stall it for a whole call (about a second here).
    let ticker = async {
        let mut last = std::time::Instant::now();
        let mut worst = std::time::Duration::ZERO;
        while !done.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            worst = worst.max(last.elapsed());
            last = std::time::Instant::now();
        }
        worst
    };
    let work = async {
        let calls = cases.iter().map(|c| {
            view.tags()
                .generate_tags(c.input["image"].as_str().unwrap(), 0.4, "mobileclip_s2")
        });
        let replies = futures::future::join_all(calls).await;
        done.store(true, std::sync::atomic::Ordering::SeqCst);
        replies
    };
    let started = std::time::Instant::now();
    let (worst_gap, replies) = tokio::join!(ticker, work);
    let elapsed = started.elapsed();
    for (c, r) in cases.iter().zip(replies) {
        let r = r.unwrap_or_else(|e| panic!("{}: {e}", c.id));
        assert_eq!(r, serde_json::json!({"tags": c.output["tags"]}), "{}", c.id);
    }
    let copies = ml.loaded_models(Service::Tags);
    assert_eq!(copies, vec![("tagger".to_string(), 2)], "two copies ran");
    eprintln!(
        "{} photos in {elapsed:?}, longest runtime stall {worst_gap:?}",
        cases.len()
    );
    assert!(
        worst_gap < std::time::Duration::from_millis(300),
        "runtime stalled for {worst_gap:?}"
    );
}
