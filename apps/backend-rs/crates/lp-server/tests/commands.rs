//! The `manage.py` command ports (`lp_server::commands`, `admin`): what
//! each one queues, writes or deletes, and what it prints.

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

use lp_server::commands::{self, SaveMetadataArgs, ScanMode};
use lp_testkit::TestApp;
use serde_json::{Value, json};
use uuid::Uuid;

const FIXTURE_JPEG: &str =
    "C:/Users/Niaz/librephotos/rust-pg/fixture/data/alice/trips/berlin_01.jpg";

fn exiftool() -> Option<String> {
    if let Ok(p) = std::env::var("LP_EXIFTOOL") {
        return Some(p);
    }
    let venv = std::env::var("LP_TEST_VENV")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win".into());
    let p = Path::new(&venv)
        .join("Lib/site-packages/exiftool_bin/exiftool.exe")
        .to_string_lossy()
        .into_owned();
    Path::new(&p).exists().then_some(p)
}

fn text(buf: &[u8]) -> String {
    String::from_utf8_lossy(buf).into_owned()
}

async fn queued(app: &TestApp, kind: &str) -> Vec<Value> {
    sqlx::query_scalar("SELECT payload FROM job_queue WHERE kind = $1 ORDER BY id")
        .bind(kind)
        .fetch_all(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn createuser_creates_a_plain_user_and_updates_on_request() {
    let app = TestApp::new().await;
    let created = lp_server::admin::createuser(
        &app.state,
        "NewUser",
        "new@example.com",
        Some("first-pw".into()),
        false,
        false,
    )
    .await
    .unwrap();
    assert!(matches!(
        created,
        lp_server::admin::Outcome::Created {
            generated_password: None,
            ..
        }
    ));
    let user = lp_db::users::by_username(app.pool(), "newuser")
        .await
        .unwrap()
        .expect("lower-cased username");
    assert!(!user.is_staff && !user.is_superuser);
    assert!(lp_auth::password::verify("first-pw", &user.password));

    let again =
        lp_server::admin::createuser(&app.state, "newuser", "x@example.com", None, false, false)
            .await;
    assert_eq!(
        again.err().unwrap().to_string(),
        "Specified user already exists"
    );
    lp_server::admin::createuser(
        &app.state,
        "newuser",
        "x@example.com",
        Some("second-pw".into()),
        true,
        false,
    )
    .await
    .unwrap();
    let user = lp_db::users::by_username(app.pool(), "newuser")
        .await
        .unwrap()
        .unwrap();
    assert!(lp_auth::password::verify("second-pw", &user.password));
    assert_eq!(user.email, "new@example.com", "--update ignores the email");

    let bad =
        lp_server::admin::createuser(&app.state, "other", "not-an-email", None, false, false).await;
    assert_eq!(
        bad.err().unwrap().to_string(),
        "Enter a valid email address."
    );

    let generated =
        lp_server::admin::createuser(&app.state, "admin2", "a@example.com", None, false, true)
            .await
            .unwrap();
    let lp_server::admin::Outcome::Created {
        generated_password: Some(pw),
        ..
    } = generated
    else {
        panic!("expected a generated password");
    };
    let admin = lp_db::users::by_username(app.pool(), "admin2")
        .await
        .unwrap()
        .unwrap();
    assert!(admin.is_staff && admin.is_superuser);
    assert!(lp_auth::password::verify(&pw, &admin.password));
    app.cleanup().await;
}

#[tokio::test]
async fn scan_queues_one_job_per_user_like_django() {
    let app = TestApp::new().await;
    sqlx::query("DELETE FROM job_queue")
        .execute(app.pool())
        .await
        .unwrap();
    let dirs: Vec<(i32, String, String)> = sqlx::query_as(
        "SELECT id, username, scan_directory FROM api_user WHERE username <> 'deleted' ORDER BY id",
    )
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert!(dirs.len() >= 5);

    // Default: every user but `deleted`, plain scan.
    let mut out = Vec::new();
    let q = commands::scan(
        &app.state,
        &ScanMode::Directory { full_scan: false },
        &mut out,
    )
    .await
    .unwrap();
    assert_eq!(
        q.iter().map(|q| q.user_id).collect::<Vec<_>>(),
        dirs.iter().map(|d| d.0).collect::<Vec<_>>()
    );
    let payloads = queued(&app, "scan.user").await;
    assert_eq!(payloads.len(), dirs.len());
    assert_eq!(payloads[0]["full_scan"], json!(false));
    assert!(q.iter().all(|q| q.lrj_id.is_some()));
    let lrj_type: i32 =
        sqlx::query_scalar("SELECT job_type FROM api_longrunningjob WHERE job_id = $1")
            .bind(q[0].lrj_id.as_deref().unwrap())
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(lrj_type, lp_jobs::JobType::ScanPhotos.as_i32());
    assert!(text(&out).contains("Queued scan for user"));

    // -f
    sqlx::query("DELETE FROM job_queue")
        .execute(app.pool())
        .await
        .unwrap();
    commands::scan(
        &app.state,
        &ScanMode::Directory { full_scan: true },
        &mut Vec::new(),
    )
    .await
    .unwrap();
    assert!(
        queued(&app, "scan.user")
            .await
            .iter()
            .all(|p| p["full_scan"] == json!(true))
    );

    // -s: each file goes to the users whose scan directory prefixes it.
    sqlx::query("DELETE FROM job_queue")
        .execute(app.pool())
        .await
        .unwrap();
    let (alice_id, _, alice_dir) = dirs.iter().find(|d| d.1 == "alice").unwrap().clone();
    let (bob_id, _, bob_dir) = dirs.iter().find(|d| d.1 == "bob").unwrap().clone();
    let a = format!("{alice_dir}/trips/berlin_01.jpg");
    let b = format!("{bob_dir}/bob_own_01.jpg");
    let q = commands::scan(
        &app.state,
        &ScanMode::Files(vec![a.clone(), b.clone(), "/elsewhere/x.jpg".into()]),
        &mut Vec::new(),
    )
    .await
    .unwrap();
    let mut got: Vec<(i32, Vec<String>)> = q.into_iter().map(|q| (q.user_id, q.files)).collect();
    got.sort();
    let mut want = vec![(alice_id, vec![a.clone()]), (bob_id, vec![b])];
    want.sort();
    assert_eq!(got, want);
    let payloads = queued(&app, "scan.user").await;
    assert!(payloads.iter().any(|p| p["files"] == json!([a])));

    // -n: users without a Nextcloud directory are skipped with a message.
    sqlx::query("UPDATE api_user SET nextcloud_scan_directory = '/Photos' WHERE id = $1")
        .bind(alice_id)
        .execute(app.pool())
        .await
        .unwrap();
    let mut out = Vec::new();
    let q = commands::scan(&app.state, &ScanMode::Nextcloud, &mut out)
        .await
        .unwrap();
    assert_eq!(q.len(), 1);
    assert_eq!(q[0].kind, lp_tasks::nextcloud::KIND);
    let out = text(&out);
    assert!(out.contains("Starting nextcloud scan for user alice."));
    assert!(out.contains("Skipping nextcloud scan for user bob. No scan directory configured."));
    app.cleanup().await;
}

#[tokio::test]
async fn delete_expired_uploads_removes_rows_and_staged_files() {
    let app = TestApp::new().await;
    let user = app.create_user("uploader", "pw", false).await;
    let dir = app.state.config.chunked_uploads_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let mut files = Vec::new();
    for (name, age_hours, status) in [("old-done", 30, 2i16), ("old-part", 49, 1), ("fresh", 2, 1)]
    {
        let id = Uuid::new_v4().simple().to_string();
        let rel = format!("chunked_uploads/{id}.part");
        std::fs::write(app.state.config.media_root.join(&rel), b"chunk").unwrap();
        sqlx::query(
            "INSERT INTO chunked_upload_chunkedupload (upload_id, file, filename, \"offset\", \
               created_on, status, user_id) \
             VALUES ($1, $2, $3, 5, now() - make_interval(hours => $4), $5, $6)",
        )
        .bind(&id)
        .bind(&rel)
        .bind(name)
        .bind(age_hours)
        .bind(status)
        .bind(user.id)
        .execute(app.pool())
        .await
        .unwrap();
        files.push(app.state.config.media_root.join(rel));
    }

    // --interactive, declining everything: nothing goes.
    let mut asked = Vec::new();
    let mut no = |label: &str| {
        asked.push(label.to_string());
        false
    };
    let n = commands::delete_expired_uploads(&app.state, Some(&mut no), &mut Vec::new())
        .await
        .unwrap();
    assert_eq!((n.complete, n.incomplete), (0, 0));
    assert_eq!(asked.len(), 2);
    assert!(
        asked[0].starts_with("<old-done - upload_id: "),
        "{}",
        asked[0]
    );
    assert!(files.iter().all(|f| f.exists()));

    let mut out = Vec::new();
    let n = commands::delete_expired_uploads(&app.state, None, &mut out)
        .await
        .unwrap();
    assert_eq!((n.complete, n.incomplete), (1, 1));
    assert_eq!(
        text(&out),
        "1 complete uploads were deleted.\n1 incomplete uploads were deleted.\n"
    );
    assert!(!files[0].exists() && !files[1].exists());
    assert!(files[2].exists(), "a fresh upload stays");
    let left: Vec<String> =
        sqlx::query_scalar("SELECT filename FROM chunked_upload_chunkedupload WHERE user_id = $1")
            .bind(user.id)
            .fetch_all(app.pool())
            .await
            .unwrap();
    assert_eq!(left, vec!["fresh"]);
    app.cleanup().await;
}

/// A photo of a fresh user whose main file is a temp copy of a fixture
/// JPEG, so writes never touch the shared fixture.
async fn photo_with_temp_file(app: &TestApp, owner: i32, tmp: &Path) -> (Uuid, PathBuf) {
    let (id, hash): (Uuid, String) = sqlx::query_as(
        "SELECT p.id, p.main_file_id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         WHERE f.path LIKE '%berlin_01.jpg' LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    let copy = tmp.join("berlin_copy.jpg");
    std::fs::copy(FIXTURE_JPEG, &copy).unwrap();
    sqlx::query("UPDATE api_file SET path = $2 WHERE hash = $1")
        .bind(&hash)
        .bind(copy.to_string_lossy().to_string())
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE api_photo SET owner_id = $2, rating = 4 WHERE id = $1")
        .bind(id)
        .bind(owner)
        .execute(app.pool())
        .await
        .unwrap();
    (id, copy)
}

#[tokio::test]
async fn save_metadata_writes_ratings_to_sidecars() {
    let Some(exiftool) = exiftool() else {
        eprintln!("skipped: no exiftool");
        return;
    };
    if !Path::new(FIXTURE_JPEG).exists() {
        eprintln!("skipped: no fixture");
        return;
    }
    let app = TestApp::with_env(&[("LP_EXIFTOOL", &exiftool)]).await;
    let owner = app.create_user("meta", "pw", false).await;
    let tmp = tempfile::tempdir().unwrap();
    let (_, copy) = photo_with_temp_file(&app, owner.id, tmp.path()).await;

    let args = SaveMetadataArgs {
        types: vec!["ratings".into()],
        user: Some("meta".into()),
        media_file: false,
        dry_run: true,
    };
    let mut out = Vec::new();
    commands::save_metadata(&app.state, &args, &mut out, &mut Vec::new())
        .await
        .unwrap();
    assert_eq!(
        text(&out),
        "Found 1 photos to process (types: ['ratings'])\nDry run — no files will be modified\n"
    );
    let sidecar = tmp.path().join("berlin_copy.xmp");
    assert!(!sidecar.exists());

    let mut out = Vec::new();
    let outcome = commands::save_metadata(
        &app.state,
        &SaveMetadataArgs {
            dry_run: false,
            ..args.clone()
        },
        &mut out,
        &mut Vec::new(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!((outcome.written, outcome.errors), (1, 0));
    assert!(text(&out).ends_with("Done. 1 written, 0 errors out of 1 photos.\n"));
    assert!(sidecar.exists(), "ratings go to the XMP sidecar by default");
    let rating = app
        .state
        .exif
        .get_metadata(&sidecar, &["XMP:Rating".to_string()], false, false)
        .await
        .unwrap();
    assert_eq!(rating[0], Some(json!(4)));

    // Unknown user: an error line, no failure.
    let mut err = Vec::new();
    let none = commands::save_metadata(
        &app.state,
        &SaveMetadataArgs {
            user: Some("nobody".into()),
            ..args.clone()
        },
        &mut Vec::new(),
        &mut err,
    )
    .await
    .unwrap();
    assert!(none.is_none());
    assert_eq!(text(&err), "User 'nobody' not found\n");

    // The API view: the requester's photos, sidecar per their setting.
    sqlx::query("UPDATE api_user SET save_metadata_to_disk = 'SIDECAR_FILE' WHERE id = $1")
        .bind(owner.id)
        .execute(app.pool())
        .await
        .unwrap();
    std::fs::remove_file(&sidecar).unwrap();
    let token = app.token_for(&owner);
    let res = app
        .post_json("/api/savemetadata/", &json!({}), Some(&token))
        .await;
    assert_eq!(res.status, 200, "{}", res.text());
    assert_eq!(
        res.json(),
        json!({"status": true, "written": 1, "errors": 0})
    );
    assert!(sidecar.exists());
    let res = app
        .post_json(
            "/api/savemetadata",
            &json!({"types": ["face_tags"]}),
            Some(&token),
        )
        .await;
    // berlin_01 carries Anna's (user-labelled) face in the fixture, so it is
    // selected and counted; its thumbnail is not under this test's
    // MEDIA_ROOT, so like Django (`Cannot open thumbnail`) nothing is written.
    assert_eq!(
        res.json(),
        json!({"status": true, "written": 1, "errors": 0})
    );
    // Another user without labelled faces: nothing selected.
    let other = app.create_user("nofaces", "pw", false).await;
    let res = app
        .post_json(
            "/api/savemetadata",
            &json!({"types": ["face_tags"]}),
            Some(&app.token_for(&other)),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "written": 0, "errors": 0})
    );
    let anon = app.post_json("/api/savemetadata", &json!({}), None).await;
    assert_eq!(anon.status, 401);
    drop(copy);
    app.cleanup().await;
}

#[tokio::test]
async fn clear_cache_and_similarity_index() {
    let app = TestApp::new().await;
    let mut out = Vec::new();
    commands::clear_cache(&mut out).unwrap();
    assert_eq!(text(&out), "Your cache has been cleared!\n");
    sqlx::query("DELETE FROM job_queue")
        .execute(app.pool())
        .await
        .unwrap();
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM api_user")
        .fetch_one(app.pool())
        .await
        .unwrap();
    let n = commands::build_similarity_index(&app.state, &mut Vec::new())
        .await
        .unwrap();
    assert_eq!(n as i64, users);
    assert_eq!(queued(&app, "similarity.build").await.len() as i64, users);
    app.cleanup().await;
}

#[tokio::test]
async fn strip_thumbnail_metadata_reports_and_strips() {
    let app = TestApp::new().await;
    let big = app.state.config.media_root.join("thumbnails_big");
    std::fs::create_dir_all(&big).unwrap();
    // RIFF/WEBP with a VP8 chunk and an EXIF chunk.
    let mut body = b"WEBP".to_vec();
    for (cc, payload) in [(b"VP8 ", &b"px"[..]), (b"EXIF", &b"gps!"[..])] {
        body.extend_from_slice(cc);
        body.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        body.extend_from_slice(payload);
    }
    let mut file = b"RIFF".to_vec();
    file.extend_from_slice(&(body.len() as u32).to_le_bytes());
    file.extend_from_slice(&body);
    std::fs::write(big.join("x.webp"), &file).unwrap();

    let mut out = Vec::new();
    commands::strip_thumbnail_metadata(&app.state, true, &mut out, &mut Vec::new())
        .await
        .unwrap();
    assert_eq!(text(&out), "Scanned 1 thumbnails, 1 carried metadata.\n");
    let mut out = Vec::new();
    let r = commands::strip_thumbnail_metadata(&app.state, false, &mut out, &mut Vec::new())
        .await
        .unwrap();
    assert_eq!(r.stripped, 1);
    assert_eq!(
        text(&out),
        "Scanned 1 thumbnails, 1 carried metadata.\nStripped 1 thumbnails.\n"
    );
    assert!(!lp_ingest::thumbnail_metadata::webp_has_metadata(&big.join("x.webp")).unwrap());
    app.cleanup().await;
}
