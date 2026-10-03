//! Semantic search (`semantic_search_topk > 0`) against stub CLIP (:8006) and
//! similarity (:8002) sidecars bound on a private loopback address.
#![allow(clippy::disallowed_methods)] // sets the user's topk

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use http_body_util::BodyExt;
use lp_core::AppState;
use lp_testkit::TestApp;
use serde_json::{Value, json};
use tower::ServiceExt;

/// Bind both stub ports on the same 127.0.0.x (Windows and Linux route all of 127/8).
async fn bind_pair() -> (IpAddr, tokio::net::TcpListener, tokio::net::TcpListener) {
    for _ in 0..50 {
        let n = 2 + (uuid::Uuid::new_v4().as_u128() % 250) as u8;
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, n));
        let Ok(clip) = tokio::net::TcpListener::bind(SocketAddr::new(ip, 8006)).await else {
            continue;
        };
        let Ok(sim) = tokio::net::TcpListener::bind(SocketAddr::new(ip, 8002)).await else {
            continue;
        };
        return (ip, clip, sim);
    }
    panic!("no free 127.0.0.x for the stub sidecars");
}

async fn get(state: &AppState, path: &str, token: &str) -> (StatusCode, Value) {
    let router = lp_api::search_sharing_public::routes().with_state(state.clone());
    let res = router
        .oneshot(
            Request::get(path)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn semantic_search_through_the_sidecars() {
    let app = TestApp::new().await;
    let m: Value =
        serde_json::from_str(
            &std::fs::read_to_string(std::env::var("LP_MANIFEST").unwrap_or_else(|_| {
                "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into()
            }))
            .unwrap(),
        )
        .unwrap();
    sqlx::query("UPDATE api_user SET semantic_search_topk = 3 WHERE username = 'alice'")
        .execute(app.pool())
        .await
        .unwrap();
    let alice = lp_db::users::by_username(app.pool(), "alice")
        .await
        .unwrap()
        .unwrap();
    let token = app.token_for(&alice);
    let semantic_hit = m["photos"]["alice/e2e_02"]["image_hash"]
        .as_str()
        .unwrap()
        .to_string();

    // Sidecars down: no search term never calls them (flat list of everything),
    // a search term is a 500 like Django's unhandled ConnectionError.
    let mut state = app.state.clone();
    // The sidecar path (auto would pick the in-process index).
    for s in [lp_ml::Service::Clip, lp_ml::Service::Similarity] {
        state.ml.set_mode(s, lp_ml::Mode::Sidecar);
    }
    let (ip, clip_l, sim_l) = bind_pair().await;
    drop((clip_l, sim_l));
    state.sidecars = lp_sidecars::Sidecars::new(state.http.clone(), ip.to_string());
    let (status, body) = get(&state, "/api/photos/searchlist?search=", &token).await;
    assert_eq!(status, StatusCode::OK);
    let flat = body["results"].as_array().unwrap();
    assert!(!flat.is_empty());
    assert!(flat[0].get("image_hash").is_some(), "flat PigPhoto list");
    let (status, _) = get(&state, "/api/photos/searchlist?search=berlin", &token).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);

    // Stubs up.
    let (ip, clip_l, sim_l) = bind_pair().await;
    let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
    let sim_status = Arc::new(Mutex::new(StatusCode::OK));
    let clip = Router::new().route(
        "/query-embeddings",
        post({
            let seen = seen.clone();
            move |Json(body): Json<Value>| async move {
                seen.lock().unwrap().push(body);
                Json(json!({"emb": [0.5, 0.25, 0.125], "magnitude": 1.0}))
            }
        }),
    );
    let sim = Router::new().route(
        "/search/",
        post({
            let seen = seen.clone();
            let sim_status = sim_status.clone();
            let hit = semantic_hit.clone();
            move |Json(body): Json<Value>| async move {
                seen.lock().unwrap().push(body);
                let status = *sim_status.lock().unwrap();
                (status, Json(json!({"result": [hit]})))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(clip_l, clip).await.unwrap() });
    tokio::spawn(async move { axum::serve(sim_l, sim).await.unwrap() });
    state.sidecars = lp_sidecars::Sidecars::new(state.http.clone(), ip.to_string());

    let (status, body) = get(
        &state,
        "/api/photos/searchlist?search=zzz-nothing-matches",
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let hashes: Vec<&str> = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["image_hash"].as_str().unwrap())
        .collect();
    assert_eq!(hashes, vec![semantic_hit.as_str()]);
    {
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0]["query"], "zzz-nothing-matches");
        assert!(seen[0]["model"].as_str().unwrap().ends_with("clip_vit_b32"));
        assert_eq!(seen[1]["user_id"], alice.id);
        assert_eq!(seen[1]["n"], 3);
        assert_eq!(seen[1]["threshold"], 27);
        assert_eq!(seen[1]["image_embedding"], json!([0.5, 0.25, 0.125]));
    }

    // Text matches are OR-ed with the semantic hits per term.
    let (_, body) = get(&state, "/api/photos/searchlist?search=berlin", &token).await;
    let hashes: Vec<String> = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["image_hash"].as_str().unwrap().to_string())
        .collect();
    assert!(hashes.contains(&semantic_hit));
    assert!(
        hashes.contains(
            &m["photos"]["alice/berlin_01"]["image_hash"]
                .as_str()
                .unwrap()
                .to_string()
        )
    );

    // An error status from the similarity sidecar means "no semantic hits".
    *sim_status.lock().unwrap() = StatusCode::BAD_REQUEST;
    let (status, body) = get(
        &state,
        "/api/photos/searchlist?search=zzz-nothing-matches",
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"], json!([]));
    app.cleanup().await;
}
