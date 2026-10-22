//! `write::photo_delete::hard_delete`: rows the collector removes or nulls,
//! face crops, and Django's rules for orphaned thumbnail files.

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

use lp_db::write::AfterCommit;
use lp_db::write::photo_delete::hard_delete;
use lp_testkit::TestApp;
use sqlx::PgPool;
use uuid::Uuid;

const DIRS: [(&str, &str); 5] = [
    ("thumbnails_big", "webp"),
    ("square_thumbnails", "webp"),
    ("square_thumbnails_small", "webp"),
    ("square_thumbnails", "mp4"),
    ("square_thumbnails_small", "mp4"),
];

fn thumb_files(media: &Path, hash: &str) -> Vec<PathBuf> {
    DIRS.iter()
        .map(|(d, e)| media.join(d).join(format!("{hash}.{e}")))
        .collect()
}

fn touch(files: &[PathBuf]) {
    for f in files {
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, b"x").unwrap();
    }
}

async fn thumbed(pool: &PgPool) -> Vec<(Uuid, String)> {
    sqlx::query_as(
        "SELECT p.id, p.image_hash FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE t.thumbnail_big <> '' ORDER BY p.id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn hard_delete_rows_and_files() {
    let app = TestApp::new().await;
    let pool = app.pool().clone();
    let media = std::env::temp_dir().join(format!("lp_photo_delete_{}", Uuid::new_v4().simple()));
    let photos = thumbed(&pool).await;
    assert!(photos.len() >= 5, "fixture photos with thumbnails");
    let [
        (gone, gone_hash),
        (shared, shared_hash),
        (named, named_hash),
        (other, _),
        (keeper, _),
    ] = [0, 1, 2, 3, 4].map(|i| photos[i].clone());

    // `shared`'s hash is still carried by `other`; `keeper`'s thumbnail row
    // names `named`'s big thumbnail.
    sqlx::query("UPDATE api_photo SET image_hash = $2 WHERE id = $1")
        .bind(other)
        .bind(&shared_hash)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE api_thumbnail SET thumbnail_big = (SELECT thumbnail_big FROM api_thumbnail WHERE photo_id = $2) \
         WHERE photo_id = $1",
    )
    .bind(keeper)
    .bind(named)
    .execute(&pool)
    .await
    .unwrap();
    // Covers pointing at the deleted photo are nulled, not cascaded.
    sqlx::query(
        "UPDATE api_person SET cover_photo_id = $1 WHERE id = (SELECT min(id) FROM api_person)",
    )
    .bind(gone)
    .execute(&pool)
    .await
    .unwrap();
    let crop = format!("faces/lp_delete_test_{}.jpg", Uuid::new_v4().simple());
    let face: Option<i32> = sqlx::query_scalar(
        "UPDATE api_face SET image = $2, photo_id = $1 WHERE id = (SELECT min(id) FROM api_face) \
         RETURNING 1",
    )
    .bind(gone)
    .bind(&crop)
    .fetch_optional(&pool)
    .await
    .unwrap();

    let gone_files = thumb_files(&media, &gone_hash);
    let shared_files = thumb_files(&media, &shared_hash);
    let named_files = thumb_files(&media, &named_hash);
    let crop_file = media.join(&crop);
    touch(&gone_files);
    touch(&shared_files);
    touch(&named_files);
    touch(std::slice::from_ref(&crop_file));

    let mut tx = pool.begin().await.unwrap();
    let mut after = AfterCommit::new();
    hard_delete(&mut tx, &[gone, shared, named], &media, &mut after)
        .await
        .unwrap();
    hard_delete(&mut tx, &[], &media, &mut after).await.unwrap();
    tx.commit().await.unwrap();
    after.run().await;

    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM api_photo WHERE id = ANY($1)")
        .bind([gone, shared, named])
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
    let covers: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_person WHERE cover_photo_id = $1")
            .bind(gone)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(covers, 0);
    assert!(
        gone_files.iter().all(|f| !f.exists()),
        "orphaned thumbnails go"
    );
    assert!(
        shared_files.iter().all(|f| f.exists()),
        "a photo still carries the hash"
    );
    assert!(
        named_files.iter().all(|f| f.exists()),
        "another thumbnail row names a file"
    );
    assert_eq!(
        crop_file.exists(),
        face.is_none(),
        "face crop goes with its face"
    );

    let _ = std::fs::remove_dir_all(&media);
    app.cleanup().await;
}
