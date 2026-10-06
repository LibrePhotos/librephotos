//! `MemoriesView`: days of earlier years around an anniversary. The window
//! arithmetic lives in the handler; these are its three lookups.

use chrono::NaiveDate;
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::sql::{self, JsonKind};
use crate::db::{DjUuid, Exec, Qb};
use crate::scope::{self, PhotoFilterParams};

/// `memory_candidates`: the timeline's own photos minus screenshots and documents.
fn push_candidates(qb: &mut Qb<'_>, user_id: i32, favorite_min_rating: i32) {
    scope::photo_filters(
        qb,
        "p",
        user_id,
        favorite_min_rating,
        &PhotoFilterParams::default(),
    );
    qb.push(" AND NOT p.removed AND NOT p.is_screenshot AND NOT p.is_document");
}

/// Earliest dated `AlbumDate` of the user.
pub async fn first_date<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<Option<NaiveDate>> {
    crate::sql::query_scalar(
        "SELECT min(date) FROM api_albumdate WHERE owner_id = $1 AND date IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
}

#[derive(Debug, Clone, FromRow)]
pub struct MemoryDay {
    pub date: NaiveDate,
    /// `album_date_place(location)`: `""` when none.
    pub place: String,
    /// Distinct candidate photos filed under that day.
    pub total: i64,
}

/// The user's days inside any of `windows` (inclusive), with their stored
/// place and candidate-photo count.
pub async fn days<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    favorite_min_rating: i32,
    windows: &[(NaiveDate, NaiveDate)],
) -> sqlx::Result<Vec<MemoryDay>> {
    let mut qb = Qb::new("SELECT d.date, CASE WHEN ");
    qb.push_with(|d| {
        format!(
            "{} THEN d.location->'places'->>0 ELSE '' END AS place, ",
            sql::json_type_is(d, "d.location->'places'->0", JsonKind::String)
        )
    });
    qb.push(
        "(SELECT count(DISTINCT p.id) FROM api_photo p \
         JOIN api_albumdate_photos cap ON cap.photo_id = p.id \
         JOIN api_albumdate cad ON cad.id = cap.albumdate_id \
         WHERE cad.date = d.date AND ",
    );
    push_candidates(&mut qb, user_id, favorite_min_rating);
    qb.push(") AS total FROM api_albumdate d WHERE d.owner_id = ");
    qb.push_bind(user_id);
    qb.push(" AND d.date IS NOT NULL AND ");
    push_in_windows(&mut qb, "d.date", windows);
    qb.push(" ORDER BY d.date");
    qb.build_query_as().fetch_all(db).await
}

/// `(col BETWEEN s1 AND e1 OR ..)` over the windows; `FALSE` for none.
fn push_in_windows(qb: &mut Qb<'_>, col: &str, windows: &[(NaiveDate, NaiveDate)]) {
    if windows.is_empty() {
        qb.push("1 = 0");
        return;
    }
    qb.push("(");
    for (i, (s, e)) in windows.iter().enumerate() {
        if i > 0 {
            qb.push(" OR ");
        }
        qb.push(format!("{col} BETWEEN "));
        qb.push_bind(*s);
        qb.push(" AND ");
        qb.push_bind(*e);
    }
    qb.push(")");
}

#[derive(Debug, Clone, FromRow)]
struct WindowPhoto {
    idx: i32,
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
}

/// For each window, the ids of its first `size` candidate photos
/// (chronological, `image_hash` tie-break). Index `i` of the result is
/// window `i`.
pub async fn window_photo_ids<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    favorite_min_rating: i32,
    windows: &[(NaiveDate, NaiveDate)],
    size: i64,
) -> sqlx::Result<Vec<Vec<Uuid>>> {
    let mut out = vec![Vec::new(); windows.len()];
    if windows.is_empty() {
        return Ok(out);
    }
    // One LIMITed subquery per window, glued with UNION ALL (portable form
    // of `unnest(..) WITH ORDINALITY CROSS JOIN LATERAL (.. LIMIT n)`).
    let mut qb = Qb::new("SELECT u.idx, u.id FROM (");
    for (i, w) in windows.iter().enumerate() {
        if i > 0 {
            qb.push(" UNION ALL ");
        }
        qb.push(format!(
            "SELECT {i} AS idx, x.id, x.exif_timestamp, x.image_hash FROM ( \
             SELECT p.id, p.exif_timestamp, p.image_hash FROM api_photo p WHERE "
        ));
        push_candidates(&mut qb, user_id, favorite_min_rating);
        qb.push(
            " AND EXISTS (SELECT 1 FROM api_albumdate_photos wap JOIN api_albumdate wad ON wad.id = wap.albumdate_id \
             WHERE wap.photo_id = p.id AND ",
        );
        push_in_windows(&mut qb, "wad.date", std::slice::from_ref(w));
        qb.push(") ORDER BY p.exif_timestamp, p.image_hash, p.id LIMIT ");
        qb.push_bind(size);
        qb.push(") x");
    }
    qb.push(") u ORDER BY u.idx, u.exif_timestamp, u.image_hash, u.id");
    let rows: Vec<WindowPhoto> = qb.build_query_as().fetch_all(db).await?;
    for r in rows {
        if let Some(slot) = usize::try_from(r.idx).ok().and_then(|i| out.get_mut(i)) {
            slot.push(r.id);
        }
    }
    Ok(out)
}
