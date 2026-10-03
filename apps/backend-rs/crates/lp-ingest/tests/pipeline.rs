//! End-to-end scan pipeline on a private database and a temp library built
//! from fixture files. Needs ExifTool, ffmpeg and libvips: taken from
//! LP_EXIFTOOL / LP_FFMPEG / LP_FFPROBE / LP_VIPS_LIB / LP_PYTHON, else from
//! the Django venv (`LP_TEST_VENV`); skipped when they cannot be found.

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

use chrono::Utc;
use lp_ingest::Pipeline;
use lp_ingest::scan::{self, ScanOptions};
use lp_jobs::{JobCtx, QueuedJob};
use lp_testkit::TestApp;
use serde_json::{Value, json};
use uuid::Uuid;

const FIXTURE: &str = "C:/Users/Niaz/librephotos/rust-pg/fixture/data/alice";

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
    let out = vec![
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
    ];
    Path::new(FIXTURE).exists().then_some(out)
}

async fn app_with_tools() -> Option<TestApp> {
    let Some(tools) = tools() else {
        eprintln!("ExifTool/ffmpeg/libvips or the fixture not found; skipping");
        return None;
    };
    let mut env: Vec<(&str, &str)> = tools
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    env.push(("WORKER_CONCURRENCY", "4"));
    Some(TestApp::with_env(&env).await)
}

fn copy(rel: &str, dest: &Path) {
    let to = dest.join(rel);
    std::fs::create_dir_all(to.parent().unwrap()).unwrap();
    std::fs::copy(Path::new(FIXTURE).join(rel), to).unwrap();
}

async fn library_user(app: &TestApp, name: &str) -> (i32, PathBuf) {
    let user = app.create_user(name, "pw", false).await;
    let dir = app.base_path().join("data").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    sqlx::query("UPDATE api_user SET scan_directory = $2 WHERE id = $1")
        .bind(user.id)
        .bind(dir.to_string_lossy().to_string())
        .execute(app.pool())
        .await
        .unwrap();
    (user.id, dir)
}

async fn scan(app: &TestApp, user: i32, full: bool) -> (String, i32, i32, Option<Value>) {
    let job = Uuid::new_v4().to_string();
    let p = Pipeline::new(app.state.clone());
    scan::scan_user(
        &p,
        user,
        &job,
        ScanOptions {
            full_scan: full,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let (current, target, result, finished): (i32, i32, Option<Value>, bool) = sqlx::query_as(
        "SELECT progress_current, progress_target, result, finished FROM api_longrunningjob WHERE job_id = $1",
    )
    .bind(&job)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(finished, "scan job finished");
    (job, current, target, result)
}

fn ctx(app: &TestApp, kind: &str, payload: Value) -> JobCtx {
    JobCtx {
        state: app.state.clone(),
        job: QueuedJob {
            id: 0,
            kind: kind.into(),
            payload,
            status: "running".into(),
            lrj_id: None,
            group_id: None,
            run_after: Utc::now(),
            attempts: 1,
            max_attempts: 1,
            locked_by: None,
            heartbeat_at: None,
            last_error: None,
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
        },
    }
}

#[derive(sqlx::FromRow, Debug)]
struct Row {
    image_hash: String,
    path: String,
    rating: i32,
    video: bool,
    is_screenshot: bool,
    exif_timestamp: Option<chrono::DateTime<Utc>>,
    video_length: Option<String>,
    perceptual_hash: Option<String>,
    aspect_ratio: Option<f64>,
    dominant_color: Option<String>,
    files: i64,
}

async fn photos(app: &TestApp, user: i32) -> Vec<Row> {
    sqlx::query_as(
        "SELECT p.image_hash, f.path, p.rating, p.video, p.is_screenshot, p.exif_timestamp, p.video_length, \
           p.perceptual_hash, t.aspect_ratio, t.dominant_color, \
           (SELECT count(*) FROM api_photo_files pf WHERE pf.photo_id = p.id) AS files \
         FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = $1 ORDER BY f.path",
    )
    .bind(user)
    .fetch_all(app.pool())
    .await
    .unwrap()
}

fn find<'a>(rows: &'a [Row], suffix: &str) -> &'a Row {
    rows.iter()
        .find(|r| r.path.ends_with(suffix))
        .unwrap_or_else(|| panic!("no photo {suffix}"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scan_rescan_replace_and_cleanup() {
    let Some(app) = app_with_tools().await else {
        return;
    };
    let (uid, dir) = library_user(&app, "scanner").await;
    for rel in [
        "e2e/e2e_01.jpg",
        "sidecar/xmp_photo.jpg",
        "sidecar/xmp_photo.xmp",
        "Screenshots/Screenshot_20240115-093000.png",
        "formats/clip.mp4",
        "raw/DSC_0001.jpg",
        "raw/DSC_0001.dng",
        "names/Straße ☀ 東京.jpg",
    ] {
        copy(rel, &dir);
    }
    std::fs::write(dir.join("notes.txt"), "not media").unwrap();
    std::fs::write(dir.join(".hidden.jpg"), "hidden").unwrap();

    let (_, current, target, result) = scan(&app, uid, false).await;
    assert_eq!((current, target), (7, 7));
    let result = result.unwrap();
    assert_eq!(result["error_count"], 1, "{result}");
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .starts_with("No valid files in group: ['")
    );
    assert_eq!(result["status"], "partial_failure");

    let rows = photos(&app, uid).await;
    assert_eq!(rows.len(), 6);
    for r in &rows {
        assert!(r.aspect_ratio.is_some(), "{r:?}");
        assert_eq!(
            r.perceptual_hash.as_ref().map(String::len),
            Some(16),
            "{r:?}"
        );
        let big = app
            .state
            .config
            .media_root
            .join("thumbnails_big")
            .join(format!("{}.webp", r.image_hash));
        assert!(big.exists(), "{}", big.display());
    }
    let e2e = find(&rows, "e2e_01.jpg");
    assert_eq!(
        e2e.perceptual_hash.as_deref(),
        Some("c5113a6fc5103b6f"),
        "same pHash as Django"
    );
    assert_eq!(e2e.rating, 0);
    assert_eq!(e2e.aspect_ratio, Some(1.33));
    assert!(e2e.dominant_color.is_some());
    let xmp = find(&rows, "xmp_photo.jpg");
    assert_eq!((xmp.rating, xmp.files), (4, 2), "rating from the sidecar");
    let shot = find(&rows, "Screenshot_20240115-093000.png");
    assert!(shot.is_screenshot);
    assert_eq!(
        shot.exif_timestamp.unwrap().to_rfc3339(),
        "2024-01-15T09:30:00+00:00"
    );
    let clip = find(&rows, "clip.mp4");
    assert!(clip.video);
    assert_eq!(clip.video_length.as_deref(), Some("2"));
    assert!(
        app.state
            .config
            .media_root
            .join("square_thumbnails_small")
            .join(format!("{}.mp4", clip.image_hash))
            .exists()
    );
    let raw = find(&rows, "DSC_0001.jpg");
    assert_eq!(raw.files, 2, "RAW + JPEG grouped");
    let unicode = find(&rows, "東京.jpg");
    assert_eq!(
        unicode.exif_timestamp.unwrap().to_rfc3339(),
        "2021-04-01T12:00:00+00:00"
    );

    let (keywords, caption, tags): (Value, Option<Value>, i64) = sqlx::query_as(
        "SELECT m.keywords, c.captions_json, (SELECT count(*) FROM api_tag WHERE owner_id = $1) \
         FROM api_photo p JOIN api_photometadata m ON m.photo_id = p.id \
         LEFT JOIN api_photo_caption c ON c.photo_id = p.id WHERE p.image_hash = $2",
    )
    .bind(uid)
    .bind(&xmp.image_hash)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(keywords, json!(["Fixture", "sidecar-keyword"]));
    assert_eq!(
        caption.unwrap()["user_caption"],
        "Described in an XMP sidecar"
    );
    assert_eq!(tags, 2);
    let search: String = sqlx::query_scalar(
        "SELECT s.search_captions FROM api_photo_search s JOIN api_photo p ON p.id = s.photo_id WHERE p.image_hash = $1",
    )
    .bind(&shot.image_hash)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(search.ends_with("type: screenshot"), "{search}");
    let albums: i64 = sqlx::query_scalar("SELECT count(*) FROM api_albumdate WHERE owner_id = $1")
        .bind(uid)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert!(albums >= 5);
    let queued: Vec<String> = sqlx::query_scalar("SELECT kind FROM job_queue ORDER BY id")
        .fetch_all(app.pool())
        .await
        .unwrap();
    assert!(
        queued.contains(&"repair.file_variants".to_string()),
        "{queued:?}"
    );
    assert!(queued.contains(&"clip.embed".to_string()), "{queued:?}");

    // Nothing changed: an incremental scan has nothing to do but the
    // file that is not media.
    let (_, _, target, _) = scan(&app, uid, false).await;
    assert_eq!(target, 1);

    // Replace e2e_01 in place with another picture: re-keyed, same Photo.
    let e2e_path = dir.join("e2e").join("e2e_01.jpg");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    // fs::write, not fs::copy: a copy keeps the source's mtime on Windows.
    std::fs::write(
        &e2e_path,
        std::fs::read(Path::new(FIXTURE).join("e2e/e2e_02.jpg")).unwrap(),
    )
    .unwrap();
    let before: Uuid = sqlx::query_scalar("SELECT id FROM api_photo WHERE image_hash = $1")
        .bind(&e2e.image_hash)
        .fetch_one(app.pool())
        .await
        .unwrap();
    scan(&app, uid, false).await;
    let new_hash = lp_ingest::fsutil::calculate_hash(&e2e_path, uid).unwrap();
    let after: String = sqlx::query_scalar("SELECT image_hash FROM api_photo WHERE id = $1")
        .bind(before)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(after, new_hash);
    let old_thumb = app
        .state
        .config
        .media_root
        .join("thumbnails_big")
        .join(format!("{}.webp", e2e.image_hash));
    assert!(!old_thumb.exists(), "old thumbnails deleted");

    // A file disappears: the missing-file check unlinks it, then
    // delete.missing_photos removes the photo.
    std::fs::remove_file(dir.join("names").join("Straße ☀ 東京.jpg")).unwrap();
    let p = Pipeline::new(app.state.clone());
    lp_ingest::repair::scan_missing_photos(&p, uid, &Uuid::new_v4().to_string())
        .await
        .unwrap();
    let missing: bool = sqlx::query_scalar("SELECT missing FROM api_file WHERE hash = $1")
        .bind(&unicode.image_hash)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert!(missing);
    lp_ingest::jobs::delete_missing_photos(ctx(
        &app,
        "delete.missing_photos",
        json!({"user_id": uid}),
    ))
    .await
    .unwrap();
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM api_photo WHERE owner_id = $1")
        .bind(uid)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(left, 5);
    app.cleanup().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn jobs_rerender_metadata_write_and_upload_processing() {
    let Some(app) = app_with_tools().await else {
        return;
    };
    let (uid, dir) = library_user(&app, "jobs").await;
    copy("e2e/e2e_03.jpg", &dir);
    scan(&app, uid, false).await;
    let (photo, hash): (Uuid, String) =
        sqlx::query_as("SELECT id, image_hash FROM api_photo WHERE owner_id = $1")
            .bind(uid)
            .fetch_one(app.pool())
            .await
            .unwrap();

    // thumbnails.rerender rebuilds deleted thumbnails.
    let small = app
        .state
        .config
        .media_root
        .join("square_thumbnails_small")
        .join(format!("{hash}.webp"));
    std::fs::remove_file(&small).unwrap();
    lp_ingest::jobs::thumbnails_rerender(ctx(
        &app,
        "thumbnails.rerender",
        json!({"photo_id": photo}),
    ))
    .await
    .unwrap();
    assert!(small.exists());

    // metadata.write: rating to the XMP sidecar when the owner asks for it.
    sqlx::query("UPDATE api_user SET save_metadata_to_disk = 'SIDECAR_FILE' WHERE id = $1")
        .bind(uid)
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE api_photo SET rating = 3 WHERE id = $1")
        .bind(photo)
        .execute(app.pool())
        .await
        .unwrap();
    lp_ingest::jobs::metadata_write(ctx(
        &app,
        "metadata.write",
        json!({"photo_id": photo, "fields": ["rating"]}),
    ))
    .await
    .unwrap();
    let sidecar = dir.join("e2e").join("e2e_03.xmp");
    assert!(sidecar.exists());
    let v = app
        .state
        .exif
        .get_tag("XMP:Rating", &sidecar, false)
        .await
        .unwrap();
    assert_eq!(v, Some(json!(3)));

    // upload.process: an EXIF-less upload takes the device's timestamp.
    let png = dir.join("uploads").join("web").join("plain.png");
    std::fs::create_dir_all(png.parent().unwrap()).unwrap();
    std::fs::copy(Path::new(FIXTURE).join("formats/plain.png"), &png).unwrap();
    let p = Pipeline::new(app.state.clone());
    let created = lp_ingest::upload::create_new_image(&p, uid, &png)
        .await
        .unwrap()
        .unwrap();
    lp_ingest::jobs::upload_process(ctx(
        &app,
        "upload.process",
        json!({"user_id": uid, "photo_id": created, "device_created_at": "2023-05-06T07:08:09Z"}),
    ))
    .await
    .unwrap();
    let (ts, exif_ts, aspect): (
        Option<chrono::DateTime<Utc>>,
        Option<chrono::DateTime<Utc>>,
        Option<f64>,
    ) = sqlx::query_as(
        "SELECT p.timestamp, p.exif_timestamp, t.aspect_ratio FROM api_photo p \
             JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.id = $1",
    )
    .bind(created)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(ts.unwrap().to_rfc3339(), "2023-05-06T07:08:09+00:00");
    assert_eq!(exif_ts, ts);
    assert_eq!(aspect, Some(1.33));
    app.cleanup().await;
}
