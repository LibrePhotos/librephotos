//! People & faces endpoints end to end on a clone of the fixture
//! (`lp_fixture`: alice owns persons Anna / Ben / "Cluster 1", bob owns
//! "Bob's Friend"; see apps/backend-rs/tests/README.md).
#![allow(clippy::disallowed_methods)]

use axum::http::StatusCode;
use lp_testkit::TestApp;
use serde_json::{Value, json};

fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into());
    serde_json::from_slice(&std::fs::read(path).expect("fixture manifest")).expect("manifest json")
}

async fn token(app: &TestApp, name: &str) -> String {
    let user = lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .expect("fixture user");
    app.token_for(&user)
}

fn ids(v: &Value, key: &str) -> Vec<i64> {
    v[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_i64().unwrap())
        .collect()
}

#[tokio::test]
async fn persons_list_and_retrieve() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let anna = &m["persons"]["anna"];

    let res = app.get("/api/persons/?page_size=1000", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    let keys: Vec<_> = body.as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["count", "next", "previous", "results"]);
    assert_eq!(body["count"], 2);
    let first = &body["results"][0];
    let keys: Vec<_> = first.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        keys,
        [
            "name",
            "face_url",
            "face_count",
            "face_photo_url",
            "video",
            "id"
        ]
    );
    assert_eq!(first["id"], anna["id"]);
    assert_eq!(first["name"], anna["name"]);
    assert_eq!(first["face_count"], anna["face_count"]);
    assert_eq!(first["video"], false);
    assert_eq!(
        first["face_photo_url"],
        m["photos"]["alice/e2e_01"]["image_hash"]
    );
    assert!(
        first["face_url"]
            .as_str()
            .unwrap()
            .starts_with("/media/faces/")
    );
    assert_eq!(body["results"][1]["name"], "Ben");

    let res = app.get("/api/persons/?search=ben", Some(&alice)).await;
    assert_eq!(
        ids(&res.json(), "results"),
        [m["persons"]["ben"]["id"].as_i64().unwrap()]
    );

    let res = app.get("/api/persons/?page_size=1", Some(&alice)).await;
    let body = res.json();
    assert_eq!(body["results"].as_array().unwrap().len(), 1);
    assert!(
        body["next"]
            .as_str()
            .unwrap()
            .ends_with("page=2&page_size=1")
    );
    let res = app
        .get("/api/persons/?page=3&page_size=1", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    let res = app.get("/api/persons/", Some(&bob)).await;
    assert_eq!(
        ids(&res.json(), "results"),
        [m["persons"]["bobs_friend"]["id"].as_i64().unwrap()]
    );

    assert_eq!(
        app.get("/api/persons/", None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let path = format!("/api/persons/{}/", anna["id"]);
    let res = app.get(&path, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["name"], anna["name"]);
    assert_eq!(
        app.get(&path, Some(&bob)).await.status,
        StatusCode::NOT_FOUND
    );
    let cluster = format!("/api/persons/{}/", m["persons"]["cluster_1"]["id"]);
    assert_eq!(
        app.get(&cluster, Some(&alice)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get("/api/persons/abc/", Some(&alice)).await.status,
        StatusCode::NOT_FOUND
    );
    app.cleanup().await;
}

#[tokio::test]
async fn incomplete_faces() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;

    let res = app
        .get(
            "/api/faces/incomplete/?inferred=false&order_by=confidence",
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(
        body,
        json!([
            {"id": m["persons"]["anna"]["id"], "name": m["persons"]["anna"]["name"], "kind": "USER", "face_count": 4},
            {"id": m["persons"]["ben"]["id"], "name": "Ben", "kind": "USER", "face_count": 2},
            {"id": 0, "name": "Unknown - Other", "face_count": 4, "kind": "Unknown - Other"},
        ])
    );
    let res = app
        .get(
            "/api/faces/incomplete/?inferred=true&order_by=confidence&analysis_method=clustering",
            Some(&alice),
        )
        .await;
    let body = res.json();
    let counts: Vec<(i64, i64)> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["id"].as_i64().unwrap(), p["face_count"].as_i64().unwrap()))
        .collect();
    assert_eq!(
        counts,
        [
            (m["persons"]["ben"]["id"].as_i64().unwrap(), 1),
            (m["persons"]["cluster_1"]["id"].as_i64().unwrap(), 2),
            (0, 1)
        ]
    );
    let res = app
        .get(
            "/api/faces/incomplete/?inferred=true&analysis_method=classification&min_confidence=0.65",
            Some(&alice),
        )
        .await;
    let body = res.json();
    assert_eq!(body[0]["name"], "Ben");
    assert_eq!(body[0]["face_count"], 1);
    let res = app
        .get(
            "/api/faces/incomplete/?inferred=true&analysis_method=bogus",
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        app.get("/api/faces/incomplete/?inferred=false", None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let dave = token(&app, "dave").await;
    let res = app
        .get("/api/faces/incomplete/?inferred=false", Some(&dave))
        .await;
    assert_eq!(res.json(), json!([]));
    app.cleanup().await;
}

#[tokio::test]
async fn face_list() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let anna = m["persons"]["anna"]["id"].as_i64().unwrap();

    let path = format!("/api/faces/?person={anna}&page=1&inferred=false&order_by=confidence");
    let res = app.get(&path, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["count"], 4);
    assert_eq!(ids(&body, "results"), [4, 3, 2, 1]);
    let face = &body["results"][0];
    let keys: Vec<_> = face.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        keys,
        [
            "id",
            "image",
            "face_url",
            "photo",
            "photo_image_hash",
            "timestamp",
            "person_label_probability"
        ]
    );
    assert!(face["image"].as_str().unwrap().starts_with("http://"));
    assert!(
        face["image"]
            .as_str()
            .unwrap()
            .ends_with(face["face_url"].as_str().unwrap())
    );
    assert_eq!(face["timestamp"], "2022-06-10T09:15:00Z");
    assert_eq!(face["person_label_probability"], 0.0);

    let res = app
        .get(
            "/api/faces/?person=0&page=1&inferred=true&order_by=date",
            Some(&alice),
        )
        .await;
    assert_eq!(
        ids(&res.json(), "results"),
        m["faces"]["unknown"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect::<Vec<_>>()
    );

    let ben = m["persons"]["ben"]["id"].as_i64().unwrap();
    let res = app
        .get(
            &format!("/api/faces/?person={ben}&page=1&inferred=true&order_by=confidence"),
            Some(&alice),
        )
        .await;
    let body = res.json();
    assert_eq!(ids(&body, "results"), [7]);
    assert_eq!(body["results"][0]["person_label_probability"], 0.82);
    let res = app
        .get(
            &format!("/api/faces/?person={ben}&inferred=true&analysis_method=classification"),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["results"][0]["person_label_probability"], 0.71);

    // Bob sees none of alice's faces, even for her person id.
    let res = app.get(&path, Some(&bob)).await;
    assert_eq!(res.json()["count"], 0);
    assert_eq!(
        app.get(&path.replace("page=1", "page=2"), Some(&alice))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get("/api/faces/?person=abc&inferred=true", Some(&alice))
            .await
            .status,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(app.get(&path, None).await.status, StatusCode::UNAUTHORIZED);
    app.cleanup().await;
}

#[tokio::test]
async fn cluster_faces_scatter() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let res = app.get("/api/clusterfaces", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["status"], true);
    let data = body["data"].as_array().unwrap();
    // Faces 1..=10: alice's non-deleted faces, all encoded.
    assert_eq!(data.len(), 10);
    for p in data {
        for k in ["x", "y", "size"] {
            assert!(p["value"][k].as_f64().unwrap().is_finite());
        }
        let inferred = p["person_label_is_inferred"].as_bool().unwrap();
        assert_eq!(inferred, p["person_id"] == -1);
        assert_eq!(inferred, p["color"] == "#000000");
    }
    // The projection is centered.
    let sum: f64 = data.iter().map(|p| p["value"]["x"].as_f64().unwrap()).sum();
    assert!(sum.abs() < 1e-9);
    let dave = token(&app, "dave").await;
    assert_eq!(
        app.get("/api/clusterfaces", Some(&dave)).await.json(),
        json!({"status": true, "data": []})
    );
    app.cleanup().await;
}

#[tokio::test]
async fn face_jobs() {
    let app = TestApp::with_env(&[
        ("FEATURE_FACE_DETECTION", "0"),
        ("FEATURE_FACE_CLUSTER", "0"),
    ])
    .await;
    let alice = token(&app, "alice").await;
    let res = app.get("/api/scanfaces", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Face detection is disabled"})
    );
    let res = app
        .post_json("/api/trainfaces", &json!({}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(res.json()["message"], "Face clustering is disabled");
    assert_eq!(
        app.get("/api/scanfaces", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    app.cleanup().await;

    let app = TestApp::new().await;
    let alice_user = lp_db::users::by_username(app.pool(), "alice")
        .await
        .unwrap()
        .unwrap();
    let alice = app.token_for(&alice_user);
    for (method_post, path, kind, job_type) in [
        (false, "/api/scanfaces", "faces.scan", 7),
        (true, "/api/scanfaces", "faces.scan", 7),
        (true, "/api/trainfaces", "faces.train", 4),
    ] {
        let res = if method_post {
            app.post_json(path, &json!({}), Some(&alice)).await
        } else {
            app.get(path, Some(&alice)).await
        };
        assert_eq!(res.status, StatusCode::OK, "{}", res.text());
        let body = res.json();
        assert_eq!(body["status"], true);
        let job_id = body["job_id"].as_str().unwrap().to_string();
        let (k, payload): (String, Value) =
            sqlx::query_as("SELECT kind, payload FROM job_queue WHERE lrj_id = $1")
                .bind(&job_id)
                .fetch_one(app.pool())
                .await
                .unwrap();
        assert_eq!(k, kind);
        assert_eq!(payload, json!({"user_id": alice_user.id}));
        let jt: i32 =
            sqlx::query_scalar("SELECT job_type FROM api_longrunningjob WHERE job_id = $1")
                .bind(&job_id)
                .fetch_one(app.pool())
                .await
                .unwrap();
        assert_eq!(jt, job_type);
    }
    assert_eq!(
        app.get("/api/trainfaces", Some(&alice)).await.status,
        StatusCode::METHOD_NOT_ALLOWED
    );
    app.cleanup().await;
}

async fn face_row(app: &TestApp, id: i64) -> (Option<i32>, Option<i32>, Option<i32>, bool) {
    sqlx::query_as(
        "SELECT person_id, cluster_person_id, classification_person_id, deleted FROM api_face WHERE id = $1",
    )
    .bind(id as i32)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn person_row(app: &TestApp, id: i64) -> (String, i32, Option<i32>, Option<uuid::Uuid>) {
    sqlx::query_as(
        "SELECT name, face_count, cover_face_id, cover_photo_id FROM api_person WHERE id = $1",
    )
    .bind(id as i32)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn captions(app: &TestApp, photo: &str) -> String {
    sqlx::query_scalar("SELECT search_captions FROM api_photo_search WHERE photo_id = $1::uuid")
        .bind(photo)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn label_and_delete_faces() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let unknown = m["faces"]["unknown"][0].as_i64().unwrap();
    let inferred_ben = m["faces"]["inferred_ben"][0].as_i64().unwrap();
    let e2e_08 = m["photos"]["alice/e2e_08"]["id"].as_str().unwrap();

    for (name, expected) in [
        ("  ", "person_name must not be empty"),
        (
            "Cluster 1",
            "\"Cluster 1\" is the label of a face cluster, not a person. Name the face instead of confirming the cluster.",
        ),
    ] {
        let res = app
            .post_json(
                "/api/labelfaces",
                &json!({"face_ids": [unknown], "person_name": name}),
                Some(&alice),
            )
            .await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST);
        assert_eq!(res.json(), json!({"status": false, "message": expected}));
    }

    // Bob cannot touch alice's faces: nothing comes back, nothing changes.
    let res = app
        .post_json(
            "/api/labelfaces",
            &json!({"face_ids": [unknown], "person_name": "Mallory"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["results"], json!([]));
    assert_eq!(face_row(&app, unknown).await.0, None);

    let res = app
        .post_json(
            "/api/labelfaces",
            &json!({"face_ids": [unknown, inferred_ben], "person_name": " Carla "}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["status"], true);
    assert_eq!(body["results"], body["updated"]);
    assert_eq!(body["not_updated"], json!([]));
    let r = &body["results"][0];
    let keys: Vec<_> = r.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        keys,
        [
            "id",
            "image",
            "face_url",
            "photo",
            "timestamp",
            "person",
            "person_label_probability",
            "person_name"
        ]
    );
    assert_eq!(r["person_name"], "Carla");
    assert!(r["image"].as_str().unwrap().starts_with("/media/faces/"));
    let carla = r["person"].as_i64().unwrap();
    let (name, count, cover_face, cover_photo) = person_row(&app, carla).await;
    assert_eq!((name.as_str(), count), ("Carla", 2));
    assert_eq!(cover_face, Some(inferred_ben as i32));
    assert!(cover_photo.is_some());
    assert!(captions(&app, e2e_08).await.contains("Carla"));
    // Inferred labels stay when a face gets a person.
    assert_eq!(
        face_row(&app, inferred_ben).await.1,
        Some(m["persons"]["ben"]["id"].as_i64().unwrap() as i32)
    );

    // Back to unknown: the inferred labels go too, Carla's count drops.
    let res = app
        .post_json(
            "/api/labelfaces",
            &json!({"face_ids": [inferred_ben], "person_name": "Unknown - Other"}),
            Some(&alice),
        )
        .await;
    let body = res.json();
    assert_eq!(body["results"][0]["person"], Value::Null);
    assert_eq!(body["results"][0]["person_name"], "Unknown - Other");
    assert_eq!(
        face_row(&app, inferred_ben).await,
        (None, None, None, false)
    );
    assert_eq!(person_row(&app, carla).await.1, 1);

    // Relabelling one of Anna's faces moves the count.
    let anna = m["persons"]["anna"]["id"].as_i64().unwrap();
    let anna_face = m["faces"]["anna"][3].as_i64().unwrap();
    app.post_json(
        "/api/labelfaces",
        &json!({"face_ids": [anna_face], "person_name": "Carla"}),
        Some(&alice),
    )
    .await;
    assert_eq!(person_row(&app, anna).await.1, 4);
    assert_eq!(person_row(&app, carla).await.1, 2);

    // Soft delete.
    let res = app
        .post_json(
            "/api/deletefaces",
            &json!({"face_ids": [unknown]}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.json()["deleted"], json!([]));
    assert!(!face_row(&app, unknown).await.3);
    let res = app
        .post_json(
            "/api/deletefaces",
            &json!({"face_ids": [unknown, 999999]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["status"], true);
    assert_eq!(body["results"].as_array().unwrap().len(), 1);
    assert!(
        body["deleted"][0]
            .as_str()
            .unwrap()
            .starts_with("/media/faces/")
    );
    assert!(face_row(&app, unknown).await.3);
    assert_eq!(
        app.post_json("/api/deletefaces", &json!({"face_ids": [unknown]}), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    app.cleanup().await;
}

#[tokio::test]
async fn person_patch_and_delete() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let ben = m["persons"]["ben"]["id"].as_i64().unwrap();
    let path = format!("/api/persons/{ben}/");

    assert_eq!(
        app.patch_json(&path, &json!({"newPersonName": "pwned"}), Some(&bob))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let res = app
        .patch_json(
            &path,
            &json!({"newPersonName": "  Benjamin "}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert_eq!(res.json()["name"], "Benjamin");
    assert_eq!(person_row(&app, ben).await.0, "Benjamin");

    let res = app
        .patch_json(&path, &json!({"newPersonName": ""}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"errors": [{"field": "newPersonName", "message": "This field may not be blank."}]})
    );

    // Cover by hash, then by uuid; the cover face is Ben's face on that photo.
    let e2e_01 = &m["photos"]["alice/e2e_01"];
    let res = app
        .patch_json(
            &path,
            &json!({"cover_photo": e2e_01["image_hash"]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert_eq!(res.json()["face_photo_url"], e2e_01["image_hash"]);
    let (_, _, cover_face, cover_photo) = person_row(&app, ben).await;
    assert_eq!(
        cover_photo.unwrap().to_string(),
        e2e_01["id"].as_str().unwrap()
    );
    assert_eq!(cover_face, Some(6));
    let e2e_02 = &m["photos"]["alice/e2e_02"];
    let res = app
        .patch_json(&path, &json!({"cover_photo": e2e_02["id"]}), Some(&alice))
        .await;
    assert_eq!(res.json()["face_photo_url"], e2e_02["image_hash"]);
    assert_eq!(person_row(&app, ben).await.2, None);

    // Someone else's photo is "not found".
    let bobs = &m["photos"]["bob/own_01"];
    let bobs_hash = bobs["image_hash"].as_str().unwrap_or("0000");
    let res = app
        .patch_json(&path, &json!({"cover_photo": bobs_hash}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["errors"][0],
        json!({"field": "cover_photo", "message": format!("Photo not found: {bobs_hash}")})
    );

    assert_eq!(
        app.delete(&path, None, Some(&bob)).await.status,
        StatusCode::NOT_FOUND
    );
    let res = app.delete(&path, None, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    let left: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM api_face WHERE person_id = $1 OR cluster_person_id = $1 OR classification_person_id = $1",
    )
    .bind(ben as i32)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(left, 0);
    assert_eq!(
        app.get(&path, Some(&alice)).await.status,
        StatusCode::NOT_FOUND
    );
    app.cleanup().await;
}

#[tokio::test]
async fn add_face_draws_a_labelled_face() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let photo = &m["photos"]["alice/e2e_05"];
    let hash = photo["image_hash"].as_str().unwrap();

    let media = app.state.config.media_root.clone();
    std::fs::create_dir_all(media.join("thumbnails_big")).unwrap();
    let fixture_root = m["media_root"].as_str().unwrap();
    std::fs::copy(
        std::path::Path::new(fixture_root).join(format!("thumbnails_big/{hash}.webp")),
        media.join(format!("thumbnails_big/{hash}.webp")),
    )
    .unwrap();

    let body = |b: Value| json!({"photo": photo["id"], "person_name": "Dora", "box": b});
    let good = json!({"top": 0.5, "right": 0.8, "bottom": 0.8, "left": 0.6});

    let res = app
        .post_json("/api/addface", &body(good.clone()), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "photo not found"})
    );

    let over = json!({"top": 0.2, "right": 0.5, "bottom": 0.45, "left": 0.3});
    let res = app
        .post_json("/api/addface", &body(over), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::CONFLICT);

    let res = app
        .post_json(
            "/api/addface",
            &body(json!({"top": 0.5, "right": 0.51, "bottom": 0.8, "left": 0.5})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let res = app
        .post_json(
            "/api/addface",
            &json!({"photo": hash, "person_name": "Unknown - Other", "box": good}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);

    let res = app
        .post_json("/api/addface", &body(good.clone()), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    let face = res.json()["face"].clone();
    assert_eq!(face["person_name"], "Dora");
    assert_eq!(
        face["location"],
        json!({"top": 300, "right": 640, "bottom": 480, "left": 480})
    );
    let url = face["face_url"].as_str().unwrap();
    assert!(url.starts_with(&format!("/media/faces/{hash}_manual_")));
    let crop = image::open(media.join(url.trim_start_matches("/media/"))).unwrap();
    assert_eq!((crop.width(), crop.height()), (160, 180));

    let (person, cluster, deleted, encoding): (Option<i32>, Option<i32>, bool, String) =
        sqlx::query_as(
            "SELECT person_id, cluster_id, deleted, encoding FROM api_face WHERE id = $1",
        )
        .bind(face["face_id"].as_i64().unwrap() as i32)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(person.map(i64::from), face["person"].as_i64());
    assert_eq!((cluster, deleted), (None, false));
    // No face service in tests: the face is kept without an encoding.
    assert_eq!(encoding, "");
    let (name, count, cover_face, _) = person_row(&app, face["person"].as_i64().unwrap()).await;
    assert_eq!((name.as_str(), count), ("Dora", 1));
    assert_eq!(cover_face.map(i64::from), face["face_id"].as_i64());
    assert!(
        captions(&app, photo["id"].as_str().unwrap())
            .await
            .contains("Dora")
    );

    // The same box again now overlaps the new face.
    let res = app
        .post_json("/api/addface", &body(good), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::CONFLICT);

    // A photo without a big thumbnail file cannot be measured.
    let other = &m["photos"]["alice/e2e_06"];
    let res = app
        .post_json(
            "/api/addface",
            &json!({"photo": other["image_hash"], "person_name": "Dora", "box": {"top": 0.5, "right": 0.8, "bottom": 0.8, "left": 0.6}}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["message"],
        "this photo's thumbnail cannot be read"
    );
    app.cleanup().await;
}

#[tokio::test]
async fn person_create_put_and_rename_captions() {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let ben = m["persons"]["ben"]["id"].as_i64().unwrap();
    let anna = m["persons"]["anna"]["id"].as_i64().unwrap();
    let path = format!("/api/persons/{ben}/");

    // The list's search narrows the detail routes, as DRF's get_object does.
    let res = app
        .get(&format!("/api/persons/{anna}/?search=zzz"), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    // Rename rebuilds the search captions of the photos Ben is labelled on (S19).
    let ben_photo: uuid::Uuid = sqlx::query_scalar(
        "SELECT photo_id FROM api_face WHERE person_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(ben as i32)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let before = captions(&app, &ben_photo.to_string()).await;
    assert!(!before.contains("Benjamin"), "{before}");
    let res = app
        .patch_json(&path, &json!({"newPersonName": "Benjamin"}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert!(
        captions(&app, &ben_photo.to_string())
            .await
            .contains("Benjamin")
    );

    // The serializer's model fields are validated even though update ignores them.
    let res = app
        .patch_json(
            &path,
            &json!({"name": "", "face_count": "abc"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"errors": [
            {"field": "name", "message": "This field may not be blank."},
            {"field": "face_count", "message": "A valid integer is required."}
        ]})
    );

    // PUT needs `name`; `newPersonName` renames, its absence changes nothing.
    let put = |body: Value, tok: String| {
        let app = &app;
        let path = path.clone();
        async move {
            app.send(axum::http::Method::PUT, &path, Some(&body), Some(&tok))
                .await
        }
    };
    let res = put(json!({}), alice.clone()).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "name");
    assert_eq!(
        put(json!({"name": "x"}), bob.clone()).await.status,
        StatusCode::NOT_FOUND
    );
    let res = put(json!({"name": "x"}), alice.clone()).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert_eq!(res.json()["name"], "Benjamin");
    let res = put(json!({"name": "x", "newPersonName": "Ben"}), alice.clone()).await;
    assert_eq!(res.json()["name"], "Ben");
    assert_eq!(person_row(&app, ben).await.0, "Ben");

    // POST finds the requester's person of that name (any kind) or makes one.
    let res = app
        .post_json("/api/persons/", &json!({}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let res = app
        .post_json("/api/persons/", &json!({"name": " Zoe "}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    let zoe = res.json();
    assert_eq!(zoe["name"], "Zoe");
    assert_eq!(zoe["face_count"], 0);
    assert_eq!(zoe["face_url"], "");
    assert_eq!(zoe["video"], false);
    let again = app
        .post_json("/api/persons/", &json!({"name": "Zoe"}), Some(&alice))
        .await;
    assert_eq!(again.status, StatusCode::CREATED);
    assert_eq!(again.json()["id"], zoe["id"]);
    let res = app
        .post_json("/api/persons/", &json!({"name": "Cluster 1"}), Some(&alice))
        .await;
    assert_eq!(res.json()["id"], m["persons"]["cluster_1"]["id"]);
    // Bob gets his own Zoe.
    let res = app
        .post_json("/api/persons/", &json!({"name": "Zoe"}), Some(&bob))
        .await;
    assert_ne!(res.json()["id"], zoe["id"]);
    assert_eq!(
        app.post_json("/api/persons/", &json!({"name": "Zoe"}), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    app.cleanup().await;
}
