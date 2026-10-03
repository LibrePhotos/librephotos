//! Shared photo summary against whatever the test template holds
//! (the lp_fixture pack when present, else an empty schema).

#![allow(clippy::disallowed_methods)]

use lp_db::{QueryBuilder, pig, scope};
use lp_testkit::TestApp;
use uuid::Uuid;

#[tokio::test]
async fn summaries_keep_order_and_shape() {
    let app = TestApp::shared().await;
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM api_photo ORDER BY id DESC")
        .fetch_all(app.pool())
        .await
        .unwrap();
    let mut wanted = ids.clone();
    wanted.push(Uuid::new_v4()); // unknown ids are skipped
    let photos = pig::by_ids(app.pool(), &wanted).await.unwrap();
    assert_eq!(photos.iter().map(|p| p.id).collect::<Vec<_>>(), ids);
    for p in &photos {
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(v["url"], v["image_hash"]);
        assert!(["image", "video", "motion_photo"].contains(&v["type"].as_str().unwrap()));
        if let Some(stacks) = v["stacks"].as_array() {
            assert!(!stacks.is_empty());
            for s in stacks {
                assert!(["burst", "bracket", "manual"].contains(&s["type"].as_str().unwrap()));
            }
        }
    }

    // Same rows through the builder + a scope, one query.
    if let Some(first) = photos.first() {
        let mut qb: QueryBuilder<'_, sqlx::Postgres> = pig::query();
        qb.push(" WHERE ");
        scope::owned_by(&mut qb, "p", first.owner.id);
        qb.push(" ORDER BY p.exif_timestamp DESC NULLS LAST, p.id");
        let mine = pig::fetch(&mut qb, app.pool()).await.unwrap();
        assert!(mine.iter().all(|p| p.owner.id == first.owner.id));
        let groups = pig::group_by_date(mine.clone());
        assert_eq!(
            groups.iter().map(|g| g.items.len()).sum::<usize>(),
            mine.len()
        );
    }
    app.cleanup().await;
}

/// Dump summaries of every photo (ordered by id) of `LP_PIG_DB` to
/// `LP_PIG_OUT`, for diffing against Django's `PhotoSummarySerializer`.
#[tokio::test]
#[ignore]
async fn dump_for_django_diff() {
    let db = std::env::var("LP_PIG_DB").expect("LP_PIG_DB");
    let out = std::env::var("LP_PIG_OUT").expect("LP_PIG_OUT");
    let app = TestApp::attach(&db, &[]).await;
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM api_photo ORDER BY id")
        .fetch_all(app.pool())
        .await
        .unwrap();
    let photos = pig::by_ids(app.pool(), &ids).await.unwrap();
    std::fs::write(out, serde_json::to_vec(&photos).unwrap()).unwrap();
    app.cleanup().await;
}
