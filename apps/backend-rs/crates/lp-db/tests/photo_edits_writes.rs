//! `photo_edits` write services that the endpoint tests cannot reach without
//! ExifTool, on both dialects (`LP_TEST_BACKEND=sqlite`).

#![allow(clippy::disallowed_methods)]

use lp_db::db::DjUuid;
use lp_db::write::photo_edits::edit;
use lp_testkit::TestApp;

/// The rotation's file write runs between two short transactions, so the
/// adopt step re-checks `local_orientation` and leaves a newer rotation alone.
#[tokio::test]
async fn adopt_written_orientation_rechecks_local() {
    let app = TestApp::new().await;
    let db = app.pool();
    let photo: DjUuid = lp_db::sql::query_scalar(
        "SELECT p.id FROM api_photo p JOIN api_photometadata md ON md.photo_id = p.id \
         ORDER BY p.id LIMIT 1",
    )
    .fetch_one(db)
    .await
    .unwrap();
    let id = photo.0;

    let mut tx = db.begin().await.unwrap();
    let before = edit::set_local_orientation(&mut tx, id, 6).await.unwrap();
    assert_eq!(edit::lock_local_orientation(&mut tx, id).await.unwrap(), 6);
    tx.commit().await.unwrap();

    let orientation = || async {
        let row: (i32, Option<i32>) = lp_db::sql::query_as(
            "SELECT p.local_orientation, md.orientation FROM api_photo p \
             JOIN api_photometadata md ON md.photo_id = p.id WHERE p.id = $1",
        )
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap();
        row
    };
    let (_, md_before) = orientation().await;

    // Another rotation landed in between: nothing is adopted.
    let mut tx = db.begin().await.unwrap();
    assert!(!edit::adopt_written_orientation(&mut tx, id, 3, 8).await.unwrap());
    tx.commit().await.unwrap();
    assert_eq!(orientation().await, (6, md_before));

    let mut tx = db.begin().await.unwrap();
    assert!(edit::adopt_written_orientation(&mut tx, id, 6, 8).await.unwrap());
    tx.commit().await.unwrap();
    assert_eq!(orientation().await, (1, Some(8)));

    // update_fields saves: no last_modified bump.
    let last_modified: chrono::DateTime<chrono::Utc> =
        lp_db::sql::query_scalar("SELECT last_modified FROM api_photo WHERE id = $1")
            .bind(id)
            .fetch_one(db)
            .await
            .unwrap();
    assert_eq!(last_modified, before);
    app.cleanup().await;
}
