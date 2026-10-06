//! Library maintenance and follow-up jobs that need no media tools.

#![allow(clippy::disallowed_methods)]

use lp_ingest::Pipeline;
use lp_testkit::TestApp;
use uuid::Uuid;

async fn insert_missing_file(app: &TestApp, hash: &str) {
    sqlx::query("INSERT INTO api_file (hash, path, type, missing) VALUES ($1, $2, 1, TRUE)")
        .bind(hash)
        .bind(format!("C:/gone/{hash}.jpg"))
        .execute(app.pool())
        .await
        .unwrap();
}

async fn file_exists(app: &TestApp, hash: &str) -> bool {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM api_file WHERE hash = $1)")
        .bind(hash)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn delete_missing_photos_keeps_other_users_missing_files() {
    let app = TestApp::new().await;
    let user = app.create_user("mallory_dm", "pw", false).await;
    let own = format!("{}{}", "a".repeat(32), user.id);
    // Owner id "1<id>": its hash also ends with the user's id.
    let foreign = format!("{}1{}", "b".repeat(32), user.id);
    insert_missing_file(&app, &own).await;
    insert_missing_file(&app, &foreign).await;

    let p = Pipeline::new(app.state.clone());
    let job = Uuid::new_v4().to_string();
    lp_ingest::repair::delete_missing_photos(&p, user.id, &job)
        .await
        .unwrap();

    assert!(
        !file_exists(&app, &own).await,
        "the user's missing file goes"
    );
    assert!(
        file_exists(&app, &foreign).await,
        "another user's missing file stays"
    );
    app.cleanup().await;
}

async fn queued(app: &TestApp, kind: &str, user_id: i32) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM job_queue WHERE kind = $1 AND status = 'queued' \
         AND payload->>'user_id' = $2::text",
    )
    .bind(kind)
    .bind(user_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn uploads_share_one_queued_follow_up_per_kind() {
    let app = TestApp::with_env(&[
        ("FEATURE_SCENE_CLASSIFICATION", "1"),
        ("FEATURE_REVERSE_GEOCODING", "1"),
        ("FEATURE_FACE_DETECTION", "1"),
    ])
    .await;
    let user = app.create_user("uploader_fu", "pw", false).await;
    let p = Pipeline::new(app.state.clone());
    for _ in 0..3 {
        // The photo does not exist: processing logs the error and the
        // follow-ups are still queued, as after a failed handle_new_image.
        lp_ingest::upload::process_upload(&p, user.id, Uuid::new_v4(), None)
            .await
            .unwrap();
    }
    for kind in ["tags.generate", "geo.locate", "faces.scan"] {
        assert_eq!(queued(&app, kind, user.id).await, 1, "{kind}");
    }
    let lrjs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_longrunningjob WHERE started_by_id = $1")
            .bind(user.id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(lrjs, 3, "one job-page entry per kind");

    // Once a worker has taken it, the next upload needs a job of its own.
    sqlx::query("UPDATE job_queue SET status = 'running' WHERE kind = 'tags.generate'")
        .execute(app.pool())
        .await
        .unwrap();
    lp_ingest::upload::process_upload(&p, user.id, Uuid::new_v4(), None)
        .await
        .unwrap();
    assert_eq!(queued(&app, "tags.generate", user.id).await, 1);
    assert_eq!(queued(&app, "geo.locate", user.id).await, 1);
    app.cleanup().await;
}

#[tokio::test]
async fn a_known_hash_at_a_new_path_moves_the_file_row_like_django() {
    let app = TestApp::new().await;
    let user = app.create_user("copier_fc", "pw", false).await;
    let hash = format!("{}{}", "c".repeat(32), user.id);
    sqlx::query(
        "INSERT INTO api_file (hash, path, type, missing) VALUES ($1, 'C:/lib/a.jpg', 1, TRUE)",
    )
    .bind(&hash)
    .execute(app.pool())
    .await
    .unwrap();
    let mut conn = app.pool().acquire().await.unwrap();
    let f = lp_ingest::db::file_create(&mut conn, "C:/lib/copy/a.jpg", &hash, 1)
        .await
        .unwrap();
    assert_eq!((f.path.as_str(), f.missing), ("C:/lib/copy/a.jpg", false));
    let stored: (String, bool) =
        sqlx::query_as("SELECT path, missing FROM api_file WHERE hash = $1")
            .bind(&hash)
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(stored, ("C:/lib/copy/a.jpg".to_string(), false));
    drop(conn);
    app.cleanup().await;
}

#[tokio::test]
async fn the_last_file_group_queues_the_follow_ups_the_scan_stored() {
    use chrono::Utc;
    use lp_jobs::{JobCtx, QueuedJob};
    use serde_json::json;

    let app = TestApp::new().await;
    let user = app.create_user("fanout_fu", "pw", false).await;
    let job = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, \
           started_at, started_by_id, progress_current, progress_target, result) \
         VALUES (1, FALSE, FALSE, FALSE, $1, now(), now(), $2, 0, 1, $3)",
    )
    .bind(&job)
    .bind(user.id)
    .bind(json!({"followups": {"full_scan": true, "scan_missing_photos": false, "photo_count_before": 0}}))
    .execute(app.pool())
    .await
    .unwrap();
    let ctx = JobCtx {
        state: app.state.clone(),
        job: QueuedJob {
            id: 0,
            kind: "scan.file_group".into(),
            payload: json!({"user_id": user.id, "paths": []}),
            status: "running".into(),
            lrj_id: Some(job.clone()),
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
    };
    lp_ingest::jobs::scan_file_group(ctx).await.unwrap();

    let (finished, result): (bool, serde_json::Value) =
        sqlx::query_as("SELECT finished, result FROM api_longrunningjob WHERE job_id = $1")
            .bind(&job)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(finished);
    assert!(result.get("followups").is_none(), "{result}");
    let full: Option<bool> = sqlx::query_scalar(
        "SELECT (payload->>'full_scan')::bool FROM job_queue WHERE kind = 'tags.generate' \
         AND payload->>'user_id' = $1::text",
    )
    .bind(user.id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(full, Some(true));
    app.cleanup().await;
}

/// Django #2124: the missing-file check bumps `last_modified` only on a
/// photo that lost a file, so removed photos still age into
/// `cleanup_deleted_photos` (and sync does not see the whole library change).
#[tokio::test]
async fn scan_missing_photos_touches_only_photos_that_lost_a_file() {
    let app = TestApp::new().await;
    let bob: (i32,) = sqlx::query_as("SELECT id FROM api_user WHERE username = 'bob'")
        .fetch_one(app.pool())
        .await
        .unwrap();
    let photos: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT p.id, p.main_file_id FROM api_photo p WHERE p.owner_id = $1 ORDER BY p.id",
    )
    .bind(bob.0)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert!(photos.len() >= 3, "fixture bob has three photos");
    let (lost, intact, removed) = (&photos[0], &photos[1], &photos[2]);
    sqlx::query("UPDATE api_file SET path = 'C:/definitely/gone/x.jpg' WHERE hash = $1")
        .bind(&lost.1)
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE api_photo SET removed = (id = $2), last_modified = now() - interval '30 days' WHERE owner_id = $1")
        .bind(bob.0)
        .bind(removed.0)
        .execute(app.pool())
        .await
        .unwrap();
    let p = Pipeline::new(app.state.clone());
    lp_ingest::repair::scan_missing_photos(&p, bob.0, &Uuid::new_v4().to_string())
        .await
        .unwrap();
    let recent = |id: Uuid| {
        let pool = app.pool().clone();
        async move {
            sqlx::query_scalar::<_, bool>(
                "SELECT last_modified > now() - interval '1 hour' FROM api_photo WHERE id = $1",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert!(
        recent(lost.0).await,
        "the photo that lost its file is touched"
    );
    assert!(!recent(intact.0).await, "an intact photo is not");
    assert!(!recent(removed.0).await, "nor a removed one");
    let missing: bool = sqlx::query_scalar("SELECT missing FROM api_file WHERE hash = $1")
        .bind(&lost.1)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert!(missing);
    let deleted = lp_db::write::jobs_zip_services::cleanup_deleted_photos(
        app.pool(),
        &app.state.config.media_root,
        7,
    )
    .await
    .unwrap();
    assert_eq!(deleted, 1, "the removed photo ages into the cleanup");
    app.cleanup().await;
}
