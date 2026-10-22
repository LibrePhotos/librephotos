//! Face-region write-back (`save_face_tags_to_disk`): `/api/addface` and
//! `/api/labelfaces` queue `metadata.face_tags`, which writes MWG RegionInfo
//! (+ XMP:Subject) into the sidecar or the media file. The regions are read
//! back with ExifTool and mapped onto the thumbnail the way the scan's read
//! path (`face_extractor.to_face_box`) does, rotated photo included. Needs
//! ExifTool, ffmpeg and libvips (skipped without them).

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

use lp_jobs::{HandlerRegistry, JobCtx};
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
    ];
    Path::new(FIXTURE).exists().then_some(out)
}

/// `face_extractor.ORIENTATION_TRANSFORMS` + `to_face_box`: XMP region ->
/// `(top, right, bottom, left)` on a `w` x `h` thumbnail.
fn to_face_box(area: &Value, orientation: &str, w: f64, h: f64) -> [i64; 4] {
    let g = |k: &str| area[k].as_f64().unwrap();
    let (mut x, mut y, mut rw, mut rh) = (g("X"), g("Y"), g("W"), g("H"));
    (x, y, rw, rh) = match orientation {
        "Rotate 90 CW" | "Mirror horizontal and rotate 270 CW" => (1.0 - y, x, rh, rw),
        "Mirror horizontal" => (1.0 - x, y, rw, rh),
        "Rotate 180" => (1.0 - x, 1.0 - y, rw, rh),
        "Mirror vertical" => (x, 1.0 - y, rw, rh),
        "Mirror horizontal and rotate 90 CW" | "Rotate 270 CW" => (y, 1.0 - x, rh, rw),
        _ => (x, y, rw, rh),
    };
    let (hw, hh) = (rw * w / 2.0, rh * h / 2.0);
    [
        (y * h - hh) as i64,
        (x * w + hw) as i64,
        (y * h + hh) as i64,
        (x * w - hw) as i64,
    ]
}

async fn run_queued(app: &TestApp, kind: &str) -> bool {
    let mut conn = app.pool().acquire().await.unwrap();
    let Some(job) = lp_jobs::queue::claim_next(&mut conn, "face-tags-test", &[kind.to_string()])
        .await
        .unwrap()
    else {
        return false;
    };
    drop(conn);
    let mut reg = HandlerRegistry::new();
    lp_ingest::register_jobs(&mut reg);
    let handler = reg.get(kind).expect("registered").clone();
    handler(JobCtx {
        state: app.state.clone(),
        job,
    })
    .await
    .unwrap();
    true
}

async fn photo_of(app: &TestApp, path: &Path) -> (Uuid, String) {
    sqlx::query_as(
        "SELECT p.id, t.thumbnail_big FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         JOIN api_thumbnail t ON t.photo_id = p.id WHERE f.path = $1",
    )
    .bind(path.to_string_lossy().to_string())
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn read_regions(app: &TestApp, file: &Path, try_sidecar: bool) -> (Value, Value) {
    let v = app
        .state
        .exif
        .get_metadata(
            file,
            &["XMP:RegionInfo".to_string(), "XMP:Subject".to_string()],
            try_sidecar,
            true,
        )
        .await
        .unwrap();
    (
        v[0].clone().unwrap_or(Value::Null),
        v[1].clone().unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn face_regions_are_written_back_and_read_onto_the_same_face() {
    let Some(tools) = tools() else {
        eprintln!("ExifTool/ffmpeg/libvips or the fixture not found; skipping");
        return;
    };
    let env: Vec<(&str, &str)> = tools
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let app = TestApp::with_env(&env).await;
    let user = app.create_user("ft_user", "pw", false).await;
    let token = app.token_for(&user);
    let dir = app.base_path().join("data").join("ft_user");
    std::fs::create_dir_all(&dir).unwrap();
    let upright = dir.join("upright.jpg");
    let rotated = dir.join("rotated.jpg");
    std::fs::copy(Path::new(FIXTURE).join("states/hidden.jpg"), &upright).unwrap();
    std::fs::copy(Path::new(FIXTURE).join("states/no_timestamp.jpg"), &rotated).unwrap();
    app.state
        .exif
        .write_metadata(&rotated, &[("EXIF:Orientation".into(), json!(6))], false)
        .await
        .unwrap();
    sqlx::query("UPDATE api_user SET scan_directory = $2 WHERE id = $1")
        .bind(user.id)
        .bind(dir.to_string_lossy().to_string())
        .execute(app.pool())
        .await
        .unwrap();
    let pipeline = lp_ingest::Pipeline::new(app.state.clone());
    lp_ingest::scan::scan_user(
        &pipeline,
        user.id,
        &Uuid::new_v4().to_string(),
        lp_ingest::scan::ScanOptions {
            skip_followups: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let box_ = json!({"top": 0.2, "right": 0.7, "bottom": 0.6, "left": 0.4});
    let add = |photo: Uuid, name: &str| json!({"photo": photo.to_string(), "person_name": name, "box": box_});

    // Off: nothing is queued.
    let (up_id, up_thumb) = photo_of(&app, &upright).await;
    let res = app
        .post_json("/api/addface", &add(up_id, "Dora"), Some(&token))
        .await;
    assert_eq!(res.status, 201, "{}", res.text());
    let first_face = res.json()["face"]["face_id"].as_i64().unwrap();
    assert!(!run_queued(&app, "metadata.face_tags").await);
    let res = app
        .post_json(
            "/api/deletefaces",
            &json!({"face_ids": [first_face]}),
            Some(&token),
        )
        .await;
    assert_eq!(res.status, 200, "{}", res.text());

    sqlx::query(
        "UPDATE api_user SET save_face_tags_to_disk = TRUE, save_metadata_to_disk = 'SIDECAR_FILE' \
         WHERE id = $1",
    )
    .bind(user.id)
    .execute(app.pool())
    .await
    .unwrap();

    // Sidecar mode, upright photo.
    let res = app
        .post_json("/api/addface", &add(up_id, "Dora"), Some(&token))
        .await;
    assert_eq!(res.status, 201, "{}", res.text());
    let face = res.json()["face"].clone();
    assert!(run_queued(&app, "metadata.face_tags").await);
    let sidecar = dir.join("upright.xmp");
    assert!(sidecar.is_file(), "sidecar written");
    let (info, subject) = read_regions(&app, &upright, true).await;
    let list = info["RegionList"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["Name"], "Dora");
    assert_eq!(list[0]["Type"], "Face");
    assert_eq!(list[0]["Area"]["Unit"], "normalized");
    assert_eq!(subject, json!(["Dora"]));
    let (tw, th) = image::image_dimensions(app.state.config.media_root.join(&up_thumb)).unwrap();
    let loc = &face["location"];
    let want = ["top", "right", "bottom", "left"].map(|k| loc[k].as_i64().unwrap());
    let got = to_face_box(
        &list[0]["Area"],
        "Horizontal (normal)",
        tw as f64,
        th as f64,
    );
    for (g, w) in got.iter().zip(want) {
        assert!((g - w).abs() <= 1, "{got:?} vs {want:?}");
    }
    let dims = &info["AppliedToDimensions"];
    assert_eq!(dims["Unit"], "pixel");
    assert!(dims["W"].as_i64().unwrap() > 0);

    // Relabelling rewrites the name.
    let res = app
        .post_json(
            "/api/labelfaces",
            &json!({"face_ids": [face["face_id"]], "person_name": "Eve"}),
            Some(&token),
        )
        .await;
    assert_eq!(res.status, 200, "{}", res.text());
    assert!(run_queued(&app, "metadata.face_tags").await);
    let (info, subject) = read_regions(&app, &upright, true).await;
    assert_eq!(info["RegionList"][0]["Name"], "Eve");
    assert_eq!(subject, json!(["Eve"]));

    // Media-file mode, a photo shot in portrait (EXIF 6).
    sqlx::query("UPDATE api_user SET save_metadata_to_disk = 'MEDIA_FILE' WHERE id = $1")
        .bind(user.id)
        .execute(app.pool())
        .await
        .unwrap();
    let (rot_id, rot_thumb) = photo_of(&app, &rotated).await;
    let res = app
        .post_json("/api/addface", &add(rot_id, "Finn"), Some(&token))
        .await;
    assert_eq!(res.status, 201, "{}", res.text());
    let face = res.json()["face"].clone();
    assert!(run_queued(&app, "metadata.face_tags").await);
    assert!(!dir.join("rotated.xmp").exists(), "written into the file");
    let (info, _) = read_regions(&app, &rotated, false).await;
    let area = &info["RegionList"][0]["Area"];
    let (tw, th) = image::image_dimensions(app.state.config.media_root.join(&rot_thumb)).unwrap();
    assert!(th > tw, "the thumbnail is upright portrait");
    let loc = &face["location"];
    let want = ["top", "right", "bottom", "left"].map(|k| loc[k].as_i64().unwrap());
    let got = to_face_box(area, "Rotate 90 CW", tw as f64, th as f64);
    for (g, w) in got.iter().zip(want) {
        assert!((g - w).abs() <= 1, "rotated round trip {got:?} vs {want:?}");
    }
    // The stored region is in the sensor's (landscape) frame: not the box as shown.
    let shown = to_face_box(area, "Horizontal (normal)", tw as f64, th as f64);
    assert_ne!(shown, want);

    app.cleanup().await;
}

/// Parity hook (run by hand): write the face regions of `LP_FT_PHOTOS`
/// (comma-separated ids) on the existing database `LP_FT_DB`, media under
/// `LP_FT_BASE_DATA`, to diff against Django's `_save_metadata`.
#[tokio::test]
#[ignore]
async fn parity_write_face_tags() {
    let (Ok(db), Ok(ids), Ok(base)) = (
        std::env::var("LP_FT_DB"),
        std::env::var("LP_FT_PHOTOS"),
        std::env::var("LP_FT_BASE_DATA"),
    ) else {
        eprintln!("LP_FT_DB / LP_FT_PHOTOS / LP_FT_BASE_DATA not set");
        return;
    };
    let tools = tools().expect("tools");
    let mut env: Vec<(&str, &str)> = tools
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    env.push(("BASE_DATA", base.as_str()));
    let app = TestApp::attach(&db, &env).await;
    for id in ids.split(',') {
        let id: Uuid = id.trim().parse().unwrap();
        let t = std::time::Instant::now();
        let wrote = lp_ingest::face_tags::write_face_tags(&app.state, id)
            .await
            .unwrap();
        eprintln!("{id}: wrote={wrote} in {:?}", t.elapsed());
    }
}
