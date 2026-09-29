//! Area `stats_admin_stacks_dupes` against the lp_fixture pack: every
//! endpoint, its authorization, the stack/duplicate mutations and both
//! detection jobs.

#![allow(clippy::disallowed_methods)]

use lp_api::stats_admin_stacks_dupes::jobs;
use lp_testkit::TestApp;
use serde_json::{Value, json};

fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into());
    serde_json::from_slice(&std::fs::read(path).expect("fixture manifest")).expect("manifest json")
}

fn hash(m: &Value, key: &str) -> String {
    m["photos"][key]["image_hash"]
        .as_str()
        .expect("photo")
        .to_string()
}

async fn token(app: &TestApp, name: &str) -> String {
    let user = lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .expect("fixture user");
    app.token_for(&user)
}

async fn user_id(app: &TestApp, name: &str) -> i32 {
    lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .unwrap()
        .id
}

#[tokio::test]
async fn dashboards() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;

    let r = app.get("/api/stats/", Some(&alice)).await;
    assert_eq!(r.status, 200);
    let s = r.json();
    let keys: Vec<&str> = s.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "num_photos",
            "num_screenshots",
            "num_documents",
            "num_missing_photos",
            "num_faces",
            "num_people",
            "num_unknown_faces",
            "num_labeled_faces",
            "num_inferred_faces",
            "num_albumauto",
            "num_albumdate",
            "num_albumuser"
        ]
    );
    assert!(s["num_photos"].as_i64().unwrap() > 20);
    assert!(s["num_people"].as_i64().unwrap() >= 2);

    let months = app.get("/api/photomonthcounts/", Some(&alice)).await.json();
    let months = months.as_array().unwrap();
    assert!(!months.is_empty());
    assert!(
        months
            .iter()
            .all(|m| m["month"].is_string() && m["count"].is_i64())
    );

    let cloud = app.get("/api/wordcloud/", Some(&alice)).await.json();
    for k in ["captions", "people", "locations"] {
        assert!(cloud[k].is_array(), "{k}");
    }
    assert!(
        cloud["people"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["label"] == "Ben")
    );

    let graph = app.get("/api/socialgraph/", Some(&alice)).await.json();
    let nodes = graph["nodes"].as_array().unwrap();
    assert!(nodes.len() >= 2);
    for n in nodes {
        assert!(n["x"].as_f64().unwrap().abs() <= 1000.0 + 1e-9);
        assert!(n["y"].as_f64().unwrap().abs() <= 1000.0 + 1e-9);
    }
    assert!(!graph["links"].as_array().unwrap().is_empty());

    let tree = app.get("/api/locationsunburst/", Some(&alice)).await.json();
    assert_eq!(tree["name"], "Places I've visited");
    let country = &tree["children"][0];
    assert!(country["hex"].as_str().unwrap().starts_with('#'));
    assert!(country["children"][0]["children"][0]["value"].is_i64());

    let timeline = app.get("/api/locationtimeline/", Some(&alice)).await.json();
    let spans = timeline.as_array().unwrap();
    assert!(!spans.is_empty());
    assert!(
        spans
            .iter()
            .all(|s| s["data"][0].is_f64() && s["loc"].is_string())
    );

    // Bob has no faces sharing a photo: an empty graph.
    let bob = token(&app, "bob").await;
    let graph = app.get("/api/socialgraph/", Some(&bob)).await.json();
    assert_eq!(graph, json!({"nodes": [], "links": []}));
    app.cleanup().await;
}

#[tokio::test]
async fn server_info_and_admin_only_views() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let admin = token(&app, "admin").await;

    let s = app.get("/api/storagestats/", Some(&alice)).await;
    assert_eq!(s.status, 200);
    assert!(s.json()["total_storage"].as_u64().unwrap() > 0);
    let t = app.get("/api/imagetag/", Some(&alice)).await.json();
    assert!(t["image_tag"].is_string() && t["git_hash"].is_string());

    for path in [
        "/api/serverstats/",
        "/api/serverlogs",
        "/api/serverlogs/view?lines=5",
    ] {
        assert_eq!(app.get(path, None).await.status, 401, "{path}");
        assert_eq!(app.get(path, Some(&alice)).await.status, 403, "{path}");
    }
    let stats = app.get("/api/serverstats/", Some(&admin)).await.json();
    assert_eq!(stats["number_of_users"], 5);
    let users = stats["users"].as_array().unwrap();
    assert_eq!(users.len(), 5);
    let alice_row = users
        .iter()
        .max_by_key(|u| u["number_of_photos"].as_i64())
        .unwrap();
    assert!(alice_row["album"]["count"].as_i64().unwrap() >= 1);
    assert!(stats["cpu_info"]["count"].as_u64().unwrap() >= 1);

    // No log file yet in the test's BASE_LOGS.
    let r = app.get("/api/serverlogs/view?lines=5", Some(&admin)).await;
    assert_eq!(r.status, 404);
    assert_eq!(r.json()["count"], 0);
    assert_eq!(app.get("/api/serverlogs", Some(&admin)).await.status, 404);
    let log = app.state.config.base_logs.join("ownphotos.log");
    std::fs::write(&log, "one\ntwo\nthree\n").unwrap();
    let r = app
        .get("/api/serverlogs/view?lines=2", Some(&admin))
        .await
        .json();
    assert_eq!(r, json!({"logs": "two\nthree\n", "count": 2}));
    let r = app.get("/api/serverlogs", Some(&admin)).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.text(), "one\ntwo\nthree\n");
    assert!(
        r.header("content-disposition")
            .unwrap()
            .contains("ownphotos.log")
    );

    for path in [
        "/api/stats/",
        "/api/wordcloud/",
        "/api/storagestats/",
        "/api/imagetag/",
        "/api/stacks",
        "/api/duplicates",
    ] {
        assert_eq!(app.get(path, None).await.status, 401, "{path}");
    }
    app.cleanup().await;
}

#[tokio::test]
async fn stack_reads() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let burst = m["stacks"]["burst"]["id"].as_str().unwrap();

    let list = app
        .get("/api/stacks?page=1&page_size=20", Some(&alice))
        .await
        .json();
    assert_eq!(list["count"], 2);
    assert_eq!(list["num_pages"], 1);
    assert_eq!(list["has_next"], false);
    let item = list["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == burst)
        .unwrap();
    assert_eq!(item["stack_type"], "burst");
    assert_eq!(item["stack_type_display"], "Burst Sequence");
    assert_eq!(item["photo_count"], 4);
    assert_eq!(item["preview_photos"].as_array().unwrap().len(), 4);
    assert!(item["primary_photo"]["image_hash"].is_string());
    assert!(item["created_at"].as_str().unwrap().ends_with('Z'));

    let only_manual = app
        .get("/api/stacks?stack_type=manual", Some(&alice))
        .await
        .json();
    assert_eq!(only_manual["count"], 1);
    let past_end = app
        .get("/api/stacks?page=7&page_size=1", Some(&alice))
        .await
        .json();
    assert_eq!(
        (past_end["page"].clone(), past_end["has_previous"].clone()),
        (json!(7), json!(true))
    );
    assert_eq!(past_end["results"].as_array().unwrap().len(), 1);

    let detail = app
        .get(&format!("/api/stacks/{burst}/"), Some(&alice))
        .await
        .json();
    assert_eq!(detail["photo_count"], 4);
    let photos = detail["photos"].as_array().unwrap();
    assert_eq!(photos.len(), 4);
    assert_eq!(photos.iter().filter(|p| p["is_primary"] == true).count(), 1);
    let v = &photos[0]["file_variants"][0];
    assert_eq!(v["type"], "image");
    assert_eq!(v["is_main"], true);

    let stats = app.get("/api/stacks/stats/", Some(&alice)).await.json();
    assert_eq!(stats["total_stacks"], 2);
    assert_eq!(
        stats["by_type"],
        json!({"burst": 1, "bracket": 0, "manual": 1, "raw_jpeg": 0, "live_photo": 0})
    );
    assert_eq!(stats["photos_in_stacks"], 6);

    // Someone else's stack, a bad id, a missing one.
    let bob = token(&app, "bob").await;
    assert_eq!(
        app.get(&format!("/api/stacks/{burst}/"), Some(&bob))
            .await
            .status,
        404
    );
    assert_eq!(
        app.get("/api/stacks/not-a-uuid/", Some(&alice))
            .await
            .status,
        404
    );
    let r = app
        .get(
            "/api/stacks/00000000-0000-0000-0000-000000000000/",
            Some(&alice),
        )
        .await;
    assert_eq!(r.status, 404);
    assert_eq!(r.json()["errors"][0]["message"], "Photo stack not found");
    assert_eq!(app.get("/api/stacks", Some(&bob)).await.json()["count"], 0);
    app.cleanup().await;
}

#[tokio::test]
async fn duplicate_reads() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let dup = m["duplicates"]["visual"]["id"].as_str().unwrap();

    let list = app.get("/api/duplicates", Some(&alice)).await.json();
    assert_eq!(list["count"], 1);
    let item = &list["results"][0];
    assert_eq!(item["duplicate_type"], "visual_duplicate");
    assert_eq!(item["review_status_display"], "Pending Review");
    assert_eq!(item["preview_photos"].as_array().unwrap().len(), 2);
    assert_eq!(item["kept_photo"], Value::Null);
    assert_eq!(
        app.get("/api/duplicates?status=resolved", Some(&alice))
            .await
            .json()["count"],
        0
    );
    assert_eq!(
        app.get("/api/duplicates?duplicate_type=exact_copy", Some(&alice))
            .await
            .json()["count"],
        0
    );

    let detail = app
        .get(&format!("/api/duplicates/{dup}"), Some(&alice))
        .await
        .json();
    assert_eq!(detail["photos"].as_array().unwrap().len(), 2);
    assert_eq!(detail["photos"][0]["is_kept"], Value::Null);
    assert_eq!(detail["photos"][0]["file_type"], "Image");
    let suggested = detail["suggested_photo_hash"].as_str().unwrap();
    assert!(
        [
            hash(&m, "alice/dup_original"),
            hash(&m, "alice/dup_resized")
        ]
        .contains(&suggested.to_string())
    );

    let stats = app.get("/api/duplicates/stats", Some(&alice)).await.json();
    assert_eq!(stats["total_duplicates"], 1);
    assert_eq!(stats["pending_duplicates"], 1);
    assert_eq!(
        stats["by_type"],
        json!({"exact_copy": 0, "visual_duplicate": 1})
    );
    assert_eq!(stats["photos_in_duplicates"], 2);

    let bob = token(&app, "bob").await;
    assert_eq!(
        app.get(&format!("/api/duplicates/{dup}"), Some(&bob))
            .await
            .status,
        404
    );
    assert_eq!(
        app.get(&format!("/api/duplicates/{dup}/"), Some(&alice))
            .await
            .status,
        200
    );
    app.cleanup().await;
}

#[tokio::test]
async fn stack_mutations() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let burst = m["stacks"]["burst"]["id"].as_str().unwrap().to_string();
    let manual = m["stacks"]["manual"]["id"].as_str().unwrap().to_string();

    // primary
    let url = format!("/api/stacks/{burst}/primary/");
    assert_eq!(
        app.post_json(&url, &json!({}), Some(&alice)).await.status,
        400
    );
    assert_eq!(
        app.post_json(&url, &json!({}), Some(&bob)).await.status,
        404
    );
    let r = app
        .post_json(
            &url,
            &json!({"photo_hash": hash(&m, "alice/e2e_01")}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.status, 400);
    let b1 = hash(&m, "alice/burst_1");
    let r = app
        .post_json(&url, &json!({"photo_hash": b1}), Some(&alice))
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "updated", "primary_photo_hash": b1})
    );

    // remove the primary: a new one is chosen
    let url = format!("/api/stacks/{burst}/remove/");
    assert_eq!(
        app.post_json(&url, &json!({"photo_hashes": []}), Some(&alice))
            .await
            .status,
        400
    );
    let r = app
        .post_json(&url, &json!({"photo_hashes": [b1]}), Some(&alice))
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "updated", "removed_count": 1, "total_count": 3})
    );
    let d = app
        .get(&format!("/api/stacks/{burst}/"), Some(&alice))
        .await
        .json();
    assert_ne!(d["primary_photo_hash"], json!(b1));
    assert!(d["primary_photo_hash"].is_string());

    // add it back; someone else's photo or stack adds nothing
    let url = format!("/api/stacks/{burst}/add/");
    assert_eq!(
        app.post_json(&url, &json!({"photo_hashes": []}), Some(&alice))
            .await
            .status,
        400
    );
    assert_eq!(
        app.post_json(&url, &json!({"photo_hashes": [b1]}), Some(&bob))
            .await
            .status,
        404
    );
    let bobs = hash(&m, "bob/own_01");
    let r = app
        .post_json(&url, &json!({"photo_hashes": [b1, b1, bobs]}), Some(&alice))
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "updated", "added_count": 1, "total_count": 4})
    );
    let r = app
        .post_json(&url, &json!({"photo_hashes": [b1]}), Some(&alice))
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "updated", "added_count": 0, "total_count": 4})
    );
    let r = app
        .post_json(
            &format!("/api/stacks/{burst}/remove/"),
            &json!({"photo_hashes": [b1]}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "updated", "removed_count": 1, "total_count": 3})
    );

    // manual: validation, then a new stack
    let e1 = hash(&m, "alice/e2e_01");
    let e2 = hash(&m, "alice/e2e_02");
    assert_eq!(
        app.post_json(
            "/api/stacks/manual/",
            &json!({"photo_hashes": [e1, e1]}),
            Some(&alice)
        )
        .await
        .status,
        400
    );
    let r = app
        .post_json(
            "/api/stacks/manual/",
            &json!({"photo_hashes": [e1, "nope"]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json()["errors"][0]["message"], "Some photos not found");
    let r = app
        .post_json(
            "/api/stacks/manual/",
            &json!({"photo_hashes": [e1, e2]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.status, 201);
    let created = r.json()["stack_id"].as_str().unwrap().to_string();
    assert_eq!(r.json()["photo_count"], 2);
    // Adding to a photo already in a manual stack reuses that stack.
    let e3 = hash(&m, "alice/e2e_03");
    let r = app
        .post_json(
            "/api/stacks/manual/",
            &json!({"photo_hashes": [e2, e3]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json()["stack_id"], json!(created));

    // merge the fixture's manual stack with the new one: the newest survives
    let ma = hash(&m, "alice/manual_a");
    let r = app
        .post_json(
            "/api/stacks/merge/",
            &json!({"photo_hashes": [ma]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json()["status"], "no_merge_needed");
    let r = app
        .post_json(
            "/api/stacks/merge/",
            &json!({"photo_hashes": [ma, e1]}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "merged", "stack_id": created, "photo_count": 5, "merged_count": 1})
    );
    assert_eq!(
        app.get(&format!("/api/stacks/{manual}/"), Some(&alice))
            .await
            .status,
        404
    );
    let b3 = hash(&m, "alice/burst_3");
    let r = app
        .post_json(
            "/api/stacks/merge/",
            &json!({"photo_hashes": [b3]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.status, 400);

    // removing down to one photo deletes the stack
    let mb = hash(&m, "alice/manual_b");
    let r = app
        .post_json(
            &format!("/api/stacks/{created}/remove/"),
            &json!({"photo_hashes": [ma, mb, e1, e2]}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json()["status"], "deleted");
    assert_eq!(r.json()["removed_count"], 4);

    // delete: others get a 404, the owner unlinks every photo
    assert_eq!(
        app.delete(&format!("/api/stacks/{burst}/"), None, Some(&bob))
            .await
            .status,
        404
    );
    let r = app
        .delete(&format!("/api/stacks/{burst}/"), None, Some(&alice))
        .await;
    assert_eq!(r.json(), json!({"status": "deleted", "unlinked_count": 3}));
    assert_eq!(
        app.get("/api/stacks/stats/", Some(&alice)).await.json()["total_stacks"],
        0
    );
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM api_photo_stacks")
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(left, 0);

    // detect queues a tracked job
    let r = app
        .post_json("/api/stacks/detect/", &json!({}), Some(&alice))
        .await;
    assert_eq!(r.status, 202);
    assert_eq!(r.json()["options"], json!({"detect_bursts": true}));
    let (kind, job_type): (String, i32) = sqlx::query_as(
        "SELECT q.kind, l.job_type FROM job_queue q JOIN api_longrunningjob l ON l.job_id = q.lrj_id ORDER BY q.id DESC LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!((kind.as_str(), job_type), ("stacks.detect", 19));
    app.cleanup().await;
}

#[tokio::test]
async fn duplicate_mutations() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let dup = m["duplicates"]["visual"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let orig = hash(&m, "alice/dup_original");
    let resized = hash(&m, "alice/dup_resized");
    let trashed = |h: String| {
        let pool = app.pool().clone();
        async move {
            sqlx::query_scalar::<_, bool>("SELECT in_trashcan FROM api_photo WHERE image_hash = $1")
                .bind(h)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };

    let url = format!("/api/duplicates/{dup}/resolve");
    assert_eq!(
        app.post_json(&url, &json!({"keep_photo_hash": orig}), Some(&bob))
            .await
            .status,
        404
    );
    assert_eq!(
        app.post_json(&url, &json!({}), Some(&alice)).await.status,
        400
    );
    assert_eq!(
        app.post_json(&url, &json!({"keep_photo_hash": "x"}), Some(&alice))
            .await
            .status,
        400
    );
    assert_eq!(
        app.post_json(
            &format!("/api/duplicates/{dup}/revert"),
            &json!({}),
            Some(&alice)
        )
        .await
        .status,
        400
    );

    let r = app
        .post_json(&url, &json!({"keep_photo_hash": orig}), Some(&alice))
        .await;
    assert_eq!(
        r.json(),
        json!({"status": "resolved", "kept_photo": orig, "trashed_count": 1})
    );
    assert!(trashed(resized.clone()).await);
    let d = app
        .get(&format!("/api/duplicates/{dup}"), Some(&alice))
        .await
        .json();
    assert_eq!(d["review_status"], "resolved");
    assert_eq!(d["kept_photo_hash"], json!(orig));
    let kept: Vec<Value> = d["photos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["is_kept"].clone())
        .collect();
    assert!(kept.contains(&json!(true)) && kept.contains(&json!(false)));

    let r = app
        .post_json(
            &format!("/api/duplicates/{dup}/revert"),
            &json!({}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json(), json!({"status": "reverted", "restored_count": 1}));
    assert!(!trashed(resized.clone()).await);

    let r = app
        .post_json(
            &url,
            &json!({"keep_photo_hash": resized, "trash_others": false}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json()["trashed_count"], 0);
    assert!(!trashed(orig.clone()).await);

    let r = app
        .post_json(
            &format!("/api/duplicates/{dup}/dismiss"),
            &json!({}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.json(), json!({"status": "dismissed"}));
    // A dismissed group has no photos left, so the list hides it.
    assert_eq!(
        app.get("/api/duplicates", Some(&alice)).await.json()["count"],
        0
    );
    assert_eq!(
        app.get("/api/duplicates/stats", Some(&alice)).await.json()["dismissed_duplicates"],
        1
    );

    assert_eq!(
        app.delete(&format!("/api/duplicates/{dup}/delete"), None, Some(&bob))
            .await
            .status,
        404
    );
    let r = app
        .delete(&format!("/api/duplicates/{dup}/delete"), None, Some(&alice))
        .await;
    assert_eq!(r.json(), json!({"status": "deleted", "unlinked_count": 0}));
    assert_eq!(
        app.get(&format!("/api/duplicates/{dup}"), Some(&alice))
            .await
            .status,
        404
    );

    let r = app
        .post_json(
            "/api/duplicates/detect",
            &json!({"batch_size": 5, "visual_threshold": "12"}),
            Some(&alice),
        )
        .await;
    assert_eq!(r.status, 202);
    assert_eq!(
        r.json()["options"],
        json!({"detect_exact_copies": true, "detect_visual_duplicates": true, "visual_threshold": 12,
               "clear_pending": false, "batch_size": 100})
    );
    assert_eq!(
        app.post_json(
            "/api/duplicates/detect",
            &json!({"visual_threshold": "x"}),
            Some(&alice)
        )
        .await
        .status,
        400
    );
    app.cleanup().await;
}

#[tokio::test]
async fn detection_jobs_rebuild_the_fixture_groups() {
    let app = TestApp::with_env(&[("LP_EXIFTOOL", &exiftool())]).await;
    let m = manifest();
    let alice = user_id(&app, "alice").await;

    // Burst detection replaces the seeded burst stack by one found from the
    // file names (IMG_20240301_120000_00N.jpg).
    let n = jobs::stacks::detect(&app.state, alice, &json!({}), None)
        .await
        .unwrap();
    assert!(n >= 1);
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT p.image_hash FROM api_photostack s JOIN api_photo_stacks x ON x.photostack_id = s.id \
         JOIN api_photo p ON p.id = x.photo_id WHERE s.owner_id = $1 AND s.stack_type = 'burst' ORDER BY 1",
    )
    .bind(alice)
    .fetch_all(app.pool())
    .await
    .unwrap();
    let mut want: Vec<String> = (1..=4)
        .map(|i| hash(&m, &format!("alice/burst_{i}")))
        .collect();
    want.sort();
    assert!(want.iter().all(|h| members.contains(h)), "{members:?}");
    let seeded = m["stacks"]["burst"]["id"].as_str().unwrap();
    let gone: bool =
        sqlx::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM api_photostack WHERE id = $1::uuid)")
            .bind(seeded)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(gone);
    let (start, end): (Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT sequence_start, sequence_end FROM api_photostack WHERE owner_id = $1 AND stack_type = 'burst' LIMIT 1")
            .bind(alice)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(start.is_some() && start <= end);

    // Duplicate detection: after clearing the pending group, the visual pair
    // comes back.
    let dup = m["duplicates"]["visual"]["id"].as_str().unwrap();
    sqlx::query("DELETE FROM api_photo_duplicates WHERE duplicate_id = $1::uuid")
        .bind(dup)
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM api_duplicate WHERE id = $1::uuid")
        .bind(dup)
        .execute(app.pool())
        .await
        .unwrap();
    let n = jobs::dupes::detect(&app.state, alice, &json!({}), None)
        .await
        .unwrap();
    assert!(n >= 1);
    let groups: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT d.duplicate_type, count(x.id), d.potential_savings FROM api_duplicate d \
         JOIN api_photo_duplicates x ON x.duplicate_id = d.id WHERE d.owner_id = $1 GROUP BY d.id",
    )
    .bind(alice)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert!(
        groups
            .iter()
            .any(|(t, c, s)| t == "visual_duplicate" && *c >= 2 && *s > 0),
        "{groups:?}"
    );
    // Running it again finds nothing new (photos already grouped).
    let before = groups.len();
    jobs::dupes::detect(
        &app.state,
        alice,
        &json!({"detect_exact_copies": false}),
        None,
    )
    .await
    .unwrap();
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM api_duplicate WHERE owner_id = $1")
        .bind(alice)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(after as usize, before);
    app.cleanup().await;
}

fn exiftool() -> String {
    std::env::var("LP_EXIFTOOL").unwrap_or_else(|_| {
        "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages/exiftool_bin/exiftool.exe"
            .into()
    })
}

/// Run a detection job on an existing database, for the mutation diff
/// against Django: `LP_DETECT_DB=<db> LP_DETECT_KIND=stacks|dupes
/// LP_DETECT_USER=alice [LP_DETECT_OPTIONS=<json>]`.
#[tokio::test]
#[ignore]
async fn run_detect_on_db() {
    let db = std::env::var("LP_DETECT_DB").expect("LP_DETECT_DB");
    let kind = std::env::var("LP_DETECT_KIND").expect("LP_DETECT_KIND");
    let user = std::env::var("LP_DETECT_USER").unwrap_or_else(|_| "alice".into());
    let options: Value = std::env::var("LP_DETECT_OPTIONS")
        .map(|s| serde_json::from_str(&s).expect("options json"))
        .unwrap_or_else(|_| json!({}));
    let app = TestApp::attach(&db, &[("LP_EXIFTOOL", &exiftool())]).await;
    let uid = user_id(&app, &user).await;
    let n = match kind.as_str() {
        "stacks" => jobs::stacks::detect(&app.state, uid, &options, None)
            .await
            .unwrap(),
        "dupes" => jobs::dupes::detect(&app.state, uid, &options, None)
            .await
            .unwrap(),
        other => panic!("unknown kind {other}"),
    };
    println!("found {n}");
    app.cleanup().await;
}
