//! `/api/sync/*` and the `DeletionLog` tombstones behind them, on a private
//! clone of the fixture template (cases of Django's `api/tests/test_sync_api.py`).

#![allow(clippy::disallowed_methods)]

use std::collections::HashSet;

use axum::http::StatusCode;
use base64::Engine;
use lp_testkit::TestApp;
use serde_json::{Value, json};
use uuid::Uuid;

fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into());
    serde_json::from_slice(&std::fs::read(path).expect("fixture manifest")).expect("manifest json")
}

fn photo_id(m: &Value, key: &str) -> Uuid {
    m["photos"][key]["id"].as_str().unwrap().parse().unwrap()
}

fn cursor(raw: &str) -> String {
    base64::engine::general_purpose::URL_SAFE.encode(raw)
}

/// Drive the pull loop to quiescence: `(items, tombstones, durable cursor)`.
async fn pull(
    app: &TestApp,
    token: &str,
    path: &str,
    from: Option<&str>,
    page_size: u32,
) -> (Vec<Value>, Vec<String>, Option<String>) {
    let mut items = Vec::new();
    let mut tombstones = Vec::new();
    let mut durable = from.map(str::to_string);
    loop {
        let mut url = format!("{path}?page_size={page_size}");
        if let Some(c) = &durable {
            url.push_str(&format!("&cursor={c}"));
        }
        let res = app.get(&url, Some(token)).await;
        assert_eq!(res.status, StatusCode::OK, "{url}: {}", res.text());
        let body = res.json();
        items.extend(body["items"].as_array().unwrap().iter().cloned());
        tombstones.extend(
            body["tombstones"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t.as_str().unwrap().to_string()),
        );
        match body["next_cursor"].as_str() {
            Some(next) => durable = Some(next.to_string()),
            None => return (items, tombstones, durable),
        }
    }
}

async fn token(app: &TestApp, name: &str) -> (i32, String) {
    let u = lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .unwrap();
    (u.id, app.token_for(&u))
}

#[tokio::test]
async fn feeds_cursors_tombstones_and_counts() {
    let app = TestApp::new().await;
    let m = manifest();
    let db = app.pool().clone();
    let (alice_id, alice) = token(&app, "alice").await;
    let (bob_id, bob) = token(&app, "bob").await;

    // Seed envelope: version, total, no tombstones; a cursored page has no total.
    let seed = app.get("/api/sync/photos/", Some(&alice)).await.json();
    let owned_or_shared: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo p WHERE p.owner_id = $1 \
         OR EXISTS (SELECT 1 FROM api_photo_shared_to s WHERE s.photo_id = p.id AND s.user_id = $1)",
    )
    .bind(alice_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(seed["v"], json!(1));
    assert_eq!(seed["total"], json!(owned_or_shared));
    assert_eq!(seed["tombstones"], json!([]));
    let next = seed["next_cursor"].as_str().unwrap();
    let page = app
        .get(&format!("/api/sync/photos/?cursor={next}"), Some(&alice))
        .await
        .json();
    assert!(page.get("total").is_none());

    // Every row exactly once, also when every last_modified ties.
    let (items, _, _) = pull(&app, &alice, "/api/sync/photos/", None, 4).await;
    let ids: Vec<&str> = items.iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len() as i64, owned_or_shared);
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
    sqlx::query("UPDATE api_photo SET last_modified = date_trunc('second', now()) WHERE owner_id = $1")
        .bind(alice_id)
        .execute(&db)
        .await
        .unwrap();
    let (tied, _, _) = pull(&app, &alice, "/api/sync/photos/", None, 2).await;
    let tied: HashSet<&str> = tied.iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert_eq!(tied, ids.iter().copied().collect::<HashSet<_>>());

    // Bob sees what alice shared to him; un-sharing tombstones it for him only.
    let e2e_06 = photo_id(&m, "alice/e2e_06");
    let e2e_07 = photo_id(&m, "alice/e2e_07");
    let (bob_items, _, bob_cursor) = pull(&app, &bob, "/api/sync/photos/", None, 1000).await;
    let bob_ids: HashSet<String> = bob_items
        .iter()
        .map(|i| i["id"].as_str().unwrap().to_string())
        .collect();
    assert!(bob_ids.contains(&e2e_06.to_string()) && bob_ids.contains(&e2e_07.to_string()));
    let (_, _, alice_cursor) = pull(&app, &alice, "/api/sync/photos/", None, 1000).await;
    let res = app
        .post_json(
            "/api/photosedit/share/",
            &json!({"image_hashes": [m["photos"]["alice/e2e_06"]["image_hash"]],
                    "val_shared": false, "target_user_id": bob_id}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let (_, tombs, bob_cursor) =
        pull(&app, &bob, "/api/sync/photos/", bob_cursor.as_deref(), 1000).await;
    assert_eq!(tombs, vec![e2e_06.to_string()]);
    let (_, alice_tombs, _) =
        pull(&app, &alice, "/api/sync/photos/", alice_cursor.as_deref(), 1000).await;
    assert!(alice_tombs.is_empty());

    // Re-sharing cancels the stale tombstone.
    let reshare = json!({"image_hashes": [m["photos"]["alice/e2e_06"]["image_hash"]],
                         "val_shared": true, "target_user_id": bob_id});
    app.post_json("/api/photosedit/share/", &reshare, Some(&alice))
        .await;
    let left: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_deletionlog WHERE entity = 'photo' AND entity_id = $1 AND owner_id = $2",
    )
    .bind(e2e_06.to_string())
    .bind(bob_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(left, 0);

    // A hard delete tombstones the photo for the owner and every recipient.
    let mut tx = db.begin().await.unwrap();
    let mut after = lp_db::write::AfterCommit::new();
    lp_db::write::photo_delete::hard_delete(&mut tx, &[e2e_07], &app.base_path(), &mut after)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    drop(after);
    let owners: Vec<i32> = sqlx::query_scalar(
        "SELECT owner_id FROM api_deletionlog WHERE entity = 'photo' AND entity_id = $1 ORDER BY owner_id",
    )
    .bind(e2e_07.to_string())
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(owners, vec![alice_id, bob_id]);
    let (_, tombs, _) = pull(&app, &bob, "/api/sync/photos/", bob_cursor.as_deref(), 1000).await;
    assert!(tombs.contains(&e2e_07.to_string()));

    // Person, tag, user album and auto album deletes.
    let (_, _, persons_cursor) = pull(&app, &alice, "/api/sync/persons/", None, 1000).await;
    let created = app
        .post_json("/api/persons/", &json!({"name": "Sync Test"}), Some(&alice))
        .await
        .json();
    let pid = created["id"].as_i64().unwrap();
    let res = app
        .delete(&format!("/api/persons/{pid}/"), None, Some(&alice))
        .await;
    assert!(res.status.is_success(), "{}", res.text());
    let (_, tombs, _) =
        pull(&app, &alice, "/api/sync/persons/", persons_cursor.as_deref(), 1000).await;
    assert_eq!(tombs, vec![pid.to_string()]);

    let (_, _, tags_cursor) = pull(&app, &alice, "/api/sync/albums/tag/", None, 1000).await;
    let tag = m["tags"][0]["id"].as_i64().unwrap();
    let family = m["tags"][2]["id"].as_i64().unwrap();
    app.delete(&format!("/api/tags/{tag}/"), None, Some(&alice))
        .await;
    app.post_json(
        &format!("/api/tags/{family}/add/"),
        &json!({"photos": [photo_id(&m, "alice/e2e_01")]}),
        Some(&alice),
    )
    .await;
    let (items, tombs, _) =
        pull(&app, &alice, "/api/sync/albums/tag/", tags_cursor.as_deref(), 1000).await;
    assert_eq!(tombs, vec![tag.to_string()]);
    // The link change bumped the tag across the cursor.
    assert!(items.iter().any(|i| i["id"] == json!(family)));

    let vacation = m["albums"]["user"]["vacation"]["id"].as_i64().unwrap();
    let (_, _, albums_cursor) = pull(&app, &alice, "/api/sync/albums/user/", None, 1000).await;
    app.post_json(
        "/api/useralbum/share/",
        &json!({"album_id": vacation, "target_user_id": bob_id, "shared": true}),
        Some(&alice),
    )
    .await;
    let (_, _, bob_albums) = pull(&app, &bob, "/api/sync/albums/user/", None, 1000).await;
    app.delete(&format!("/api/albums/user/{vacation}/"), None, Some(&alice))
        .await;
    for (who, from) in [(&alice, albums_cursor), (&bob, bob_albums)] {
        let (_, tombs, _) = pull(&app, who, "/api/sync/albums/user/", from.as_deref(), 1000).await;
        assert_eq!(tombs, vec![vacation.to_string()]);
    }

    let auto = m["albums"]["auto"][0]["id"].as_i64().unwrap();
    let (_, _, auto_cursor) = pull(&app, &alice, "/api/sync/albums/auto/", None, 1000).await;
    app.delete(&format!("/api/albums/auto/{auto}/"), None, Some(&alice))
        .await;
    let (_, tombs, _) =
        pull(&app, &alice, "/api/sync/albums/auto/", auto_cursor.as_deref(), 1000).await;
    assert_eq!(tombs, vec![auto.to_string()]);

    // Cursor errors.
    let old = cursor(&format!(
        "{}|5",
        lp_core::time::py_isoformat(&(chrono::Utc::now() - chrono::Duration::days(91)))
    ));
    let res = app
        .get(&format!("/api/sync/photos/?cursor={old}"), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::GONE);
    assert_eq!(res.json(), json!({"error": "cursor_expired"}));
    let res = app
        .get("/api/sync/photos/?cursor=!!!not-base64!!!", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json(), json!({"error": "invalid_cursor"}));
    let res = app.get("/api/sync/photos/", None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // Counts.
    let counts = app.get("/api/sync/counts/", Some(&alice)).await.json();
    let tags: i64 = sqlx::query_scalar("SELECT count(*) FROM api_tag WHERE owner_id = $1")
        .bind(alice_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(counts["tags"], json!(tags));
    assert!(counts["server_time"].as_str().unwrap().ends_with("+00:00"));

    app.cleanup().await;
}
