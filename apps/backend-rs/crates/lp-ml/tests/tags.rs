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
