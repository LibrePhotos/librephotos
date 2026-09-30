//! RAW files through the real scan pipeline with the in-process RAW
//! renderer: the synthetic DNGs of `tests/ml/raw_samples.py` are scanned and
//! their big thumbnails compared with what Django + the thumbnail service
//! wrote for the same files (`tests/ml/golden_raw_thumbnail.py`). Skipped
//! without the goldens or the tools (ExifTool, ffmpeg, libvips).

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};
use std::time::Instant;

use lp_ingest::Pipeline;
use lp_ingest::scan::{self, ScanOptions};
use lp_ml::{Mode, Service};
use lp_testkit::TestApp;
use uuid::Uuid;

fn tools() -> Option<Vec<(String, String)>> {
    let venv = std::env::var("LP_TEST_VENV")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win".into());
    let site = Path::new(&venv).join("Lib").join("site-packages");
    let vips = std::fs::read_dir(&site).ok().and_then(|d| {
        d.flatten().map(|e| e.path()).find(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("libvips-42"))
        })
    });
    let pick = |var: &str, default: Option<PathBuf>| -> Option<(String, String)> {
        let p = std::env::var(var).ok().map(PathBuf::from).or(default)?;
        p.exists()
            .then(|| (var.to_string(), p.to_string_lossy().into_owned()))
    };
    Some(vec![
        pick(
            "LP_EXIFTOOL",
            Some(site.join("exiftool_bin").join("exiftool.exe")),
        )?,
        pick(
            "LP_FFMPEG",
            Some(site.join("ffmpeg_bin").join("bin").join("ffmpeg.exe")),
        )?,
        pick(
            "LP_FFPROBE",
            Some(site.join("ffmpeg_bin").join("bin").join("ffprobe.exe")),
        )?,
        pick("LP_VIPS_LIB", vips)?,
        pick(
            "LP_PYTHON",
            Some(Path::new(&venv).join("Scripts").join("python.exe")),
        )?,
    ])
}

fn psnr(a: &image::RgbImage, b: &image::RgbImage) -> f64 {
    assert_eq!(a.dimensions(), b.dimensions());
    let sq: f64 = a
        .as_raw()
        .iter()
        .zip(b.as_raw())
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum();
    let mse = sq / a.as_raw().len() as f64;
    10.0 * (255.0f64 * 255.0 / mse.max(1e-9)).log10()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scan_renders_raw_thumbnails_like_django() {
    let Some(g) = lp_ml::golden::load("raw_thumbnail", "big") else {
        return;
    };
    let Some(tools) = tools() else {
        eprintln!("ExifTool/ffmpeg/libvips not found; skipping");
        return;
    };
    let env: Vec<(&str, &str)> = tools
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let app = TestApp::with_env(&env).await;
    app.state
        .ml
        .set_mode(Service::RawThumbnail, Mode::InProcess);

    let user = app.create_user("rawscanner", "pw", false).await;
    let dir = app.base_path().join("data").join("rawscanner");
    std::fs::create_dir_all(&dir).unwrap();
    sqlx::query("UPDATE api_user SET scan_directory = $2 WHERE id = $1")
        .bind(user.id)
        .bind(dir.to_string_lossy().to_string())
        .execute(app.pool())
        .await
        .unwrap();
    let names = [
        "preview_ifd0",
        "preview_rot6",
        "no_preview",
        "no_preview_rot8",
        "small_sensor",
    ];
    let cases: Vec<_> = names
        .iter()
        .map(|n| g.cases.iter().find(|c| c.id == *n).unwrap())
        .collect();
    for c in &cases {
        let src = Path::new(c.input["path"].as_str().unwrap());
        std::fs::copy(src, dir.join(src.file_name().unwrap())).unwrap();
    }

    let job = Uuid::new_v4().to_string();
    let t = Instant::now();
    scan::scan_user(
        &Pipeline::new(app.state.clone()),
        user.id,
        &job,
        ScanOptions::default(),
    )
    .await
    .unwrap();
    println!("scan of {} DNGs: {:?}", cases.len(), t.elapsed());
    let (result,): (Option<serde_json::Value>,) =
        sqlx::query_as("SELECT result FROM api_longrunningjob WHERE job_id = $1")
            .bind(&job)
            .fetch_one(app.pool())
            .await
            .unwrap();
    let result = result.unwrap_or_default();
    assert_eq!(result["error_count"].as_i64().unwrap_or(0), 0, "{result}");

    let rows: Vec<(String, String, Option<f64>)> = sqlx::query_as(
        "SELECT p.image_hash, f.path, t.aspect_ratio FROM api_photo p \
         JOIN api_file f ON f.hash = p.main_file_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = $1",
    )
    .bind(user.id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(rows.len(), cases.len());
    let media = &app.state.config.media_root;
    let images = PathBuf::from(g.meta["images"].as_str().unwrap());
    for c in &cases {
        let (hash, _, aspect) = rows
            .iter()
            .find(|r| r.1.ends_with(&format!("{}.dng", c.id)))
            .unwrap_or_else(|| panic!("no photo for {}", c.id));
        let big = image::open(media.join("thumbnails_big").join(format!("{hash}.webp")))
            .unwrap()
            .to_rgb8();
        let want: Vec<u32> = serde_json::from_value(c.output["thumbnail_shape"].clone()).unwrap();
        assert_eq!((big.height(), big.width()), (want[0], want[1]), "{}", c.id);
        let py = image::open(images.join(format!("{}.py.png", c.id)))
            .unwrap()
            .to_rgb8();
        let p = psnr(&big, &py);
        println!(
            "{:18} {:7} {}x{} aspect {:?}: PSNR vs Django's thumbnail {p:.1} dB",
            c.id,
            c.output["choice"].as_str().unwrap(),
            big.width(),
            big.height(),
            aspect
        );
        assert!(p > 38.0, "{}: PSNR {p:.1}", c.id);
        let want_aspect = (want[1] as f64 / want[0] as f64 * 100.0).round() / 100.0;
        assert_eq!(*aspect, Some(want_aspect), "{}", c.id);
        for d in ["square_thumbnails", "square_thumbnails_small"] {
            assert!(media.join(d).join(format!("{hash}.webp")).exists(), "{d}");
        }
    }
    app.cleanup().await;
}
