//! S1 / S2 helpers other areas call after changing photo visibility.

#![allow(clippy::disallowed_methods)]

use lp_db::db::Db;
use lp_db::db::DjUuid;
use lp_db::write::albums_tags::{
    refresh_album_things, refresh_tag_photo_counts, tag_ids_for_photos,
};
use lp_testkit::TestApp;

#[tokio::test]
async fn counts_follow_visibility() {
    let app = TestApp::new().await;
    let db = app.pool();
    let Some((tag_id, photo_id)): Option<(i32, DjUuid)> = lp_db::sql::query_as(
        "SELECT tp.tag_id, tp.photo_id FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id \
         WHERE NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed ORDER BY tp.id LIMIT 1",
    )
    .fetch_optional(db)
    .await
    .unwrap() else {
        return app.cleanup().await;
    };
    let count = |db: Db| async move {
        lp_db::sql::query_scalar::<_, i32>("SELECT photo_count FROM api_tag WHERE id = $1")
            .bind(tag_id)
            .fetch_one(&db)
            .await
            .unwrap()
    };
    let before = count(db.clone()).await;
    lp_db::sql::query("UPDATE api_photo SET hidden = TRUE WHERE id = $1")
        .bind(photo_id)
        .execute(db)
        .await
        .unwrap();
    let mut conn = db.acquire().await.unwrap();
    let tags = tag_ids_for_photos(&mut conn, &[photo_id.0]).await.unwrap();
    assert!(tags.contains(&tag_id));
    refresh_tag_photo_counts(&mut conn, &tags).await.unwrap();
    assert_eq!(count(db.clone()).await, before - 1);

    // AlbumThing: hidden photos stop counting; covers are topped up to 4
    // from visible members only.
    let things: Vec<i32> = lp_db::sql::query_scalar("SELECT id FROM api_albumthing ORDER BY id")
        .fetch_all(db)
        .await
        .unwrap();
    // Through the held connection: on SQLite it is the single writer.
    lp_db::sql::query("DELETE FROM api_albumthing_cover_photos")
        .execute(&mut *conn)
        .await
        .unwrap();
    refresh_album_things(&mut conn, &things).await.unwrap();
    let bad: i64 = lp_db::sql::query_scalar(
        "SELECT count(*) FROM api_albumthing t WHERE t.photo_count <> (SELECT count(*) \
           FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumthing_id = t.id AND NOT p.hidden) \
         OR (SELECT count(*) FROM api_albumthing_cover_photos c WHERE c.albumthing_id = t.id) \
            <> CASE WHEN t.photo_count < 4 THEN t.photo_count ELSE 4 END",
    )
    .fetch_one(db)
    .await
    .unwrap();
    assert_eq!(bad, 0);
    drop(conn);
    app.cleanup().await;
}
