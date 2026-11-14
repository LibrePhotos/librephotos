//! Media serving on the fixture (read-only): grants, refusals, addressing,
//! both delivery modes, ranges, HEAD, the photo-share route, downloads and
//! the admin diagnostics. Expectations follow the Django media tests
//! (`api/tests/media_serving/`, `sharing_and_public/test_media_access_authorization.py`).

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use lp_testkit::{TestApp, TestDb};

struct Apps {
    db: TestDb,
    direct: TestApp,
    accel: TestApp,
}

async fn apps() -> Apps {
    let db = TestDb::shared().await;
    let direct = app_on(&db.name, "direct", None).await;
    let accel = app_on(&db.name, "x-accel", None).await;
    Apps { db, direct, accel }
}

impl Apps {
    async fn cleanup(self) {
        self.direct.cleanup().await;
        self.accel.cleanup().await;
        self.db.cleanup().await;
    }
}

async fn status_as(app: &TestApp, who: Option<&str>, path: &str) -> (StatusCode, Option<String>) {
    let tok = match who {
        Some(u) => Some(token(app, u).await),
        None => None,
    };
    let res = app.get(path, tok.as_deref()).await;
    (res.status, res.header("x-media-error").map(str::to_string))
}

/// (role, status); role None = anonymous.
type Expect = (Option<&'static str>, u16);

#[tokio::test]
async fn grant_order_and_refusals() {
    let a = apps().await;
    let m = manifest();
    let foreign = m["shares"]["album_shared_to_carol"]["foreign_photo"]
        .as_str()
        .unwrap();
    // photo key -> [(role, status)], role None = anonymous
    let cases: Vec<(&str, Vec<Expect>)> = vec![
        (
            "alice/e2e_01",
            vec![
                (Some("alice"), 200),
                (Some("bob"), 404),
                (Some("carol"), 404),
                (Some("dave"), 404),
                (Some("admin"), 404),
                (None, 403),
            ],
        ),
        (
            "alice/e2e_06",
            vec![
                (Some("bob"), 200),
                (Some("carol"), 200),
                (Some("dave"), 404),
                (None, 403),
            ],
        ),
        (
            "alice/e2e_07",
            vec![(Some("bob"), 200), (Some("carol"), 404)],
        ),
        ("alice/e2e_05", vec![(Some("dave"), 200), (None, 200)]),
        ("alice/berlin_02", vec![(None, 200), (Some("dave"), 200)]),
        ("alice/tokyo_01", vec![(None, 403), (Some("dave"), 404)]),
        (
            foreign,
            vec![
                (Some("bob"), 200),
                (Some("carol"), 404),
                (Some("alice"), 404),
                (None, 403),
            ],
        ),
        (
            "alice/hidden",
            vec![(Some("alice"), 200), (None, 403), (Some("bob"), 404)],
        ),
        ("alice/trashed", vec![(Some("alice"), 200), (None, 403)]),
    ];
    for app in [&a.direct, &a.accel] {
        for (key, expect) in &cases {
            let p = photo(&m, key);
            for (who, status) in expect {
                for path in [
                    format!("/media/thumbnails_big/{}", p.hash),
                    format!("/media/thumbnails_big/{}", p.id),
                    format!("/media/photos/{}", p.hash),
                ] {
                    let (got, marker) = status_as(app, *who, &path).await;
                    assert_eq!(got.as_u16(), *status, "{key} {path} as {who:?}");
                    let want_marker = (*status == 403).then(|| "authentication".to_string());
                    assert_eq!(marker, want_marker, "{key} {path} as {who:?}");
                }
            }
        }
        for (who, status) in [(Some("alice"), 404), (None, 403)] {
            let (got, _) = status_as(
                app,
                who,
                "/media/thumbnails_big/0123456789abcdef0123456789abcdef9",
            )
            .await;
            assert_eq!(got.as_u16(), status);
            let (got, _) = status_as(
                app,
                who,
                "/media/thumbnails_big/00000000-0000-4000-8000-000000000000",
            )
            .await;
            assert_eq!(got.as_u16(), status);
            let (got, _) = status_as(
                app,
                who,
                "/media/thumbnails_big/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
            )
            .await;
            assert_eq!(got.as_u16(), status);
        }
        // Originals are never addressed by UUID.
        let p = photo(&m, "alice/e2e_01");
        let (got, _) = status_as(app, Some("alice"), &format!("/media/photos/{}", p.id)).await;
        assert_eq!(got, StatusCode::NOT_FOUND);
    }
    a.cleanup().await;
}

#[tokio::test]
async fn direct_mode_streams_the_files() {
    let a = apps().await;
    let m = manifest();
    let root = fixture_root().join("protected_media");
    let alice = token(&a.direct, "alice").await;
    let p = photo(&m, "alice/e2e_01");

    let res = a
        .direct
        .get(&format!("/media/thumbnails_big/{}", p.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("image/webp"));
    assert_eq!(res.header("accept-ranges"), Some("bytes"));
    let name = format!("{}.webp", p.hash);
    assert_eq!(
        res.header("content-disposition"),
        Some(format!("inline; filename=\"{name}\"").as_str())
    );
    let on_disk = std::fs::read(root.join("thumbnails_big").join(&name)).unwrap();
    assert_eq!(res.body.as_ref(), on_disk.as_slice());
    assert_eq!(
        res.header("content-length"),
        Some(on_disk.len().to_string().as_str())
    );

    // The same bytes by UUID and via the jwt cookie (<img> sends no header).
    let cookie = format!("jwt={alice}");
    let res = get_with(
        &a.direct,
        Method::GET,
        &format!("/media/thumbnails_big/{}", p.id),
        &[("cookie", &cookie)],
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body.as_ref(), on_disk.as_slice());

    // A stale cookie is anonymous; a bad bearer header fails the request.
    let res = get_with(
        &a.direct,
        Method::GET,
        &format!("/media/thumbnails_big/{}", p.hash),
        &[("cookie", "jwt=garbage")],
    )
    .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(res.header("x-media-error"), Some("authentication"));
    let res = get_with(
        &a.direct,
        Method::GET,
        &format!("/media/thumbnails_big/{}", p.hash),
        &[("authorization", "Bearer garbage")],
    )
    .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // Original: sniffed type, inline disposition naming the file.
    let res = a
        .direct
        .get(&format!("/media/photos/{}", p.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("image/jpeg"));
    assert_eq!(
        res.body.as_ref(),
        std::fs::read(&p.path).unwrap().as_slice()
    );
    assert_eq!(
        res.header("content-disposition"),
        Some("inline; filename=\"e2e_01.jpg\"")
    );

    // Non-ASCII file names use RFC 5987.
    let u = photo(&m, "alice/unicode");
    let res = a
        .direct
        .get(&format!("/media/photos/{}", u.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(
        res.header("content-disposition")
            .unwrap()
            .starts_with("inline; filename*=utf-8''Stra%C3%9Fe")
    );

    // Video square thumbnail is an mp4; faces are jpg; the video original is sniffed.
    let v = photo(&m, "alice/video");
    let res = a
        .direct
        .get(
            &format!("/media/square_thumbnails/{}", v.hash),
            Some(&alice),
        )
        .await;
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    let res = a
        .direct
        .get(&format!("/media/photos/{}.mp4", v.hash), Some(&alice))
        .await;
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert!(res.header("cache-control").is_none());
    let res = a
        .direct
        .get(&format!("/media/faces/{}_0.jpg", p.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("image/jpg"));

    // No thumbnail row value: falls back to the request name, then 404.
    let nt = photo(&m, "alice/no_thumbnail");
    let res = a
        .direct
        .get(&format!("/media/thumbnails_big/{}", nt.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    a.cleanup().await;
}

#[tokio::test]
async fn ranges_and_head() {
    let a = apps().await;
    let m = manifest();
    let alice = token(&a.direct, "alice").await;
    let auth = bearer(&alice);
    let v = photo(&m, "alice/video");
    let path = format!("/media/photos/{}.mp4", v.hash);
    let whole = std::fs::read(&v.path).unwrap();
    let size = whole.len();

    let res = get_with(
        &a.direct,
        Method::GET,
        &path,
        &[("authorization", &auth), ("range", "bytes=0-99")],
    )
    .await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        res.header("content-range"),
        Some(format!("bytes 0-99/{size}").as_str())
    );
    assert_eq!(res.header("content-length"), Some("100"));
    assert_eq!(res.body.as_ref(), &whole[..100]);
    assert!(res.header("content-disposition").is_none());

    let res = get_with(
        &a.direct,
        Method::GET,
        &path,
        &[("authorization", &auth), ("range", "bytes=-10")],
    )
    .await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.body.as_ref(), &whole[size - 10..]);

    let res = get_with(
        &a.direct,
        Method::GET,
        &path,
        &[("authorization", &auth), ("range", "bytes=100-")],
    )
    .await;
    assert_eq!(res.body.as_ref(), &whole[100..]);

    let res = get_with(
        &a.direct,
        Method::GET,
        &path,
        &[
            ("authorization", &auth),
            ("range", &format!("bytes={size}-")),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(
        res.header("content-range"),
        Some(format!("bytes */{size}").as_str())
    );

    let res = get_with(
        &a.direct,
        Method::GET,
        &path,
        &[("authorization", &auth), ("range", "bytes=0-1,4-5")],
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body.len(), size);

    let res = get_with(&a.direct, Method::HEAD, &path, &[("authorization", &auth)]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.header("content-length"),
        Some(size.to_string().as_str())
    );
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert!(res.body.is_empty());
    a.cleanup().await;
}

#[tokio::test]
async fn x_accel_hand_offs() {
    let a = apps().await;
    let m = manifest();
    let alice = token(&a.accel, "alice").await;
    let bob = token(&a.accel, "bob").await;
    let carol = token(&a.accel, "carol").await;
    let p = photo(&m, "alice/e2e_01");

    let res = a
        .accel
        .get(&format!("/media/thumbnails_big/{}", p.id), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.body.is_empty());
    assert_eq!(res.header("content-type"), Some("image/webp"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/thumbnails_big/{}.webp", p.hash).as_str())
    );
    let res = a
        .accel
        .get(
            &format!("/media/square_thumbnails_small/{}", p.hash),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/square_thumbnails_small/{}.webp", p.hash).as_str())
    );
    let v = photo(&m, "alice/video");
    let res = a
        .accel
        .get(
            &format!("/media/square_thumbnails/{}", v.hash),
            Some(&alice),
        )
        .await;
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/square_thumbnails/{}.mp4", v.hash).as_str())
    );
    let res = a
        .accel
        .get(&format!("/media/faces/{}_0.jpg", p.hash), Some(&alice))
        .await;
    assert_eq!(res.header("content-type"), Some("image/jpg"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/faces/{}_0.jpg", p.hash).as_str())
    );

    // Originals: a still is announced as webp; owner and direct share get
    // it inline, an album share does not.
    let res = a
        .accel
        .get(&format!("/media/photos/{}", p.hash), Some(&alice))
        .await;
    assert_eq!(res.header("content-type"), Some("image/webp"));
    assert!(res.header("content-disposition").is_some());
    assert!(res.header("x-accel-redirect").is_some());
    let shared = photo(&m, "alice/e2e_06");
    let res = a
        .accel
        .get(&format!("/media/photos/{}", shared.hash), Some(&bob))
        .await;
    assert!(res.header("content-disposition").is_some());
    let res = a
        .accel
        .get(&format!("/media/photos/{}", shared.hash), Some(&carol))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.header("content-disposition").is_none());
    let public = photo(&m, "alice/e2e_05");
    let res = a
        .accel
        .get(&format!("/media/photos/{}", public.hash), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.header("content-disposition").is_none());
    let res = a
        .accel
        .get(&format!("/media/photos/{}.mp4", v.hash), Some(&alice))
        .await;
    assert_eq!(res.header("content-type"), Some("video/mp4"));

    // zip and avatars.
    let uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    let alice_id = m["users"]["alice"]["id"].as_i64().unwrap();
    let res = a.accel.get(&format!("/media/zip/{uuid}"), None).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(res.header("x-media-error"), Some("authentication"));
    let res = a
        .accel
        .get(&format!("/media/ZIP/{}", uuid.to_uppercase()), Some(&alice))
        .await;
    assert_eq!(
        res.header("content-type"),
        Some("application/x-zip-compressed")
    );
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/ZIP/{uuid}{alice_id}.zip").as_str())
    );
    for bad in ["job-1", "..", &format!("{uuid}1")] {
        let res = a
            .accel
            .get(&format!("/media/zip/{bad}"), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{bad}");
    }
    let res = a.accel.get("/media/avatars/face.png", None).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    let res = a.accel.get("/media/avatars/face.png", Some(&alice)).await;
    assert_eq!(res.header("content-type"), Some("image/png"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some("/protected_media/avatars/face.png")
    );

    // Downloads: the owner's archive only.
    let res = a
        .accel
        .get(&format!("/api/downloads/{uuid}{alice_id}"), Some(&alice))
        .await;
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/zip/{uuid}{alice_id}.zip").as_str())
    );
    let res = a
        .accel
        .get(&format!("/api/downloads/{uuid}{alice_id}"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = a
        .accel
        .get(&format!("/api/downloads/{uuid}{alice_id}"), None)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    a.cleanup().await;
}

#[tokio::test]
async fn traversal_is_never_served() {
    let a = apps().await;
    let m = manifest();
    let p = photo(&m, "alice/e2e_01");
    for app in [&a.direct, &a.accel] {
        let alice = token(app, "alice").await;
        for path in [
            format!(
                "/media/faces%2F..%2F..%2Fdata%2Falice%2Fe2e/{}_0.jpg",
                p.hash
            ),
            format!("/media/..%2F..%2Ffaces/{}_0.jpg", p.hash),
            format!("/media/faces%5C..%5C..%5Cdata/{}_0.jpg", p.hash),
            format!("/media/thumbnails_big%2F..%2F..%2Fdata/{}_x.jpg", p.hash),
            format!("/media/photos%2F..%2F..%2Fdata/{}", p.hash),
            "/media/zip/..%5Csecret".to_string(),
            "/media/avatars/..%5C..%5Cdata%5Calice%5Ce2e%5Ce2e_01.jpg".to_string(),
        ] {
            let res = app.get(&path, Some(&alice)).await;
            assert_ne!(res.status, StatusCode::OK, "{path}");
            assert!(res.header("x-accel-redirect").is_none(), "{path}");
        }
    }
    a.cleanup().await;
}

#[tokio::test]
async fn photo_share_media() {
    let a = apps().await;
    let m = manifest();
    let slug = m["shares"]["photo_share"]["slug"].as_str().unwrap();
    let shared = photo(&m, m["shares"]["photo_share"]["photo"].as_str().unwrap());
    let res = a
        .direct
        .get(&format!("/api/public/photo/{slug}/media/thumbnail/"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("image/webp"));
    assert_eq!(res.header("cache-control"), Some("private, no-cache"));
    let res = a
        .accel
        .get(&format!("/api/public/photo/{slug}/media/thumbnail"), None)
        .await;
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/thumbnails_big/{}.webp", shared.hash).as_str())
    );
    for path in [
        format!("/api/public/photo/{slug}/media/video/"),
        format!("/api/public/photo/{slug}/media/original/"),
        "/api/public/photo/nope/media/thumbnail/".to_string(),
    ] {
        let res = a.direct.get(&path, None).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{path}");
        assert!(res.header("cache-control").is_none());
    }
    let res = a
        .direct
        .request(
            axum::http::Request::builder()
                .uri(format!("/api/public/photo/{slug}/media/thumbnail/"))
                .header("authorization", "Bearer garbage")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    a.cleanup().await;
}

#[tokio::test]
async fn diagnostics_for_admins() {
    let a = apps().await;
    let m = manifest();
    let admin = token(&a.direct, "admin").await;
    let alice = token(&a.direct, "alice").await;
    let v = photo(&m, "alice/video");
    for id in [&v.hash, &v.id] {
        let res = a
            .direct
            .get(&format!("/api/media/diagnostics/{id}/"), Some(&admin))
            .await;
        assert_eq!(res.status, StatusCode::OK);
        let body = res.json();
        let keys: Vec<&str> = body
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "path",
                "exists",
                "readable_by_webserver",
                "cause",
                "blocking",
                "webserver",
                "mount",
                "remedies"
            ]
        );
        assert_eq!(body["exists"], true);
        assert!(body["path"].as_str().unwrap().ends_with("clip.mp4"));
        assert_eq!(body["webserver"]["uid"], 101);
    }
    let res = a
        .direct
        .get(&format!("/api/media/diagnostics/{}/", v.hash), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    let res = a
        .direct
        .get(&format!("/api/media/diagnostics/{}/", v.hash), None)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    let res = a
        .direct
        .get("/api/media/diagnostics/0123456789abcdef/", Some(&admin))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(res.json()["detail"], "No photo matches that identifier.");
    let removed = photo(&m, "alice/removed");
    let res = a
        .direct
        .get(
            &format!("/api/media/diagnostics/{}/", removed.hash),
            Some(&admin),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.json(),
        serde_json::json!({"path": null, "exists": false, "readable_by_webserver": false,
            "cause": "missing", "blocking": null, "remedies": []})
    );
    a.cleanup().await;
}

#[test]
fn diagnosis_of_a_missing_file_names_the_first_missing_directory() {
    let root = fixture_root();
    let missing = root.join("data").join("nope").join("x.mp4");
    let report = lp_media::diagnostics::diagnose_media_path(
        &missing.to_string_lossy(),
        &root.join("data").to_string_lossy(),
    );
    assert_eq!(report["cause"], "missing");
    assert_eq!(report["exists"], false);
    assert_eq!(report["blocking"]["kind"], "directory");
    assert!(
        report["blocking"]["path"]
            .as_str()
            .unwrap()
            .ends_with("nope")
    );
}
