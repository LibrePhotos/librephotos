//! The call policy of `api/sidecars.py` against a scripted local server:
//! retries on refused connections and 503, never on a read timeout, and the
//! sidecar's own error text on failures.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use axum::Router;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use lp_sidecars::{Sidecar, SidecarError, Sidecars, Unload};
use serde_json::json;

async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn client(base: &str, sidecar: Sidecar) -> Sidecars {
    Sidecars::new(reqwest::Client::new(), "127.0.0.1").with_base(sidecar, base)
}

#[tokio::test]
async fn busy_503_is_retried_twice() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let app = Router::new().route(
        "/generate-caption",
        post(move || {
            let h = h.clone();
            async move {
                if h.fetch_add(1, Ordering::SeqCst) < 2 {
                    (StatusCode::SERVICE_UNAVAILABLE, "busy").into_response()
                } else {
                    axum::Json(json!({"caption": "a dog"})).into_response()
                }
            }
        }),
    );
    let base = serve(app).await;
    let started = Instant::now();
    let caption = client(&base, Sidecar::Caption)
        .generate_caption("/x.webp", None)
        .await
        .unwrap();
    assert_eq!(caption, "a dog");
    assert_eq!(hits.load(Ordering::SeqCst), 3);
    // no wait before the first retry, 1 s before the second
    assert!(started.elapsed() >= Duration::from_millis(950));
}

#[tokio::test]
async fn persistent_503_reports_the_last_answer() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let app = Router::new().route(
        "/ocr",
        post(move || {
            let h = h.clone();
            async move {
                h.fetch_add(1, Ordering::SeqCst);
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    axum::Json(json!({"error": "loading model"})),
                )
            }
        }),
    );
    let base = serve(app).await;
    let err = client(&base, Sidecar::Ocr)
        .ocr("/x.jpg", 0.6)
        .await
        .unwrap_err();
    assert_eq!(err.status(), Some(503));
    assert_eq!(err.detail(), "loading model");
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn other_errors_are_not_retried_and_carry_the_reason() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let h2 = hits.clone();
    let app = Router::new()
        .route(
            "/generate-tags",
            post(move || {
                let h = h.clone();
                async move {
                    h.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        axum::Json(json!({"error": "Failed to process image"})),
                    )
                }
            }),
        )
        .route(
            "/face-locations",
            post(move || {
                let h = h2.clone();
                async move {
                    h.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::BAD_GATEWAY,
                        [("content-type", "text/html")],
                        "<html><body><h1>Bad Gateway</h1><p>upstream &amp; down</p></body></html>",
                    )
                }
            }),
        );
    let base = serve(app).await;
    let sc = client(&base, Sidecar::Tags).with_base(Sidecar::Face, &base);
    let err = sc
        .generate_tags("/x", 0.1, "mobileclip_s2")
        .await
        .unwrap_err();
    assert_eq!(
        (err.status(), err.detail().as_str()),
        (Some(500), "Failed to process image")
    );
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    let err = sc.detect_faces("/x", "buffalo_sc").await.unwrap_err();
    assert_eq!(err.detail(), "Bad Gateway upstream & down");
    assert!(err.to_string().contains("status 502"), "{err}");
}

#[tokio::test]
async fn refused_connections_are_retried_then_reported() {
    // A port nobody listens on.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let started = Instant::now();
    let err = client(&base, Sidecar::Clip)
        .clip_embeddings(&["/a".into()], "m")
        .await
        .unwrap_err();
    assert!(matches!(err, SidecarError::Unreachable { .. }), "{err:?}");
    assert!(
        started.elapsed() >= Duration::from_millis(950),
        "three attempts"
    );
}

#[tokio::test]
async fn a_read_timeout_is_not_retried() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let app = Router::new().route(
        "/cluster",
        post(move || {
            let h = h.clone();
            async move {
                h.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_secs(10)).await;
                axum::Json(json!({"ids": [], "labels": []}))
            }
        }),
    );
    let base = serve(app).await;
    let sc = client(&base, Sidecar::FaceCluster)
        .with_timeout(Sidecar::FaceCluster, Duration::from_millis(300));
    let req = lp_sidecars::ClusterRequest {
        faces: vec![],
        min_cluster_size: 2,
        min_samples: 1,
        cluster_selection_epsilon: 0.0,
    };
    let err = sc.cluster_faces(&req).await.unwrap_err();
    assert!(err.is_timeout(), "{err:?}");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn typed_replies() {
    let app = Router::new()
        .route(
            "/face-locations",
            post(|| async {
                axum::Json(json!({"face_locations": [[10, 50, 60, 5], [1, 2, 3, 4]], "encodings": [[0.5, 0.25]]}))
            }),
        )
        .route("/health", get(|| async { axum::Json(json!({"status": "OK", "service": "tags", "busy": true, "model_loaded": null, "last_request_time": 12.5})) }))
        .route("/unload-model", post(|| async { (StatusCode::CONFLICT, axum::Json(json!({"status": "busy"}))) }))
        .route("/build/", post(|| async { axum::Json(json!({"status": true, "index_size": 3})) }))
        .route("/train", post(|| async { axum::Json(json!({"predictions": [{"id": 1, "cluster_person_id": 2, "cluster_probability": 0.5, "classification_person_id": null, "classification_probability": 0.0}]})) }))
        .route("/cluster", post(|| async { axum::Json(json!({"ids": [1], "labels": [0, 1]})) }));
    let base = serve(app).await;
    let mut sc = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    for s in Sidecar::ALL {
        sc = sc.with_base(s, &base);
    }
    // An encoding count that does not match drops them all (detect_faces).
    let faces = sc.detect_faces("/x", "buffalo_sc").await.unwrap();
    assert_eq!(faces.len(), 2);
    assert_eq!(faces[0].location, [10, 50, 60, 5]);
    assert!(faces.iter().all(|f| f.encoding.is_none()));
    let health = sc.health(Sidecar::Tags).await.unwrap();
    assert!(health.busy && health.status == "OK");
    assert_eq!(sc.unload_model(Sidecar::Tags).await.unwrap(), Unload::Busy);
    let hashes = vec!["a".to_string()];
    let embeddings = vec![vec![0.1f32, 0.2]];
    let reply = sc
        .similarity_build(&lp_sidecars::SimilarityBuild {
            user_id: 1,
            image_hashes: &hashes,
            image_embeddings: &embeddings,
            begin: true,
            commit: true,
        })
        .await
        .unwrap();
    assert_eq!(reply.index_size, Some(3));
    let train = sc
        .train_faces(&lp_sidecars::TrainRequest {
            known: vec![],
            clusters: vec![],
            unknown: vec![],
        })
        .await
        .unwrap();
    assert_eq!(train.predictions[0].classification_person_id, None);
    // Fewer or more labels than faces is a broken reply.
    let req = lp_sidecars::ClusterRequest {
        faces: vec![lp_sidecars::ClusterFace {
            id: 1,
            encoding: "00".into(),
        }],
        min_cluster_size: 2,
        min_samples: 1,
        cluster_selection_epsilon: 0.0,
    };
    assert!(matches!(
        sc.cluster_faces(&req).await,
        Err(SidecarError::Body { .. })
    ));
}

#[test]
fn defaults_follow_http_timeouts() {
    assert_eq!(Sidecar::Face.timeout(), Duration::from_secs(60));
    assert_eq!(Sidecar::Clip.timeout(), Duration::from_secs(120));
    assert_eq!(Sidecar::Ocr.timeout(), Duration::from_secs(180));
    let sc = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    assert_eq!(
        sc.url(Sidecar::FaceCluster, "/cluster"),
        "http://127.0.0.1:8013/cluster"
    );
    assert_eq!(
        sc.url(Sidecar::Similarity, "/build/"),
        "http://127.0.0.1:8002/build/"
    );
    assert_eq!(lp_sidecars::error_detail(b"", None), "<empty body>");
    let long = "x".repeat(600);
    assert!(
        lp_sidecars::error_detail(long.as_bytes(), None).ends_with("... [truncated 100 chars]")
    );
}
