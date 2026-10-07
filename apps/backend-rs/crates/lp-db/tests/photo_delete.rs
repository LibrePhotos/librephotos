//! `write::photo_delete::hard_delete`: rows the collector removes or nulls,
//! face crops, and Django's rules for orphaned thumbnail files.

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};

use lp_db::db::{Db, Dialect, DjUuid};
use lp_db::write::AfterCommit;
use lp_db::write::photo_delete::hard_delete;
use lp_testkit::TestApp;
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

async fn thumbed(pool: &Db) -> Vec<(Uuid, String)> {
    let rows: Vec<(DjUuid, String)> = lp_db::sql::query_as(
        "SELECT p.id, p.image_hash FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE t.thumbnail_big <> '' ORDER BY p.id",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    rows.into_iter().map(|(id, h)| (id.0, h)).collect()
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
    lp_db::sql::query("UPDATE api_photo SET image_hash = $2 WHERE id = $1")
        .bind(other)
        .bind(&shared_hash)
        .execute(&pool)
        .await
        .unwrap();
    lp_db::sql::query(
        "UPDATE api_thumbnail SET thumbnail_big = (SELECT thumbnail_big FROM api_thumbnail WHERE photo_id = $2) \
         WHERE photo_id = $1",
    )
    .bind(keeper)
    .bind(named)
    .execute(&pool)
    .await
    .unwrap();
    // Covers pointing at the deleted photo are nulled, not cascaded.
    lp_db::sql::query(
        "UPDATE api_person SET cover_photo_id = $1 WHERE id = (SELECT min(id) FROM api_person)",
    )
    .bind(gone)
    .execute(&pool)
    .await
    .unwrap();
    let crop = format!("faces/lp_delete_test_{}.jpg", Uuid::new_v4().simple());
    let face: Option<i32> = lp_db::sql::query_scalar(
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

    let left: i64 =
        lp_db::sql::query_scalar("SELECT count(*) FROM api_photo WHERE id IN ($1, $2, $3)")
            .bind(gone)
            .bind(shared)
            .bind(named)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(left, 0);
    let covers: i64 =
        lp_db::sql::query_scalar("SELECT count(*) FROM api_person WHERE cover_photo_id = $1")
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

/// Every `(table, column)` holding a foreign key to `target`, read from the
/// catalog so a relation added later is covered without editing this test.
async fn fk_columns(pool: &Db, target: &str) -> Vec<(String, String)> {
    let sql = match pool.dialect() {
        Dialect::Sqlite => {
            "SELECT m.name, f.\"from\" FROM sqlite_master m, pragma_foreign_key_list(m.name) f \
             WHERE m.type = 'table' AND f.\"table\" = $1 ORDER BY 1, 2"
        }
        Dialect::Pg => {
            "SELECT cl.relname::text, a.attname::text FROM pg_constraint c \
             JOIN pg_class cl ON cl.oid = c.conrelid \
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] \
             WHERE c.contype = 'f' AND c.confrelid = $1::regclass ORDER BY 1, 2"
        }
    };
    lp_db::sql::query_as(sql)
        .bind(target)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn count(pool: &Db, sql: &str) -> i64 {
    lp_db::sql::query_scalar(sql)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

async fn count_not_null(pool: &Db, table: &str, col: &str) -> i64 {
    count(
        pool,
        &format!("SELECT count(*) FROM {table} WHERE {col} IS NOT NULL"),
    )
    .await
}

/// Rows of the relations the fixture leaves empty, so every foreign key to
/// `api_photo` has something to delete or null.
async fn fill_empty_relations(pool: &Db, photo: Uuid, other: Uuid) {
    let user_id: i32 = lp_db::sql::query_scalar("SELECT owner_id FROM api_photo WHERE id = $1")
        .bind(photo)
        .fetch_one(pool)
        .await
        .unwrap();
    let file: String = lp_db::sql::query_scalar(
        "SELECT file_id FROM api_photo_files WHERE photo_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(photo)
    .fetch_one(pool)
    .await
    .unwrap();
    let now = chrono::Utc::now();
    lp_db::sql::query(
        "INSERT INTO api_metadataedit (id, field_name, old_value, new_value, synced_to_file, \
         synced_at, created_at, photo_id, user_id) \
         VALUES ($1, 'title', NULL, $2, FALSE, NULL, $3, $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(serde_json::json!("x"))
    .bind(now)
    .bind(photo)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    lp_db::sql::query(
        "INSERT INTO api_metadatafile (id, file_type, source, priority, creator_software, \
         created_at, updated_at, file_id, photo_id) \
         VALUES ($1, 'xmp', 'sidecar', 1, NULL, $2, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(now)
    .bind(&file)
    .bind(photo)
    .execute(pool)
    .await
    .unwrap();
    lp_db::sql::query("UPDATE api_duplicate SET kept_photo_id = $1")
        .bind(other)
        .execute(pool)
        .await
        .unwrap();
    lp_db::sql::query(
        "INSERT INTO api_stackreview (decision, trashed_count, created_at, reviewed_at, note, \
         kept_photo_id, reviewer_id, stack_id, uuid) \
         SELECT 'kept', 0, $1, NULL, NULL, $2, $3, s.id, $4 FROM api_photostack s \
         ORDER BY s.id LIMIT 1",
    )
    .bind(now)
    .bind(other)
    .bind(user_id)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .unwrap();
}

/// Django's `Photo.delete()` on SQLite: the foreign keys there have no
/// `ON DELETE`, so after deleting every photo no row may still point at one
/// (the deferred keys would fail the COMMIT), the rows Django nulls survive
/// with NULL, and each photo leaves its tombstones.
#[tokio::test]
async fn hard_delete_every_photo_leaves_no_reference() {
    let app = TestApp::new().await;
    let pool = app.pool().clone();
    let media = std::env::temp_dir().join(format!("lp_photo_delete_{}", Uuid::new_v4().simple()));
    let ids: Vec<Uuid> = lp_db::sql::query_scalar("SELECT id FROM api_photo ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(ids.len() >= 5);
    fill_empty_relations(&pool, ids[0], ids[1]).await;

    let refs = fk_columns(&pool, "api_photo").await;
    let tables: Vec<&str> = refs.iter().map(|(t, _)| t.as_str()).collect();
    for t in [
        "api_face",
        "api_thumbnail",
        "api_photo_files",
        "api_photo_shared_to",
        "api_albumuser_photos",
        "api_albumthing_cover_photos",
        "api_photostack",
        "api_stackreview",
    ] {
        assert!(tables.contains(&t), "catalog lists {t}: {tables:?}");
    }
    let mut empty = Vec::new();
    for (t, c) in &refs {
        if count_not_null(&pool, t, c).await == 0 {
            empty.push(format!("{t}.{c}"));
        }
    }
    // Rust's own side tables may be empty in the fixture.
    empty.retain(|e| !e.starts_with("lp_"));
    assert!(empty.is_empty(), "no row to delete or null in {empty:?}");
    let persons = count(&pool, "SELECT count(*) FROM api_person").await;
    let albums = count(&pool, "SELECT count(*) FROM api_albumuser").await;
    let stacks = count(&pool, "SELECT count(*) FROM api_photostack").await;
    let duplicates = count(&pool, "SELECT count(*) FROM api_duplicate").await;
    let files = count(&pool, "SELECT count(*) FROM api_file").await;
    let expected_tombstones = count(
        &pool,
        "SELECT count(*) FROM (SELECT p.id AS eid, p.owner_id AS uid FROM api_photo p \
         UNION SELECT s.photo_id, s.user_id FROM api_photo_shared_to s) v \
         WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid)",
    )
    .await;
    let tombstones_before = count(
        &pool,
        "SELECT count(*) FROM api_deletionlog WHERE entity = 'photo'",
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    let mut after = AfterCommit::new();
    hard_delete(&mut tx, &ids, &media, &mut after)
        .await
        .unwrap();
    tx.commit()
        .await
        .expect("no dangling foreign key at COMMIT");
    after.run().await;

    assert_eq!(count(&pool, "SELECT count(*) FROM api_photo").await, 0);
    for (t, c) in &refs {
        assert_eq!(
            count_not_null(&pool, t, c).await,
            0,
            "{t}.{c} still references a deleted photo"
        );
    }
    for (t, c) in fk_columns(&pool, "api_face").await {
        assert_eq!(
            count_not_null(&pool, &t, &c).await,
            0,
            "{t}.{c} still references a deleted face"
        );
    }
    if pool.dialect() == Dialect::Sqlite {
        assert_eq!(
            count(&pool, "SELECT count(*) FROM pragma_foreign_key_check").await,
            0
        );
    }
    // The rows Django nulls (and the M2M owners) survive.
    assert_eq!(
        count(&pool, "SELECT count(*) FROM api_person").await,
        persons
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM api_albumuser").await,
        albums
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM api_photostack").await,
        stacks
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM api_duplicate").await,
        duplicates
    );
    assert_eq!(count(&pool, "SELECT count(*) FROM api_file").await, files);
    assert_eq!(
        count(&pool, "SELECT count(*) FROM api_stackreview").await,
        1
    );

    // Tombstones: owner + shared_to users, Django's dashed `str(uuid)`.
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM api_deletionlog WHERE entity = 'photo'"
        )
        .await,
        tombstones_before + expected_tombstones
    );
    let entity_ids: Vec<String> = lp_db::sql::query_scalar(
        "SELECT entity_id FROM api_deletionlog WHERE entity = 'photo' ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for id in &ids {
        let dashed = id.hyphenated().to_string();
        assert!(entity_ids.contains(&dashed), "tombstone for {dashed}");
    }
    let _ = std::fs::remove_dir_all(&media);
    app.cleanup().await;
}

/// One photo: only its own rows go; the rest of the library is untouched.
#[tokio::test]
async fn hard_delete_one_photo_keeps_the_others() {
    let app = TestApp::new().await;
    let pool = app.pool().clone();
    let media = std::env::temp_dir().join(format!("lp_photo_delete_{}", Uuid::new_v4().simple()));
    // The photo with the most dependent rows.
    let target: Uuid = lp_db::sql::query_scalar(
        "SELECT p.id FROM api_photo p ORDER BY \
         (SELECT count(*) FROM api_face f WHERE f.photo_id = p.id) \
         + (SELECT count(*) FROM api_albumuser_photos a WHERE a.photo_id = p.id) \
         + (SELECT count(*) FROM api_tag_photos t WHERE t.photo_id = p.id) DESC, p.id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let refs = fk_columns(&pool, "api_photo").await;
    let mut before = Vec::new();
    for (t, c) in &refs {
        let all = count_not_null(&pool, t, c).await;
        let own: i64 = lp_db::sql::query_scalar(format!("SELECT count(*) FROM {t} WHERE {c} = $1"))
            .bind(target)
            .fetch_one(&pool)
            .await
            .unwrap();
        before.push((all, own));
    }
    assert!(before.iter().map(|(_, own)| own).sum::<i64>() >= 5);

    let mut tx = pool.begin().await.unwrap();
    let mut after = AfterCommit::new();
    hard_delete(&mut tx, &[target], &media, &mut after)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    after.run().await;

    for ((t, c), (all, own)) in refs.iter().zip(before) {
        assert_eq!(count_not_null(&pool, t, c).await, all - own, "{t}.{c}");
    }
    let _ = std::fs::remove_dir_all(&media);
    app.cleanup().await;
}
