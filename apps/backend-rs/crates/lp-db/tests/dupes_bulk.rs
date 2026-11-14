//! `create_or_merge_many` leaves the same `Duplicate` rows as calling
//! `create_or_merge` once per group, with and without existing groups to
//! merge into.

#![allow(clippy::disallowed_methods)]

use lp_db::stats_admin_stacks_dupes::dupes::{EXACT_COPY, VISUAL_DUPLICATE};
use lp_db::write::stats_admin_stacks_dupes::dupes::{create_or_merge, create_or_merge_many};
use lp_testkit::TestApp;
use sqlx::PgConnection;
use uuid::Uuid;

/// The owner's groups of a type as (sorted members, savings, status), sorted.
async fn snapshot(
    conn: &mut PgConnection,
    owner: i32,
    kind: &str,
) -> Vec<(Vec<Uuid>, i64, String)> {
    let rows: Vec<(Vec<Uuid>, i64, String)> = sqlx::query_as(
        "SELECT array_agg(x.photo_id ORDER BY x.photo_id), d.potential_savings, d.review_status \
         FROM api_duplicate d JOIN api_photo_duplicates x ON x.duplicate_id = d.id \
         WHERE d.owner_id = $1 AND d.duplicate_type = $2 GROUP BY d.id",
    )
    .bind(owner)
    .bind(kind)
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    let mut rows = rows;
    rows.sort();
    rows
}

#[tokio::test]
async fn bulk_matches_one_by_one() {
    let app = TestApp::new().await;
    let pool = app.pool().clone();
    let owner: i32 = sqlx::query_scalar(
        "SELECT owner_id FROM api_photo GROUP BY owner_id ORDER BY count(*) DESC, owner_id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let photos: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM api_photo WHERE owner_id = $1 ORDER BY id LIMIT 12")
            .bind(owner)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(photos.len() >= 12, "fixture owner with 12 photos");
    let p = |i: usize| photos[i];

    for kind in [VISUAL_DUPLICATE, EXACT_COPY] {
        // Existing groups: {0,1} and {2,3}; the new groups join both of them
        // ({1,2,4}) or stand alone ({6,7}, {8,9,10}); a single photo is no group.
        let setup = [vec![p(0), p(1)], vec![p(2), p(3)]];
        let groups = vec![
            vec![p(6), p(7)],
            vec![p(1), p(2), p(4)],
            vec![p(8), p(9), p(10)],
            vec![p(11)],
        ];
        let mut results = Vec::new();
        for bulk in [false, true] {
            let mut tx = pool.begin().await.unwrap();
            sqlx::query(
                "DELETE FROM api_photo_duplicates WHERE duplicate_id IN \
                (SELECT id FROM api_duplicate WHERE owner_id = $1)",
            )
            .bind(owner)
            .execute(&mut *tx)
            .await
            .unwrap();
            sqlx::query("DELETE FROM api_duplicate WHERE owner_id = $1")
                .bind(owner)
                .execute(&mut *tx)
                .await
                .unwrap();
            for g in &setup {
                create_or_merge(&mut tx, owner, kind, g, None)
                    .await
                    .unwrap();
            }
            let n = if bulk {
                create_or_merge_many(&mut tx, owner, kind, &groups)
                    .await
                    .unwrap()
            } else {
                let mut n = 0;
                for g in &groups {
                    if create_or_merge(&mut tx, owner, kind, g, None)
                        .await
                        .unwrap()
                        .is_some()
                    {
                        n += 1;
                    }
                }
                n
            };
            results.push((n, snapshot(&mut tx, owner, kind).await));
            tx.rollback().await.unwrap();
        }
        assert_eq!(results[0], results[1], "{kind}");
        let (n, groups) = &results[1];
        assert_eq!(*n, 3, "{kind}");
        assert_eq!(groups.len(), 3, "{kind}: {groups:?}");
    }
    app.cleanup().await;
}

/// Timing on an existing detected library (e.g. a `lp_bench_50k` clone after
/// `dupes.detect`), rolled back: the one-by-one path, the bulk path, and a
/// re-run where every group merges into an existing one.
/// `LP_DUPES_DB=<db> cargo test -p lp-db --test dupes_bulk -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn bulk_speed_on_library() {
    let Ok(db) = std::env::var("LP_DUPES_DB") else {
        return;
    };
    let app = TestApp::attach(&db, &[]).await;
    let pool = app.pool().clone();
    let (owner, kind) = (2, VISUAL_DUPLICATE);
    let groups: Vec<Vec<Uuid>> = sqlx::query_scalar(
        "SELECT array_agg(x.photo_id ORDER BY x.photo_id) FROM api_duplicate d \
         JOIN api_photo_duplicates x ON x.duplicate_id = d.id \
         WHERE d.owner_id = $1 AND d.duplicate_type = $2 GROUP BY d.id",
    )
    .bind(owner)
    .bind(kind)
    .fetch_all(&pool)
    .await
    .unwrap();
    let before = {
        let mut conn = pool.acquire().await.unwrap();
        snapshot(&mut conn, owner, kind).await
    };
    let mut results = Vec::new();
    for bulk in [false, true] {
        let mut tx = pool.begin().await.unwrap();
        sqlx::query(
            "DELETE FROM api_photo_duplicates WHERE duplicate_id IN \
             (SELECT id FROM api_duplicate WHERE owner_id = $1 AND duplicate_type = $2)",
        )
        .bind(owner)
        .bind(kind)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("DELETE FROM api_duplicate WHERE owner_id = $1 AND duplicate_type = $2")
            .bind(owner)
            .bind(kind)
            .execute(&mut *tx)
            .await
            .unwrap();
        let t = std::time::Instant::now();
        if bulk {
            create_or_merge_many(&mut tx, owner, kind, &groups)
                .await
                .unwrap();
        } else {
            for g in &groups {
                create_or_merge(&mut tx, owner, kind, g, None)
                    .await
                    .unwrap();
            }
        }
        let elapsed = t.elapsed();
        let after = snapshot(&mut tx, owner, kind).await;
        println!(
            "{}: {} groups in {elapsed:?}, same rows as detected: {}",
            if bulk { "bulk" } else { "one by one" },
            groups.len(),
            after == before
        );
        if bulk {
            // A re-run finds the same groups again: every one merges.
            let t = std::time::Instant::now();
            create_or_merge_many(&mut tx, owner, kind, &groups)
                .await
                .unwrap();
            println!("re-run (all merge): {:?}", t.elapsed());
            assert_eq!(snapshot(&mut tx, owner, kind).await, after, "re-run");
        }
        results.push(after);
        tx.rollback().await.unwrap();
    }
    assert_eq!(results[0], results[1]);
}
