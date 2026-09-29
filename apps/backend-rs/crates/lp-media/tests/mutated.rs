//! Media situations the fixture does not carry, set up on a private clone:
//! one hash shared by two owners, revoked shares, embedded media, legacy
//! jpg thumbnails, zip archives on disk, and the transcode path (live
//! stream, then the seekable cached copy).

#![allow(clippy::disallowed_methods)] // test setup writes rows directly

mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use lp_testkit::TestDb;

#[tokio::test]
async fn shared_hash_and_revoked_shares() {
    let db = TestDb::new().await;
    let m = manifest();
    let direct = app_on(&db.name, "direct", None).await;
    let accel = app_on(&db.name, "x-accel", None).await;
    let pool = direct.pool().clone();
    let alice_p = photo(&m, "alice/e2e_01");
    let bob_p = photo(&m, "bob/e2e_01");

    // Two users scanned the same file: bob's row inherits alice's hash.
    sqlx::query("UPDATE api_photo SET image_hash = $1 WHERE id = $2::uuid")
        .bind(&alice_p.hash)
        .bind(&bob_p.id)
        .execute(&pool)
        .await
        .unwrap();
    let alice = token(&direct, "alice").await;
    let bob = token(&direct, "bob").await;
    let dave = token(&direct, "dave").await;
    let orig = format!("/media/photos/{}", alice_p.hash);
    let res = direct.get(&orig, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.body.as_ref(),
        std::fs::read(&alice_p.path).unwrap().as_slice()
    );
    let res = direct.get(&orig, Some(&bob)).await;
    assert_eq!(res.status, StatusCode::OK, "bob gets his own row");
    assert_eq!(
        res.body.as_ref(),
        std::fs::read(&bob_p.path).unwrap().as_slice()
    );
    let res = accel.get(&orig, Some(&bob)).await;
    let target = res.header("x-accel-redirect").unwrap().to_string();
    assert!(
        target.contains("%5Cbob%5C") || target.contains("/bob/"),
        "{target}"
    );
    assert_eq!(
        direct.get(&orig, Some(&dave)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(direct.get(&orig, None).await.status, StatusCode::FORBIDDEN);

    // A public twin is what anonymous and strangers resolve to.
    sqlx::query("UPDATE api_photo SET public = TRUE WHERE id = $1::uuid")
        .bind(&bob_p.id)
        .execute(&pool)
        .await
        .unwrap();
    let res = direct.get(&orig, None).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.body.as_ref(),
        std::fs::read(&bob_p.path).unwrap().as_slice()
    );
    assert_eq!(direct.get(&orig, Some(&dave)).await.status, StatusCode::OK);
    assert_eq!(
        direct.get(&orig, Some(&alice)).await.body.as_ref(),
        std::fs::read(&alice_p.path).unwrap().as_slice()
    );

    // Disabling the public album share stops it vouching; an expired share never did.
    let berlin = photo(&m, "alice/berlin_02");
    let thumb = format!("/media/thumbnails_big/{}", berlin.hash);
    assert_eq!(direct.get(&thumb, None).await.status, StatusCode::OK);
    sqlx::query("UPDATE api_albumusershare SET enabled = FALSE WHERE album_id = $1")
        .bind(m["shares"]["public_album"]["album_id"].as_i64().unwrap() as i32)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(direct.get(&thumb, None).await.status, StatusCode::FORBIDDEN);
    assert_eq!(
        direct.get(&thumb, Some(&dave)).await.status,
        StatusCode::NOT_FOUND
    );

    // A photo share stops resolving once disabled, or while its photo is hidden.
    let slug = m["shares"]["photo_share"]["slug"].as_str().unwrap();
    let shared = photo(&m, m["shares"]["photo_share"]["photo"].as_str().unwrap());
    let url = format!("/api/public/photo/{slug}/media/thumbnail/");
    assert_eq!(direct.get(&url, None).await.status, StatusCode::OK);
    sqlx::query("UPDATE api_photo SET hidden = TRUE WHERE id = $1::uuid")
        .bind(&shared.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(direct.get(&url, None).await.status, StatusCode::NOT_FOUND);
    sqlx::query("UPDATE api_photo SET hidden = FALSE WHERE id = $1::uuid")
        .bind(&shared.id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE api_photoshare SET enabled = FALSE WHERE slug = $1")
        .bind(slug)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(direct.get(&url, None).await.status, StatusCode::NOT_FOUND);

    // A public photo that left the timeline (trashed) is no longer served.
    let public = photo(&m, "alice/e2e_05");
    let p_thumb = format!("/media/thumbnails_big/{}", public.hash);
    assert_eq!(direct.get(&p_thumb, None).await.status, StatusCode::OK);
    sqlx::query("UPDATE api_photo SET in_trashcan = TRUE WHERE id = $1::uuid")
        .bind(&public.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        direct.get(&p_thumb, None).await.status,
        StatusCode::FORBIDDEN
    );

    direct.cleanup().await;
    accel.cleanup().await;
    db.cleanup().await;
}

#[tokio::test]
async fn files_under_a_writable_media_root() {
    let db = TestDb::new().await;
    let m = manifest();
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().to_string_lossy().replace('\\', "/");
    let media = tmp.path().join("protected_media");
    let direct = app_on(&db.name, "direct", Some(&base)).await;
    let accel = app_on(&db.name, "x-accel", Some(&base)).await;
    let pool = direct.pool().clone();
    let alice = token(&direct, "alice").await;
    let bob = token(&direct, "bob").await;
    let alice_id = m["users"]["alice"]["id"].as_i64().unwrap();
    let p = photo(&m, "alice/e2e_01");

    // Embedded media (motion photo video), owner only.
    std::fs::create_dir_all(media.join("embedded_media")).unwrap();
    let embedded = media
        .join("embedded_media")
        .join(format!("{}_motion.mp4", p.hash));
    std::fs::write(&embedded, b"\0\0\0\x18ftypmp42motion").unwrap();
    let main_file: String =
        sqlx::query_scalar("SELECT main_file_id FROM api_photo WHERE id = $1::uuid")
            .bind(&p.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO api_file (hash, path, type, missing) VALUES ('embedded-test-1', $1, 6, FALSE)",
    )
    .bind(embedded.to_string_lossy().to_string())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO api_file_embedded_media (from_file_id, to_file_id) VALUES ($1, 'embedded-test-1')")
        .bind(&main_file)
        .execute(&pool)
        .await
        .unwrap();
    for addr in [&p.hash, &p.id] {
        let res = direct
            .get(&format!("/media/embedded_media/{addr}"), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::OK, "{addr}");
        assert_eq!(res.header("content-type"), Some("video/mp4"));
        assert_eq!(
            res.body.as_ref(),
            std::fs::read(&embedded).unwrap().as_slice()
        );
    }
    let res = accel
        .get(&format!("/media/embedded_media/{}", p.hash), Some(&alice))
        .await;
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/embedded_media/{}_motion.mp4", p.hash).as_str())
    );
    assert_eq!(
        direct
            .get(&format!("/media/embedded_media/{}", p.hash), Some(&bob))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        direct
            .get(&format!("/media/embedded_media/{}", p.hash), None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    // Legacy jpg thumbnails: every variant falls back to the big jpg.
    std::fs::create_dir_all(media.join("thumbnails_big")).unwrap();
    let big = media.join("thumbnails_big").join(format!("{}.jpg", p.hash));
    std::fs::write(&big, b"\xFF\xD8\xFFjpeg-bytes").unwrap();
    sqlx::query(
        "UPDATE api_thumbnail SET thumbnail_big = $1, square_thumbnail = $2, square_thumbnail_small = $3 \
         WHERE photo_id = $4::uuid",
    )
    .bind(format!("thumbnails_big/{}.jpg", p.hash))
    .bind(format!("square_thumbnails/{}.jpg", p.hash))
    .bind(format!("square_thumbnails_small/{}.jpg", p.hash))
    .bind(&p.id)
    .execute(&pool)
    .await
    .unwrap();
    for kind in [
        "thumbnails_big",
        "square_thumbnails",
        "square_thumbnails_small",
    ] {
        let res = direct
            .get(&format!("/media/{kind}/{}", p.hash), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::OK, "{kind}");
        assert_eq!(res.header("content-type"), Some("image/jpg"), "{kind}");
        assert_eq!(res.body.as_ref(), std::fs::read(&big).unwrap().as_slice());
    }
    let res = accel
        .get(&format!("/media/thumbnails_big/{}", p.hash), Some(&alice))
        .await;
    assert_eq!(res.header("content-type"), Some("image/jpeg"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/thumbnails_big/{}.jpg", p.hash).as_str())
    );
    let res = accel
        .get(
            &format!("/media/square_thumbnails/{}", p.hash),
            Some(&alice),
        )
        .await;
    assert_eq!(res.header("content-type"), Some("image/jpg"));
    assert!(
        res.header("x-accel-redirect")
            .unwrap()
            .ends_with(&format!("{}.jpg", p.hash))
    );

    // Zip archives: /media/zip/{uuid} and /api/downloads/{uuid}{id}.
    let uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    std::fs::create_dir_all(media.join("zip")).unwrap();
    let zip = media.join("zip").join(format!("{uuid}{alice_id}.zip"));
    std::fs::write(&zip, b"PK\x03\x04zip").unwrap();
    for path in [
        format!("/media/zip/{uuid}"),
        format!("/api/downloads/{uuid}{alice_id}"),
    ] {
        let res = direct.get(&path, Some(&alice)).await;
        assert_eq!(res.status, StatusCode::OK, "{path}");
        assert_eq!(
            res.header("content-type"),
            Some("application/x-zip-compressed")
        );
        assert_eq!(res.body.as_ref(), b"PK\x03\x04zip");
    }
    assert_eq!(
        direct
            .get(&format!("/media/zip/{uuid}"), Some(&bob))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let cookie = format!("jwt={alice}");
    let res = get_with(
        &direct,
        Method::GET,
        &format!("/api/downloads/{uuid}{alice_id}"),
        &[("cookie", &cookie)],
    )
    .await;
    assert_eq!(
        res.status,
        StatusCode::OK,
        "the download link authenticates with the cookie"
    );

    // Avatars (any signed-in user).
    std::fs::create_dir_all(media.join("avatars")).unwrap();
    std::fs::write(media.join("avatars").join("face.png"), b"\x89PNGavatar").unwrap();
    let res = direct.get("/media/avatars/face.png", Some(&bob)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("image/png"));

    direct.cleanup().await;
    accel.cleanup().await;
    db.cleanup().await;
}

#[tokio::test]
async fn transcoding_streams_live_then_serves_the_cached_copy() {
    let venv_ffmpeg = std::env::var("LP_FFMPEG").unwrap_or_else(|_| {
        "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages/ffmpeg_bin/bin/ffmpeg.exe".into()
    });
    if !std::path::Path::new(&venv_ffmpeg).exists() {
        eprintln!("skipping: no ffmpeg at {venv_ffmpeg}");
        return;
    }
    let db = TestDb::new().await;
    let m = manifest();
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().to_string_lossy().replace('\\', "/");
    let direct = app_on(&db.name, "direct", Some(&base)).await;
    let accel = app_on(&db.name, "x-accel", Some(&base)).await;
    let pool = direct.pool().clone();
    sqlx::query("UPDATE api_user SET transcode_videos = TRUE WHERE username = 'alice'")
        .execute(&pool)
        .await
        .unwrap();
    let alice = token(&direct, "alice").await;
    let v = photo(&m, "alice/video");
    let path = format!("/media/photos/{}.mp4", v.hash);
    let cached = tmp
        .path()
        .join("protected_media")
        .join("transcoded")
        .join(format!("{}.mp4", v.hash));

    // First play: a live fragmented mp4, not cacheable.
    let res = direct.get(&path, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert_eq!(res.header("cache-control"), Some("no-store"));
    assert!(res.header("accept-ranges").is_none());
    assert!(
        res.body.len() > 8 && &res.body[4..8] == b"ftyp",
        "fragmented mp4 from ffmpeg"
    );

    // HEAD answers with headers only (no second live conversion).
    let res = get_with(
        &direct,
        Method::HEAD,
        &path,
        &[("authorization", &bearer(&alice))],
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert!(res.body.is_empty());

    // The seekable copy lands in transcoded/ in the background.
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while !cached.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "the transcode cache was never filled"
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let res = direct.get(&path, Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.header("accept-ranges"), Some("bytes"));
    assert!(res.header("cache-control").is_none());
    assert_eq!(
        res.body.as_ref(),
        std::fs::read(&cached).unwrap().as_slice()
    );
    let res = get_with(
        &direct,
        Method::GET,
        &path,
        &[("authorization", &bearer(&alice)), ("range", "bytes=0-9")],
    )
    .await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    let res = accel.get(&path, Some(&alice)).await;
    assert_eq!(res.header("content-type"), Some("video/mp4"));
    assert_eq!(
        res.header("x-accel-redirect"),
        Some(format!("/protected_media/transcoded/{}.mp4", v.hash).as_str())
    );

    // Thumbnails and public viewers are never transcoded.
    let res = direct
        .get(
            &format!("/media/square_thumbnails/{}", v.hash),
            Some(&alice),
        )
        .await;
    assert!(res.header("cache-control").is_none());

    lp_media::transcode::discard(&direct.state.config, &v.hash);
    assert!(!cached.exists());

    direct.cleanup().await;
    accel.cleanup().await;
    db.cleanup().await;
}
