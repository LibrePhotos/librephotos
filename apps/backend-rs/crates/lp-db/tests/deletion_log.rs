//! `write::deletion_log` on both backends: who gets a tombstone, the
//! `entity_id` text (Django's `str(pk)`, dashed `str(uuid)`), a `deleted_at`
//! after the `last_modified` bumps of the same transaction, clearing and
//! pruning.

#![allow(clippy::disallowed_methods)]

use chrono::{DateTime, Duration, Utc};
use lp_db::db::{Db, Dialect, DjUuid};
use lp_db::write::deletion_log::{self as dl, AlbumKind, entity};
use lp_testkit::TestApp;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct Tomb {
    entity: String,
    entity_id: String,
    owner_id: i32,
    deleted_at: DateTime<Utc>,
}

async fn tombs(db: &Db, entity_ids: &[String]) -> Vec<Tomb> {
    let d = db.dialect();
    lp_db::sql::query_as(format!(
        "SELECT entity, entity_id, owner_id, deleted_at FROM api_deletionlog WHERE {} ORDER BY id",
        lp_db::sql::any_sql(d, "entity_id", 1)
    ))
    .bind(entity_ids)
    .fetch_all(db)
    .await
    .unwrap()
}

/// The rows of one entity kind (integer ids of different models collide).
fn of(rows: Vec<Tomb>, entity: &str) -> Vec<Tomb> {
    rows.into_iter().filter(|t| t.entity == entity).collect()
}

/// Django's `DateTimeField` text on SQLite: `YYYY-MM-DD HH:MM:SS[.ffffff]`.
async fn assert_django_text(db: &Db, entity_id: &str) {
    if db.dialect() != Dialect::Sqlite {
        return;
    }
    let raw: Vec<String> = lp_db::sql::query_scalar(
        "SELECT CAST(deleted_at AS TEXT) FROM api_deletionlog WHERE entity_id = $1",
    )
    .bind(entity_id)
    .fetch_all(db)
    .await
    .unwrap();
    assert!(!raw.is_empty());
    for t in raw {
        assert!(
            t.len() >= 19 && t.as_bytes()[10] == b' ' && !t.contains('+') && !t.contains('T'),
            "{t}"
        );
    }
}

#[tokio::test]
async fn photo_tombstones_follow_the_bumps_with_dashed_ids() {
    let app = TestApp::new().await;
    let db = app.pool().clone();
    let (photo, owner, viewer): (DjUuid, i32, i32) = lp_db::sql::query_as(
        "SELECT s.photo_id, p.owner_id, s.user_id FROM api_photo_shared_to s \
         JOIN api_photo p ON p.id = s.photo_id ORDER BY s.id LIMIT 1",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let photo = photo.0;
    let eid = photo.hyphenated().to_string();

    let mut tx = db.begin().await.unwrap();
    lp_db::sql::query("UPDATE api_photo SET last_modified = now() WHERE id = $1")
        .bind(photo)
        .execute(&mut *tx)
        .await
        .unwrap();
    let bumped: DateTime<Utc> =
        lp_db::sql::query_scalar("SELECT last_modified FROM api_photo WHERE id = $1")
            .bind(photo)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(dl::photos_deleted(&mut tx, &[photo]).await.unwrap(), 2);
    tx.commit().await.unwrap();

    let rows = tombs(&db, std::slice::from_ref(&eid)).await;
    let mut owners: Vec<i32> = rows.iter().map(|t| t.owner_id).collect();
    let mut want = vec![owner, viewer];
    want.sort();
    assert_eq!(owners, want, "owner then viewer, ascending");
    owners.dedup();
    assert_eq!(owners.len(), 2);
    for t in &rows {
        assert_eq!(t.entity, entity::PHOTO);
        assert_eq!(t.entity_id, eid);
        assert!(t.deleted_at > bumped, "{} !> {bumped}", t.deleted_at);
    }
    assert_django_text(&db, &eid).await;

    // A re-share clears the viewer's tombstone only.
    let n = dl::clear(
        &mut db.acquire().await.unwrap(),
        entity::PHOTO,
        &dl::uuid_ids(&[photo]),
        &[viewer],
    )
    .await
    .unwrap();
    assert_eq!(n, 1);
    let rows = tombs(&db, std::slice::from_ref(&eid)).await;
    assert_eq!(rows.iter().map(|t| t.owner_id).collect::<Vec<_>>(), [owner]);

    // `SetPhotosShared` un-share: every selected photo, in the given order,
    // with no user filter.
    let ids: Vec<Uuid> = lp_db::sql::query_scalar(
        "SELECT id FROM api_photo WHERE id <> $1 ORDER BY id DESC LIMIT 2",
    )
    .bind(photo)
    .fetch_all(&db)
    .await
    .unwrap();
    let mut conn = db.acquire().await.unwrap();
    assert_eq!(
        dl::photos_unshared_bulk(&mut conn, &ids, viewer)
            .await
            .unwrap(),
        2
    );
    drop(conn);
    let eids = dl::uuid_ids(&ids);
    let rows = tombs(&db, &eids).await;
    assert_eq!(
        rows.iter().map(|t| t.entity_id.clone()).collect::<Vec<_>>(),
        eids
    );
    assert!(rows.iter().all(|t| t.owner_id == viewer));
    app.cleanup().await;
}

#[tokio::test]
async fn album_person_tag_unshare_tombstones_and_prune() {
    let app = TestApp::new().await;
    let db = app.pool().clone();
    let mut tx = db.begin().await.unwrap();

    // A shared user album: owner + every recipient.
    let (album, owner): (i32, i32) = lp_db::sql::query_as(
        "SELECT a.id, a.owner_id FROM api_albumuser a \
         WHERE EXISTS (SELECT 1 FROM api_albumuser_shared_to s WHERE s.albumuser_id = a.id) \
         ORDER BY a.id LIMIT 1",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    let shared: Vec<i32> = lp_db::sql::query_scalar(
        "SELECT user_id FROM api_albumuser_shared_to WHERE albumuser_id = $1",
    )
    .bind(album)
    .fetch_all(&mut *tx)
    .await
    .unwrap();
    let n = dl::albums_deleted(&mut tx, AlbumKind::User, &[album])
        .await
        .unwrap();
    let mut want: Vec<i32> = shared.into_iter().chain([owner]).collect();
    want.sort();
    want.dedup();
    assert_eq!(n as usize, want.len());

    // Only USER persons with a cluster owner are mirrored.
    let (person, person_owner): (i32, i32) = lp_db::sql::query_as(
        "SELECT id, cluster_owner_id FROM api_person \
         WHERE kind = 'USER' AND cluster_owner_id IS NOT NULL ORDER BY id LIMIT 1",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    let cluster: Vec<i32> =
        lp_db::sql::query_scalar("SELECT id FROM api_person WHERE kind <> 'USER' ORDER BY id")
            .fetch_all(&mut *tx)
            .await
            .unwrap();
    let mut persons = vec![person];
    persons.extend(cluster.iter().copied());
    assert_eq!(dl::persons_deleted(&mut tx, &persons).await.unwrap(), 1);

    let (tag, tag_owner): (i32, i32) =
        lp_db::sql::query_as("SELECT id, owner_id FROM api_tag ORDER BY id LIMIT 1")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(dl::tags_deleted(&mut tx, &[tag]).await.unwrap(), 1);

    // Un-share: users that do not exist get nothing.
    let n = dl::unshared(
        &mut tx,
        entity::ALBUM_AUTO,
        &["987654".to_string(), "987653".to_string()],
        &[owner, 999_999],
    )
    .await
    .unwrap();
    assert_eq!(n, 2);
    tx.commit().await.unwrap();

    let rows = of(tombs(&db, &[album.to_string()]).await, entity::ALBUM_USER);
    assert!(rows.iter().all(|t| t.entity == entity::ALBUM_USER));
    assert_eq!(rows.iter().map(|t| t.owner_id).collect::<Vec<_>>(), want);
    let rows = of(tombs(&db, &[person.to_string()]).await, entity::PERSON);
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].entity.as_str(), rows[0].owner_id),
        (entity::PERSON, person_owner)
    );
    let rows = of(tombs(&db, &[tag.to_string()]).await, entity::TAG);
    assert!(
        rows.iter()
            .any(|t| t.entity == entity::TAG && t.owner_id == tag_owner)
    );
    let rows = tombs(&db, &["987653".to_string(), "987654".to_string()]).await;
    assert_eq!(
        rows.iter()
            .map(|t| (t.entity_id.as_str(), t.owner_id))
            .collect::<Vec<_>>(),
        [("987653", owner), ("987654", owner)],
        "entity order, existing users only"
    );
    assert_django_text(&db, &album.to_string()).await;

    // prune_deletion_log: only tombstones past the 90-day horizon go.
    lp_db::sql::query(
        "INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) VALUES \
         ('photo', 'prune-old', $1, $2), ('photo', 'prune-new', $1, $3)",
    )
    .bind(owner)
    .bind(Utc::now() - Duration::days(91))
    .bind(Utc::now() - Duration::days(89))
    .execute(&db)
    .await
    .unwrap();
    assert!(dl::prune(&db).await.unwrap() >= 1);
    let left = tombs(&db, &["prune-old".to_string(), "prune-new".to_string()]).await;
    assert_eq!(
        left.iter()
            .map(|t| t.entity_id.as_str())
            .collect::<Vec<_>>(),
        ["prune-new"]
    );
    app.cleanup().await;
}
