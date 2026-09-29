//! Upload area: `/api/exists/{hash}`, `/api/upload/`, `/api/upload/complete/`.

#![allow(clippy::disallowed_methods)]

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use lp_testkit::{TestApp, TestResponse};
use md5::{Digest, Md5};
use serde_json::json;

const BOUNDARY: &str = "----lpboundary";

fn multipart(fields: &[(&str, &str)], file: Option<(&str, &[u8])>) -> Vec<u8> {
    let mut body = Vec::new();
    for (k, v) in fields {
        body.extend_from_slice(
            format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n")
                .as_bytes(),
        );
    }
    if let Some((name, data)) = file {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

async fn post_form(
    app: &TestApp,
    path: &str,
    token: Option<&str>,
    range: Option<String>,
    body: Vec<u8>,
) -> TestResponse {
    let mut b = Request::builder().method(Method::POST).uri(path).header(
        "content-type",
        format!("multipart/form-data; boundary={BOUNDARY}"),
    );
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    if let Some(r) = range {
        b = b.header("content-range", r);
    }
    app.request(b.body(Body::from(body)).unwrap()).await
}

fn png_bytes() -> Vec<u8> {
    let img = image::RgbImage::from_fn(64, 48, |x, y| image::Rgb([x as u8 * 3, y as u8 * 5, 90]));
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn md5_hex(data: &[u8]) -> String {
    hex::encode(Md5::digest(data))
}

async fn user_with_scan_dir(app: &TestApp, name: &str) -> (lp_db::users::User, std::path::PathBuf) {
    let user = app.create_user(name, "pw", false).await;
    let dir = app.base_path().join("data").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    sqlx::query("UPDATE api_user SET scan_directory = $2 WHERE id = $1")
        .bind(user.id)
        .bind(dir.to_string_lossy().to_string())
        .execute(app.pool())
        .await
        .unwrap();
    let user = lp_db::users::by_id(app.pool(), user.id)
        .await
        .unwrap()
        .unwrap();
    (user, dir)
}

#[tokio::test]
async fn exists_is_scoped_to_the_requester() {
    let app = TestApp::new().await;
    let (alice, bob): (i32, i32) = sqlx::query_as(
        "SELECT (SELECT id FROM api_user WHERE username = 'alice'), (SELECT id FROM api_user WHERE username = 'bob')",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    let hash: String = sqlx::query_scalar(
        "SELECT image_hash FROM api_photo WHERE owner_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(alice)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let alice_u = lp_db::users::by_id(app.pool(), alice)
        .await
        .unwrap()
        .unwrap();
    let bob_u = lp_db::users::by_id(app.pool(), bob).await.unwrap().unwrap();

    let r = app.get(&format!("/api/exists/{hash}"), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    let r = app
        .get(
            &format!("/api/exists/{hash}"),
            Some(&app.token_for(&alice_u)),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json(), json!({"exists": true}));

    let r = app
        .get(
            &format!("/api/exists/{hash}/"),
            Some(&app.token_for(&bob_u)),
        )
        .await;
    assert_eq!(r.json(), json!({"exists": false}));

    let r = app
        .get("/api/exists/nope", Some(&app.token_for(&alice_u)))
        .await;
    assert_eq!(r.json(), json!({"exists": false}));
    app.cleanup().await;
}

#[tokio::test]
async fn chunked_upload_protocol() {
    let app = TestApp::new().await;
    let (user, dir) = user_with_scan_dir(&app, "uploader").await;
    let (other, _) = user_with_scan_dir(&app, "other").await;
    let token = app.token_for(&user);
    let data = png_bytes();
    let (first, second) = data.split_at(data.len() / 2);

    // Anonymous and bad tokens are 403, not 401 (plain Django views).
    let r = post_form(
        &app,
        "/api/upload/",
        None,
        None,
        multipart(&[], Some(("blob", first))),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(
        r.json(),
        json!({"detail": "Authentication credentials were not provided"})
    );
    let r = post_form(
        &app,
        "/api/upload/",
        Some("garbage"),
        None,
        multipart(&[], Some(("blob", first))),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(
        r.json(),
        json!({"detail": "Authentication credentials were invalid"})
    );

    // No chunk.
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        None,
        multipart(&[("md5", "")], None),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.json(), json!({"detail": "No chunk file was submitted"}));

    // First chunk: Content-Range total = chunk size, like the frontend.
    let range = format!("bytes 0-{}/{}", first.len() - 1, first.len());
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        Some(range),
        multipart(&[("md5", ""), ("offset", "0")], Some(("blob", first))),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let body = r.json();
    let upload_id = body["upload_id"].as_str().unwrap().to_string();
    assert_eq!(upload_id.len(), 32);
    assert_eq!(body["offset"], json!(first.len()));
    assert!(body["expires"].as_str().unwrap().ends_with('Z'));

    // Wrong offset reports the current one.
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        Some(format!("bytes 5-{}/{}", 5 + second.len() - 1, second.len())),
        multipart(&[("upload_id", &upload_id)], Some(("blob", second))),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.json(),
        json!({"detail": "Offsets do not match", "offset": first.len()})
    );

    // Size mismatch.
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        Some(format!("bytes {}-{}/9", first.len(), first.len() + 2)),
        multipart(&[("upload_id", &upload_id)], Some(("blob", second))),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.json(),
        json!({"detail": "File size doesn't match headers"})
    );

    // Someone else's upload id does not exist for them.
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&app.token_for(&other)),
        None,
        multipart(&[("upload_id", &upload_id)], Some(("blob", second))),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    // Second chunk.
    let start = first.len();
    let range = format!(
        "bytes {}-{}/{}",
        start,
        start + second.len() - 1,
        second.len()
    );
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        Some(range),
        multipart(&[("upload_id", &upload_id)], Some(("blob", second))),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["offset"], json!(data.len()));

    // Completion needs both params and the right md5.
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(&[("upload_id", &upload_id)], None),
    )
    .await;
    assert_eq!(
        r.json(),
        json!({"detail": "Both 'upload_id' and 'md5' are required"})
    );
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(&[("upload_id", &upload_id), ("md5", "00")], None),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.json(), json!({"detail": "md5 checksum does not match"}));

    let md5 = md5_hex(&data);
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(
            &[
                ("upload_id", &upload_id),
                ("md5", &md5),
                ("filename", "my photo.png"),
                ("device_created_at", "1714000000000"),
            ],
            None,
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json(), json!({}));
    let target = dir.join("uploads").join("web").join("my_photo.png");
    assert_eq!(std::fs::read(&target).unwrap(), data);

    let hash = format!("{md5}{}", user.id);
    let (photos, queued): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM api_photo WHERE owner_id = $1 AND image_hash = $2), \
                (SELECT count(*) FROM job_queue WHERE kind = 'upload.process')",
    )
    .bind(user.id)
    .bind(&hash)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!((photos, queued), (1, 1));
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chunked_upload_chunkedupload WHERE upload_id = $1",
    )
    .bind(&upload_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(rows, 0, "a completed upload is removed");

    let r = app.get(&format!("/api/exists/{hash}"), Some(&token)).await;
    assert_eq!(r.json(), json!({"exists": true}));

    // The same bytes again: a duplicate, answered with {} and not imported.
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        None,
        multipart(&[], Some(("blob", &data))),
    )
    .await;
    let id2 = r.json()["upload_id"].as_str().unwrap().to_string();
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(
            &[
                ("upload_id", &id2),
                ("md5", &md5),
                ("filename", "again.png"),
            ],
            None,
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(!dir.join("uploads").join("web").join("again.png").exists());
    app.cleanup().await;
}

#[tokio::test]
async fn upload_refusals() {
    let app = TestApp::new().await;
    let (user, _dir) = user_with_scan_dir(&app, "uploader2").await;
    let token = app.token_for(&user);

    // Not a picture: refused and the staged upload removed.
    let junk = b"definitely not an image".to_vec();
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        None,
        multipart(&[], Some(("blob", &junk))),
    )
    .await;
    let id = r.json()["upload_id"].as_str().unwrap().to_string();
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(
            &[
                ("upload_id", &id),
                ("md5", &md5_hex(&junk)),
                ("filename", "x.txt"),
            ],
            None,
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.json(), json!({"detail": "File type not allowed"}));
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chunked_upload_chunkedupload WHERE upload_id = $1",
    )
    .bind(&id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(rows, 0);

    // No scan directory: refused, and the upload id stays usable.
    let data = png_bytes();
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        None,
        multipart(&[], Some(("blob", &data))),
    )
    .await;
    let id = r.json()["upload_id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE api_user SET scan_directory = '' WHERE id = $1")
        .bind(user.id)
        .execute(app.pool())
        .await
        .unwrap();
    let r = post_form(
        &app,
        "/api/upload/complete/",
        Some(&token),
        None,
        multipart(
            &[
                ("upload_id", &id),
                ("md5", &md5_hex(&data)),
                ("filename", "a.png"),
            ],
            None,
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(
        r.json()["detail"]
            .as_str()
            .unwrap()
            .starts_with("Upload failed: No scan directory configured")
    );
    let status: i16 =
        sqlx::query_scalar("SELECT status FROM chunked_upload_chunkedupload WHERE upload_id = $1")
            .bind(&id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(status, 1, "back to UPLOADING");

    // Uploads switched off site-wide.
    lp_db::write::settings::save(&app.state, &[("ALLOW_UPLOAD", json!(false))])
        .await
        .unwrap();
    let r = post_form(
        &app,
        "/api/upload/",
        Some(&token),
        None,
        multipart(&[], Some(("blob", &data))),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.json(), json!({"detail": "Uploading is not allowed"}));
    app.cleanup().await;
}
