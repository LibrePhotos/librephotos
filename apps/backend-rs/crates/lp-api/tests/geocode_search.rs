//! `/api/geocode/search` against a local stub of Nominatim / TomTom
//! (`LP_GEOCODE_*_URL`; this binary sets them for itself only).

use std::sync::{Arc, Mutex};

use axum::Json;
use axum::Router;
use axum::extract::{Path, RawQuery};
use axum::http::StatusCode;
use axum::routing::get;
use lp_testkit::TestApp;
use serde_json::{Value, json};

#[tokio::test]
async fn geocode_search() {
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let stub = Router::new()
        .route(
            "/search",
            get({
                let seen = seen.clone();
                move |RawQuery(q): RawQuery| async move {
                    let q = q.unwrap_or_default();
                    seen.lock().unwrap().push(q.clone());
                    if q.contains("boom") {
                        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({})));
                    }
                    if q.contains("nothing") {
                        return (StatusCode::OK, Json(json!([])));
                    }
                    (
                        StatusCode::OK,
                        Json(json!([
                            {"display_name": "Brandenburger Tor, Berlin", "lat": "52.5162699", "lon": "13.3777034"},
                            {"display_name": "Tor 2", "lat": "1.5", "lon": "-2.25"}
                        ])),
                    )
                }
            }),
        )
        .route(
            "/search/2/geocode/{q}",
            get({
                let seen = seen.clone();
                move |Path(q): Path<String>, RawQuery(params): RawQuery| async move {
                    seen.lock().unwrap().push(format!("tomtom {q} {}", params.unwrap_or_default()));
                    Json(json!({"results": [
                        {"address": {"freeformAddress": "Pariser Platz"}, "position": {"lat": 52.5, "lon": 13.4}}
                    ]}))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, stub).await.unwrap() });
    // SAFETY: set before any request of this (single-test) binary reads them.
    unsafe {
        std::env::set_var("LP_GEOCODE_NOMINATIM_URL", &origin);
        std::env::set_var("LP_GEOCODE_TOMTOM_URL", &origin);
    }

    let app = TestApp::new().await;
    let user = app.create_user("geo_user", "pw", false).await;
    let token = app.token_for(&user);

    assert_eq!(
        app.get("/api/geocode/search?q=x", None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let res = app.get("/api/geocode/search?q=%20%20", Some(&token)).await;
    assert_eq!(res.json(), json!([]));
    assert!(seen.lock().unwrap().is_empty());

    let res = app
        .get(
            "/api/geocode/search?q=Brandenburger%20Tor&limit=2",
            Some(&token),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.json(),
        json!([
            {"display_name": "Brandenburger Tor, Berlin", "lat": 52.5162699, "lon": 13.3777034},
            {"display_name": "Tor 2", "lat": 1.5, "lon": -2.25}
        ])
    );
    let q = seen.lock().unwrap().last().unwrap().clone();
    assert!(
        q.contains("q=Brandenburger+Tor") || q.contains("q=Brandenburger%20Tor"),
        "{q}"
    );
    assert!(q.contains("format=json") && q.contains("limit=2"), "{q}");

    // Default limit 5; provider errors and empty answers are [].
    app.get("/api/geocode/search?q=abc", Some(&token)).await;
    assert!(seen.lock().unwrap().last().unwrap().contains("limit=5"));
    assert_eq!(
        app.get("/api/geocode/search?q=boom", Some(&token))
            .await
            .json(),
        json!([])
    );
    assert_eq!(
        app.get("/api/geocode/search?q=nothing", Some(&token))
            .await
            .json(),
        json!([])
    );

    // geopy rejects a Nominatim limit below 1 before any request.
    let before = seen.lock().unwrap().len();
    assert_eq!(
        app.get("/api/geocode/search?q=abc&limit=0", Some(&token))
            .await
            .json(),
        json!([])
    );
    assert_eq!(seen.lock().unwrap().len(), before);

    // Django's int(limit) raises on junk: a 500.
    let res = app
        .get("/api/geocode/search?q=abc&limit=abc", Some(&token))
        .await;
    assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR);

    // Providers whose geopy geocode() takes no `limit` always answer [].
    lp_db::write::settings::save(&app.state, &[("MAP_API_PROVIDER", json!("mapbox"))])
        .await
        .unwrap();
    assert_eq!(
        app.get("/api/geocode/search?q=abc", Some(&token))
            .await
            .json(),
        json!([])
    );
    assert_eq!(seen.lock().unwrap().len(), before);

    lp_db::write::settings::save(
        &app.state,
        &[
            ("MAP_API_PROVIDER", json!("tomtom")),
            ("MAP_API_KEY", json!("k")),
        ],
    )
    .await
    .unwrap();
    let res = app
        .get(
            "/api/geocode/search?q=Pariser%20Platz&limit=3",
            Some(&token),
        )
        .await;
    assert_eq!(
        res.json(),
        json!([{"display_name": "Pariser Platz", "lat": 52.5, "lon": 13.4}])
    );
    let last: Value = json!(seen.lock().unwrap().last().unwrap());
    let last = last.as_str().unwrap();
    assert!(last.starts_with("tomtom Pariser Platz.json"), "{last}");
    assert!(
        last.contains("key=k") && last.contains("typeahead=false") && last.contains("limit=3"),
        "{last}"
    );
    app.cleanup().await;
}
