//! Area `jobs_zip_services` end to end on the fixture: the jobs page,
//! `/rqavailable/`, the job-starting buttons, zip downloads (with the real
//! `zip.build` handler) and the services page.

#![allow(clippy::disallowed_methods)]

use std::collections::BTreeSet;
use std::io::Read;
use std::time::{Duration, Instant};

use lp_db::users::User;
use lp_jobs::{HandlerRegistry, Worker, WorkerTiming};
use lp_testkit::TestApp;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

async fn fixture_user(app: &TestApp, name: &str) -> (User, String) {
    let u = lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("fixture user {name}"));
    let t = app.token_for(&u);
    (u, t)
}

fn keys(v: &Value) -> Vec<String> {
    v.as_object().unwrap().keys().cloned().collect()
}

const JOB_FIELDS: [&str; 15] = [
    "job_id",
    "queued_at",
    "finished",
    "finished_at",
    "started_at",
    "failed",
    "cancelled",
    "job_type_str",
    "job_type",
    "started_by",
    "progress_current",
    "progress_target",
    "progress_step",
    "result",
    "id",
];

#[tokio::test]
async fn jobs_list_is_scoped_paged_and_shaped() {
    let app = TestApp::shared().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let (_, admin) = fixture_user(&app, "admin").await;

    let res = app.get("/api/jobs/?page_size=10&page=1", Some(&at)).await;
    assert_eq!(res.status, 200, "{}", res.text());
    let body = res.json();
    assert_eq!(keys(&body), ["count", "next", "previous", "results"]);
    let results = body["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(
        results
            .iter()
            .all(|j| j["started_by"]["id"] == json!(alice.id))
    );
    assert_eq!(keys(&results[0]), JOB_FIELDS);
    assert_eq!(
        keys(&results[0]["started_by"]),
        ["id", "username", "first_name", "last_name"]
    );
    let alice_count = body["count"].as_i64().unwrap();

    let all = app.get("/api/jobs/?page_size=2", Some(&admin)).await.json();
    assert!(all["count"].as_i64().unwrap() > alice_count);
    assert_eq!(all["results"].as_array().unwrap().len(), 2);
    let next = all["next"].as_str().unwrap();
    assert!(next.ends_with("/api/jobs/?page=2&page_size=2"), "{next}");
    assert!(all["previous"].is_null());
    // started_at DESC with NULLs first, as Postgres sorts Django's `-started_at`.
    let starts: Vec<Option<String>> = app
        .get("/api/jobs/?page_size=50", Some(&admin))
        .await
        .json()["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["started_at"].as_str().map(str::to_string))
        .collect();
    let first_non_null = starts.iter().position(Option::is_some).unwrap_or(0);
    assert!(starts[first_non_null..].iter().all(Option::is_some));

    let mine = app
        .get("/api/jobs/?page_size=50&mine=true", Some(&admin))
        .await
        .json();
    let admin_id = mine["results"][0]["started_by"]["id"].clone();
    assert!(
        mine["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|j| j["started_by"]["id"] == admin_id)
    );
    // ?mine never widens a non-staff view.
    let alice_false = app
        .get("/api/jobs/?page_size=50&mine=false", Some(&at))
        .await
        .json();
    // (Other tests in this binary add alice jobs concurrently: compare owners, not counts.)
    assert!(
        alice_false["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|j| j["started_by"]["id"] == json!(alice.id))
    );
    assert!(alice_false["count"].as_i64().unwrap() >= alice_count);

    assert_eq!(app.get("/api/jobs/?page=0", Some(&at)).await.status, 404);
    assert_eq!(app.get("/api/jobs/?page=999", Some(&at)).await.status, 404);
    assert_eq!(app.get("/api/jobs/", None).await.status, 401);
    app.cleanup().await;
}

#[tokio::test]
async fn job_detail_is_owner_or_staff_only() {
    let app = TestApp::shared().await;
    let (_, at) = fixture_user(&app, "alice").await;
    let (_, bt) = fixture_user(&app, "bob").await;
    let (_, admin) = fixture_user(&app, "admin").await;
    let id: i32 = sqlx::query_scalar(
        "SELECT j.id FROM api_longrunningjob j JOIN api_user u ON u.id = j.started_by_id \
         WHERE u.username = 'alice' ORDER BY j.id LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    let res = app.get(&format!("/api/jobs/{id}/"), Some(&at)).await;
    assert_eq!(res.status, 200);
    assert_eq!(keys(&res.json()), JOB_FIELDS);
    assert_eq!(
        app.get(&format!("/api/jobs/{id}/"), Some(&admin))
            .await
            .status,
        200
    );
    assert_eq!(
        app.get(&format!("/api/jobs/{id}/"), Some(&bt)).await.status,
        404
    );
    assert_eq!(app.get("/api/jobs/abc/", Some(&at)).await.status, 404);
    assert_eq!(app.get(&format!("/api/jobs/{id}/"), None).await.status, 401);
    app.cleanup().await;
}

#[tokio::test]
async fn rqavailable_shows_the_job_only_to_its_starter_and_staff() {
    let app = TestApp::new().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let (_, bt) = fixture_user(&app, "bob").await;
    let (_, admin) = fixture_user(&app, "admin").await;
    // Only one unfinished, recent job: alice's, started now.
    sqlx::query("UPDATE api_longrunningjob SET finished = TRUE WHERE NOT finished")
        .execute(app.pool())
        .await
        .unwrap();
    let res = app.get("/api/rqavailable/", Some(&bt)).await.json();
    assert_eq!(
        res,
        json!({"status": true, "queue_can_accept_job": true, "job_detail": null})
    );
    let job_id = lp_jobs::lrj::create(app.pool(), lp_jobs::JobType::ScanPhotos, alice.id)
        .await
        .unwrap();
    lp_jobs::lrj::start(app.pool(), &job_id, Some(5))
        .await
        .unwrap();

    let res = app.get("/api/rqavailable/", Some(&bt)).await.json();
    assert_eq!(res["queue_can_accept_job"], false);
    assert!(res["job_detail"].is_null());
    assert!(!res.to_string().contains("alice"));
    for t in [&at, &admin] {
        let res = app.get("/api/rqavailable/", Some(t)).await.json();
        assert_eq!(keys(&res), ["status", "queue_can_accept_job", "job_detail"]);
        assert_eq!(res["job_detail"]["job_id"], json!(job_id));
        assert_eq!(keys(&res["job_detail"]), JOB_FIELDS);
    }
    // A row stuck for more than 24 h no longer blocks the queue.
    sqlx::query(
        "UPDATE api_longrunningjob SET started_at = now() - interval '25 hours' WHERE job_id = $1",
    )
    .bind(&job_id)
    .execute(app.pool())
    .await
    .unwrap();
    let res = app.get("/api/rqavailable/", Some(&at)).await.json();
    assert_eq!(res["queue_can_accept_job"], true);
    assert_eq!(app.get("/api/rqavailable/", None).await.status, 401);
    app.cleanup().await;
}

#[tokio::test]
async fn cancel_and_delete_jobs() {
    let app = TestApp::new().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let (_, bt) = fixture_user(&app, "bob").await;
    let e = lp_jobs::enqueue(
        &app.state,
        "scan.user",
        json!({"user_id": alice.id}),
        lp_jobs::EnqueueOptions::tracked(lp_jobs::JobType::ScanPhotos, alice.id),
    )
    .await
    .unwrap();
    let lrj_id = e.lrj_id.unwrap();
    let pk: i32 = sqlx::query_scalar("SELECT id FROM api_longrunningjob WHERE job_id = $1")
        .bind(&lrj_id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    let url = format!("/api/jobs/{pk}/cancel/");

    assert_eq!(app.post_json(&url, &json!({}), Some(&bt)).await.status, 404);
    let res = app.post_json(&url, &json!({}), Some(&at)).await;
    assert_eq!(res.status, 200, "{}", res.text());
    let body = res.json();
    assert_eq!(keys(&body), ["status", "job"]);
    assert_eq!(body["status"], true);
    assert_eq!(body["job"]["cancelled"], true);
    assert_eq!(body["job"]["finished"], true);
    assert_eq!(body["job"]["result"], json!({"status": "cancelled"}));
    let status: String = sqlx::query_scalar("SELECT status FROM job_queue WHERE id = $1")
        .bind(e.id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(status, "cancelled");

    let res = app.post_json(&url, &json!({}), Some(&at)).await;
    assert_eq!(res.status, 400);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Job is already finished"})
    );

    let del = format!("/api/jobs/{pk}/");
    assert_eq!(app.delete(&del, None, Some(&bt)).await.status, 404);
    let res = app.delete(&del, None, Some(&at)).await;
    assert_eq!(res.status, 204);
    assert!(res.body.is_empty());
    assert_eq!(app.get(&del, Some(&at)).await.status, 404);
    assert_eq!(app.delete(&del, None, Some(&at)).await.status, 404);

    // Deleting a job that has not started cancels its queue row.
    let e = lp_jobs::enqueue(
        &app.state,
        "delete.missing_photos",
        json!({"user_id": alice.id}),
        lp_jobs::EnqueueOptions::tracked(lp_jobs::JobType::DeleteMissingPhotos, alice.id),
    )
    .await
    .unwrap();
    let pk: i32 = sqlx::query_scalar("SELECT id FROM api_longrunningjob WHERE job_id = $1")
        .bind(e.lrj_id.as_ref().unwrap())
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(
        app.delete(&format!("/api/jobs/{pk}/"), None, Some(&at))
            .await
            .status,
        204
    );
    let status: String = sqlx::query_scalar("SELECT status FROM job_queue WHERE id = $1")
        .bind(e.id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(status, "cancelled");
    app.cleanup().await;
}

async fn queued(app: &TestApp, lrj_id: &str) -> (String, Value, i32, i32) {
    sqlx::query_as(
        "SELECT q.kind, q.payload, j.job_type, j.started_by_id FROM job_queue q \
         JOIN api_longrunningjob j ON j.job_id = q.lrj_id WHERE q.lrj_id = $1",
    )
    .bind(lrj_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn trigger_buttons_enqueue_contract_jobs() {
    let app = TestApp::new().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let cases = [
        (
            "/api/scanphotos/",
            json!({}),
            "scan.user",
            1,
            json!({"user_id": alice.id, "full_scan": false, "scan_missing": false, "uploaded_only": false}),
        ),
        (
            "/api/fullscanphotos/",
            json!({}),
            "scan.user",
            1,
            json!({"user_id": alice.id, "full_scan": true, "scan_missing": false, "uploaded_only": false}),
        ),
        (
            "/api/deletemissingphotos",
            json!({}),
            "delete.missing_photos",
            5,
            json!({"user_id": alice.id}),
        ),
        (
            "/api/generateocr/",
            json!({"full_scan": true}),
            "ocr.generate",
            18,
            json!({"user_id": alice.id, "full_scan": true}),
        ),
        (
            "/api/generateocr/",
            json!({}),
            "ocr.generate",
            18,
            json!({"user_id": alice.id, "full_scan": false}),
        ),
    ];
    for (path, body, kind, job_type, payload) in cases {
        let res = app.post_json(path, &body, Some(&at)).await;
        assert_eq!(res.status, 200, "{path}: {}", res.text());
        let res = res.json();
        assert_eq!(keys(&res), ["status", "job_id"]);
        assert_eq!(res["status"], true);
        let got = queued(&app, res["job_id"].as_str().unwrap()).await;
        assert_eq!(
            got,
            (kind.to_string(), payload, job_type, alice.id),
            "{path}"
        );
        assert_eq!(app.post_json(path, &body, None).await.status, 401);
    }
    // The deprecated GET spellings still start a scan.
    assert_eq!(app.get("/api/scanphotos/", Some(&at)).await.status, 200);

    // A user without a usable scan directory is refused before anything is queued.
    let nodir = app.create_user("nodir_user", "pw", false).await;
    let nt = app.token_for(&nodir);
    let res = app
        .post_json("/api/scanphotos/", &json!({}), Some(&nt))
        .await;
    assert_eq!(res.status, 400);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account."})
    );
    sqlx::query("UPDATE api_user SET scan_directory = 'C:/does/not/exist' WHERE id = $1")
        .bind(nodir.id)
        .execute(app.pool())
        .await
        .unwrap();
    let res = app
        .post_json("/api/fullscanphotos/", &json!({}), Some(&nt))
        .await;
    assert_eq!(res.status, 400);
    assert_eq!(
        res.json()["message"],
        "Scan failed: Scan directory 'C:/does/not/exist' does not exist. Please contact your administrator."
    );
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_longrunningjob WHERE started_by_id = $1")
            .bind(nodir.id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(n, 0);
    app.cleanup().await;
}

fn fast() -> WorkerTiming {
    WorkerTiming {
        poll: Duration::from_millis(100),
        heartbeat: Duration::from_millis(500),
        stale_after: Duration::from_secs(30),
        maintenance: Duration::from_secs(5),
        shutdown_grace: Duration::from_secs(2),
        retry_base: Duration::from_millis(100),
    }
}

async fn run_worker_until<F>(app: &TestApp, done: F)
where
    F: AsyncFn() -> bool,
{
    let mut reg = HandlerRegistry::new();
    lp_api::jobs_zip_services::register_jobs(&mut reg);
    let mut w = Worker::new(app.state.clone(), reg);
    w.timing = fast();
    w.schedules = Vec::new();
    w.supervise_sidecars = false;
    let stop = CancellationToken::new();
    let h = tokio::spawn(w.run(stop.clone()));
    let t = Instant::now();
    while !done().await {
        assert!(t.elapsed() < Duration::from_secs(60), "worker timed out");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    stop.cancel();
    h.await.unwrap().unwrap();
}

fn zip_names(path: &std::path::Path) -> BTreeSet<String> {
    let f = std::fs::File::open(path).unwrap();
    let mut z = zip::ZipArchive::new(f).unwrap();
    (0..z.len())
        .map(|i| z.by_index(i).unwrap().name().to_string())
        .collect()
}

async fn photo_hashes(app: &TestApp, sql: &str) -> Vec<String> {
    sqlx::query_scalar(sql).fetch_all(app.pool()).await.unwrap()
}

#[tokio::test]
async fn zip_download_end_to_end() {
    let app = TestApp::new().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let (_, bt) = fixture_user(&app, "bob").await;
    let e2e = photo_hashes(
        &app,
        "SELECT p.image_hash FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         JOIN api_file f ON f.hash = p.main_file_id \
         WHERE u.username = 'alice' AND f.path LIKE '%e2e_0_.jpg' ORDER BY f.path",
    )
    .await;
    assert!(e2e.len() >= 3, "fixture e2e photos");
    let hashes = &e2e[..3];

    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"image_hashes": hashes, "include_stacked_photos": false}),
            Some(&at),
        )
        .await;
    assert_eq!(res.status, 200, "{}", res.text());
    let body = res.json();
    assert_eq!(keys(&body), ["job_id", "url"]);
    let job_id = body["job_id"].as_str().unwrap().to_string();
    let file_uuid = body["url"].as_str().unwrap().to_string();
    let (kind, payload, job_type, owner) = queued(&app, &job_id).await;
    assert_eq!((kind.as_str(), job_type, owner), ("zip.build", 9, alice.id));
    assert_eq!(payload["photo_ids"].as_array().unwrap().len(), 3);
    assert_eq!(payload["zip_uuid"], json!(file_uuid));

    let poll = format!("/api/photos/download?job_id={job_id}");
    let res = app.get(&poll, Some(&at)).await;
    assert_eq!(res.status, 202);
    assert_eq!(res.json(), json!({"status": "PENDING", "progress": null}));
    assert_eq!(app.get(&poll, Some(&bt)).await.status, 404);
    let res = app.get("/api/photos/download", Some(&at)).await;
    assert_eq!(res.status, 400);
    assert_eq!(res.json(), json!({"error": "job_id is required"}));

    let pool = app.pool().clone();
    let jid = job_id.clone();
    run_worker_until(&app, async || {
        lp_jobs::lrj::get(&pool, &jid)
            .await
            .unwrap()
            .unwrap()
            .finished
    })
    .await;
    let res = app.get(&poll, Some(&at)).await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (200, json!({"status": "SUCCESS"}))
    );
    let job = lp_jobs::lrj::get(app.pool(), &job_id)
        .await
        .unwrap()
        .unwrap();
    assert!(job.started_at.is_some() && !job.failed && job.result.is_none());
    assert_eq!((job.progress_current, job.progress_target), (3, 3));

    let zip_path = app
        .state
        .config
        .zip_dir()
        .join(format!("{file_uuid}{}.zip", alice.id));
    let names = zip_names(&zip_path);
    let expected: BTreeSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT f.path FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.image_hash = ANY($1)",
    )
    .bind(hashes)
    .fetch_all(app.pool())
    .await
    .unwrap()
    .into_iter()
    .map(|p| {
        std::path::Path::new(&p)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    })
    .collect();
    assert_eq!(names, expected);
    // Byte-identical entries.
    {
        let mut z = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let mut entry = z.by_index(0).unwrap();
        assert_eq!(entry.compression(), zip::CompressionMethod::Deflated);
        let mut got = Vec::new();
        entry.read_to_end(&mut got).unwrap();
        let src = std::fs::read(
            std::path::Path::new(r"C:\Users\Niaz\librephotos\rust-pg\fixture\data\alice\e2e")
                .join(entry.name()),
        )
        .unwrap();
        assert_eq!(got, src);
    }

    // Bob names his own (absent) archive, never alice's.
    assert_eq!(
        app.delete(&format!("/api/delete/zip/{file_uuid}"), None, Some(&bt))
            .await
            .status,
        200
    );
    assert!(zip_path.exists());
    assert_eq!(
        app.delete(&format!("/api/delete/zip/{file_uuid}"), None, None)
            .await
            .status,
        401
    );
    assert_eq!(
        app.delete("/api/delete/zip/not-a-uuid", None, Some(&at))
            .await
            .status,
        404
    );
    let res = app
        .delete(&format!("/api/delete/zip/{file_uuid}/"), None, Some(&at))
        .await;
    assert_eq!(res.status, 200);
    assert!(!zip_path.exists());
    app.cleanup().await;
}

#[tokio::test]
async fn zip_selection_rules() {
    let app = TestApp::shared().await;
    let (_, at) = fixture_user(&app, "alice").await;
    let bob_hashes = photo_hashes(
        &app,
        "SELECT p.image_hash FROM api_photo p JOIN api_user u ON u.id = p.owner_id WHERE u.username = 'bob'",
    )
    .await;
    let photo_ids = async |job_id: &str| -> usize {
        queued(&app, job_id).await.1["photo_ids"]
            .as_array()
            .unwrap()
            .len()
    };

    let res = app
        .post_json("/api/photos/download", &json!({}), Some(&at))
        .await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (400, json!({"error": "image_hashes required"}))
    );
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"image_hashes": bob_hashes}),
            Some(&at),
        )
        .await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (404, json!({"error": "No photos found"}))
    );
    assert_eq!(
        app.post_json(
            "/api/photos/download",
            &json!({"image_hashes": ["x"]}),
            None
        )
        .await
        .status,
        401
    );

    // One burst member widens to the whole stack with include_stacked_photos.
    let burst = photo_hashes(
        &app,
        "SELECT p.image_hash FROM api_photo p JOIN api_photo_stacks ps ON ps.photo_id = p.id \
         JOIN api_photostack s ON s.id = ps.photostack_id WHERE s.stack_type = 'burst' \
         ORDER BY p.image_hash",
    )
    .await;
    assert!(burst.len() >= 2);
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"image_hashes": burst[0], "include_stacked_photos": "true"}),
            Some(&at),
        )
        .await
        .json();
    assert_eq!(
        photo_ids(res["job_id"].as_str().unwrap()).await,
        burst.len()
    );
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"image_hashes": [burst[0]]}),
            Some(&at),
        )
        .await
        .json();
    assert_eq!(photo_ids(res["job_id"].as_str().unwrap()).await, 1);

    // select_all: build_photo_queryset, owner-scoped, minus excluded hashes.
    let videos = photo_hashes(
        &app,
        "SELECT p.image_hash FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         WHERE u.username = 'alice' AND p.video AND NOT p.hidden AND NOT p.in_trashcan \
         AND EXISTS (SELECT 1 FROM api_thumbnail t WHERE t.photo_id = p.id AND t.aspect_ratio IS NOT NULL)",
    )
    .await;
    assert!(!videos.is_empty());
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"select_all": true, "query": {"video": true}}),
            Some(&at),
        )
        .await;
    assert_eq!(res.status, 200, "{}", res.text());
    assert_eq!(
        photo_ids(res.json()["job_id"].as_str().unwrap()).await,
        videos.len()
    );
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"select_all": true, "query": {"video": true}, "excluded_hashes": videos}),
            Some(&at),
        )
        .await;
    assert_eq!(res.status, 404);
    let res = app
        .post_json(
            "/api/photos/download",
            &json!({"select_all": true, "query": {"public": true}}),
            Some(&at),
        )
        .await
        .json();
    let (_, payload, _, owner) = queued(&app, res["job_id"].as_str().unwrap()).await;
    let owners: Vec<i32> =
        sqlx::query_scalar("SELECT DISTINCT owner_id FROM api_photo WHERE id = ANY($1::uuid[])")
            .bind(
                payload["photo_ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().parse::<uuid::Uuid>().unwrap())
                    .collect::<Vec<_>>(),
            )
            .fetch_all(app.pool())
            .await
            .unwrap();
    assert_eq!(owners, vec![owner]);
    app.cleanup().await;
}

#[tokio::test]
async fn services_are_staff_only() {
    let app = TestApp::shared().await;
    let (_, at) = fixture_user(&app, "alice").await;
    let (_, admin) = fixture_user(&app, "admin").await;
    assert_eq!(app.get("/api/services/", None).await.status, 401);
    assert_eq!(app.get("/api/services/", Some(&at)).await.status, 403);
    assert_eq!(
        app.post_json("/api/services/thumbnail/start/", &json!({}), Some(&at))
            .await
            .status,
        403
    );

    let list = app.get("/api/services/", Some(&admin)).await.json();
    let services = list["services"].as_object().unwrap();
    assert_eq!(services["image_similarity"], 8002);
    assert_eq!(services["ocr"], 8012);
    assert!(!services.contains_key("exif"), "exif runs in-process");

    let res = app.get("/api/services/nope/", Some(&admin)).await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (404, json!({"error": "Service nope not found"}))
    );
    // Test config: FEATURE_* unset = on; OCR needs a selected model (none in the fixture).
    let res = app.get("/api/services/ocr/", Some(&admin)).await.json();
    assert_eq!(
        res,
        json!({"service_name": "ocr", "healthy": false, "enabled": false, "feature_flag": null, "mode": "sidecar"})
    );
    let res = app
        .post_json("/api/services/ocr/start/", &json!({}), Some(&admin))
        .await;
    assert_eq!(res.status, 409);
    assert_eq!(
        res.json(),
        json!({"error": "Service ocr is not started: no model is selected for it in the site settings", "feature_flag": null})
    );
    let res = app
        .get("/api/services/face_recognition/", Some(&admin))
        .await
        .json();
    assert_eq!(
        keys(&res),
        ["service_name", "healthy", "enabled", "feature_flag", "mode"]
    );
    assert_eq!(res["feature_flag"], "FEATURE_FACE_DETECTION");

    // A service lp-ml serves in-process has no process: healthy when
    // enabled, model state instead of a probe; stop unloads its models.
    app.state
        .ml
        .set_mode(lp_ml::Service::Similarity, lp_ml::Mode::InProcess);
    let res = app
        .get("/api/services/image_similarity/", Some(&admin))
        .await
        .json();
    assert_eq!(res["mode"], "inprocess");
    assert_eq!(res["healthy"], true);
    assert_eq!(res["model_loaded"], false);
    assert_eq!(res["busy"], false);
    assert_eq!(res["last_used"], Value::Null);
    for action in ["start", "stop"] {
        let res = app
            .post_json(
                &format!("/api/services/image_similarity/{action}/"),
                &json!({}),
                Some(&admin),
            )
            .await;
        assert_eq!(res.status, 200, "{action}: {}", res.text());
    }
    app.state
        .ml
        .set_mode(lp_ml::Service::Similarity, lp_ml::Mode::Auto);
    // Nothing was started by this process, so there is nothing to stop.
    let res = app
        .post_json("/api/services/thumbnail/stop/", &json!({}), Some(&admin))
        .await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (500, json!({"error": "Failed to stop service thumbnail"}))
    );
    app.cleanup().await;
}

#[tokio::test]
async fn missing_models_queue_one_download() {
    let app = TestApp::new().await;
    let (alice, at) = fixture_user(&app, "alice").await;
    let downloads = async || -> Vec<(String, i32, bool)> {
        sqlx::query_as(
            "SELECT q.kind, j.job_type, j.finished FROM job_queue q              JOIN api_longrunningjob j ON j.job_id = q.lrj_id WHERE q.kind = 'models.download'",
        )
        .fetch_all(app.pool())
        .await
        .unwrap()
    };
    // Off in tests by default: nothing is queued.
    assert_eq!(
        app.post_json("/api/scanphotos/", &json!({}), Some(&at))
            .await
            .status,
        200
    );
    assert!(downloads().await.is_empty());

    app.state.ml.set_auto_download(true);
    assert_eq!(
        app.post_json("/api/scanphotos/", &json!({}), Some(&at))
            .await
            .status,
        200
    );
    assert_eq!(
        downloads().await,
        [("models.download".to_string(), 10, false)]
    );
    // Already underway: not queued twice (start_model_download).
    assert_eq!(
        app.post_json("/api/scanfaces", &json!({}), Some(&at))
            .await
            .status,
        200
    );
    assert_eq!(downloads().await.len(), 1);
    let started_by: i32 =
        sqlx::query_scalar("SELECT started_by_id FROM api_longrunningjob WHERE job_type = 10")
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(started_by, alice.id);
    app.cleanup().await;
}
