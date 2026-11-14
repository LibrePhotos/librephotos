//! THE shared photo summary: `PigPhoto` (port of `PhotoSummarySerializer`,
//! zod `PigPhoto` in packages/api-client/src/schemas/common.ts) and the
//! date grouping of `PhotosGroupedByDate`. Timeline, albums, search and
//! sharing all render photos through here.
//!
//! One query per call: stacks, the RAW-variant flag and the motion-photo
//! flag are correlated subqueries, so there is no N+1 and no follow-up.
//!
//! Two entry points:
//! * [`by_ids`]: you already have an ordered id list (e.g. a page of ids).
//! * [`query`] + [`fetch`]: build `WHERE`/`ORDER BY`/`LIMIT` yourself on the
//!   photo alias `p` and get summaries in one round trip.

use chrono::{DateTime, Utc};
use lp_core::codecs::DominantColor;
use lp_core::time::{drf_datetime, py_isoformat};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::{FromRow, PgExecutor, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::users::SimpleUser;

/// Stack types the frontend's `StackTypeEnum` accepts. Legacy `raw_jpeg` /
/// `live_photo` stacks are never emitted (03 §1.5).
pub const VALID_STACK_TYPES_SQL: &str = "('burst', 'bracket', 'manual')";

/// Columns selected for a summary; the photo table must be aliased `p`.
pub const PIG_COLUMNS: &str = "p.id, p.image_hash, p.exif_timestamp, p.rating, p.video, \
    p.video_length, p.exif_gps_lat, p.exif_gps_lon, p.removed, p.in_trashcan, p.local_orientation, \
    pig_t.aspect_ratio, pig_t.dominant_color, pig_s.search_location, \
    pig_u.id AS owner_id, pig_u.username AS owner_username, \
    pig_u.first_name AS owner_first_name, pig_u.last_name AS owner_last_name, \
    (p.main_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM api_file_embedded_media pig_em \
        WHERE pig_em.from_file_id = p.main_file_id)) AS has_embedded_media, \
    EXISTS (SELECT 1 FROM api_photo_files pig_pf JOIN api_file pig_f ON pig_f.hash = pig_pf.file_id \
        WHERE pig_pf.photo_id = p.id AND pig_f.type = 4) AS has_raw_variant, \
    (SELECT jsonb_agg(jsonb_build_object('id', pig_st.id, 'type', pig_st.stack_type, \
            'photo_count', (SELECT count(*) FROM api_photo_stacks pig_c WHERE pig_c.photostack_id = pig_st.id), \
            'is_primary', COALESCE(pig_st.primary_photo_id = p.id, FALSE)) \
        ORDER BY pig_st.created_at DESC, pig_st.id) \
      FROM api_photo_stacks pig_ps JOIN api_photostack pig_st ON pig_st.id = pig_ps.photostack_id \
      WHERE pig_ps.photo_id = p.id AND pig_st.stack_type IN ('burst', 'bracket', 'manual')) AS stacks";

/// Joins required by [`PIG_COLUMNS`], to append after `FROM api_photo p`.
pub const PIG_JOINS: &str = " LEFT JOIN api_thumbnail pig_t ON pig_t.photo_id = p.id \
    LEFT JOIN api_photo_search pig_s ON pig_s.photo_id = p.id \
    JOIN api_user pig_u ON pig_u.id = p.owner_id";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StackSummary {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: String,
    pub photo_count: i64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct PigRow {
    pub id: Uuid,
    pub image_hash: String,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub rating: i32,
    pub video: bool,
    pub video_length: Option<String>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub removed: bool,
    pub in_trashcan: bool,
    pub local_orientation: i32,
    pub aspect_ratio: Option<f64>,
    pub dominant_color: Option<String>,
    pub search_location: Option<String>,
    pub owner_id: i32,
    pub owner_username: String,
    pub owner_first_name: String,
    pub owner_last_name: String,
    pub has_embedded_media: bool,
    pub has_raw_variant: bool,
    pub stacks: Option<Json<Vec<StackSummary>>>,
}

/// Serialized field order = `PhotoSummarySerializer.Meta.fields`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PigPhoto {
    pub id: Uuid,
    pub image_hash: String,
    #[serde(rename = "dominantColor")]
    pub dominant_color: String,
    pub url: String,
    pub location: String,
    /// `exif_timestamp.isoformat()` (`+00:00`) or `""`.
    pub date: String,
    /// DRF-encoded datetime (`Z`) or `""`.
    #[serde(rename = "birthTime")]
    pub birth_time: String,
    #[serde(rename = "aspectRatio")]
    pub aspect_ratio: Option<f64>,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Stored text, `""` when missing.
    pub video_length: String,
    pub rating: i32,
    pub owner: SimpleUser,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub removed: bool,
    pub in_trashcan: bool,
    /// `null` when the photo is in no burst/bracket/manual stack.
    pub stacks: Option<Vec<StackSummary>>,
    pub has_raw_variant: bool,
    pub local_orientation: i32,
    /// Raw timestamp for grouping/sorting; not serialized.
    #[serde(skip)]
    pub exif_timestamp: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub video: bool,
}

impl From<PigRow> for PigPhoto {
    fn from(r: PigRow) -> Self {
        let kind = if r.video {
            "video"
        } else if r.has_embedded_media {
            "motion_photo"
        } else {
            "image"
        };
        let stacks = r.stacks.map(|j| j.0).filter(|s| !s.is_empty());
        PigPhoto {
            id: r.id,
            dominant_color: DominantColor::css_hex(r.dominant_color.as_deref()),
            url: r.image_hash.clone(),
            image_hash: r.image_hash,
            location: r
                .search_location
                .filter(|s| !s.is_empty())
                .unwrap_or_default(),
            date: r
                .exif_timestamp
                .as_ref()
                .map(py_isoformat)
                .unwrap_or_default(),
            birth_time: r
                .exif_timestamp
                .as_ref()
                .map(drf_datetime)
                .unwrap_or_default(),
            aspect_ratio: r.aspect_ratio,
            kind,
            video_length: r.video_length.filter(|s| !s.is_empty()).unwrap_or_default(),
            rating: r.rating,
            owner: SimpleUser {
                id: r.owner_id,
                username: r.owner_username,
                first_name: r.owner_first_name,
                last_name: r.owner_last_name,
            },
            exif_gps_lat: r.exif_gps_lat,
            exif_gps_lon: r.exif_gps_lon,
            removed: r.removed,
            in_trashcan: r.in_trashcan,
            stacks,
            has_raw_variant: r.has_raw_variant,
            local_orientation: r.local_orientation,
            exif_timestamp: r.exif_timestamp,
            video: r.video,
        }
    }
}

/// `SELECT <pig columns> FROM api_photo p <joins>`; push `" WHERE ..."`,
/// ordering and limits yourself (alias `p`), then call [`fetch`].
pub fn query<'a>() -> QueryBuilder<'a, Postgres> {
    QueryBuilder::new(format!("SELECT {PIG_COLUMNS} FROM api_photo p{PIG_JOINS}"))
}

pub async fn fetch<'e>(
    qb: &mut QueryBuilder<'_, Postgres>,
    db: impl PgExecutor<'e>,
) -> sqlx::Result<Vec<PigPhoto>> {
    let rows: Vec<PigRow> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(PigPhoto::from).collect())
}

/// Summaries for `ids`, in the given order; unknown ids are skipped.
/// Performs no authorization: scope the ids first.
pub async fn by_ids<'e>(db: impl PgExecutor<'e>, ids: &[Uuid]) -> sqlx::Result<Vec<PigPhoto>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<PigRow> = sqlx::query_as(&format!(
        "SELECT {PIG_COLUMNS} FROM unnest($1::uuid[]) WITH ORDINALITY AS pig_sel(id, ord) \
         JOIN api_photo p ON p.id = pig_sel.id{PIG_JOINS} ORDER BY pig_sel.ord"
    ))
    .bind(ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(PigPhoto::from).collect())
}

/// `GroupedPhotosSerializer` over `get_photos_ordered_by_date`:
/// `{date, location, items}`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DateGroup {
    /// First photo's timestamp, DRF-encoded (`...Z`), or `"No timestamp"`.
    pub date: String,
    /// Always `""` (Django never fills it here).
    pub location: String,
    pub items: Vec<PigPhoto>,
}

/// Port of `get_photos_ordered_by_date`: groups CONSECUTIVE photos sharing a
/// UTC calendar date (input is expected sorted by `exif_timestamp`), and puts
/// all photos without a timestamp into one trailing `"No timestamp"` group.
pub fn group_by_date(photos: Vec<PigPhoto>) -> Vec<DateGroup> {
    let mut out: Vec<DateGroup> = Vec::new();
    let mut no_ts: Vec<PigPhoto> = Vec::new();
    let mut current: Option<(chrono::NaiveDate, usize)> = None;
    for photo in photos {
        match photo.exif_timestamp {
            None => {
                current = None;
                no_ts.push(photo);
            }
            Some(ts) => {
                let day = ts.date_naive();
                match current {
                    Some((d, idx)) if d == day => out[idx].items.push(photo),
                    _ => {
                        current = Some((day, out.len()));
                        out.push(DateGroup {
                            date: drf_datetime(&ts),
                            location: String::new(),
                            items: vec![photo],
                        });
                    }
                }
            }
        }
    }
    if !no_ts.is_empty() {
        out.push(DateGroup {
            date: "No timestamp".into(),
            location: String::new(),
            items: no_ts,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn row(ts: Option<DateTime<Utc>>) -> PigPhoto {
        PigPhoto::from(PigRow {
            id: Uuid::nil(),
            image_hash: "abc1".into(),
            exif_timestamp: ts,
            rating: 0,
            video: false,
            video_length: None,
            exif_gps_lat: None,
            exif_gps_lon: None,
            removed: false,
            in_trashcan: false,
            local_orientation: 1,
            aspect_ratio: Some(1.5),
            dominant_color: Some("[255, 0, 16]".into()),
            search_location: None,
            owner_id: 1,
            owner_username: "a".into(),
            owner_first_name: "".into(),
            owner_last_name: "".into(),
            has_embedded_media: true,
            has_raw_variant: false,
            stacks: Some(Json(vec![])),
        })
    }

    #[test]
    fn summary_fields() {
        let t = Utc.with_ymd_and_hms(2020, 5, 6, 7, 8, 9).unwrap();
        let p = row(Some(t));
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["dominantColor"], "#ff0010");
        assert_eq!(v["url"], "abc1");
        assert_eq!(v["date"], "2020-05-06T07:08:09+00:00");
        assert_eq!(v["birthTime"], "2020-05-06T07:08:09Z");
        assert_eq!(v["type"], "motion_photo");
        assert_eq!(v["video_length"], "");
        assert_eq!(v["location"], "");
        assert!(v["stacks"].is_null());
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys[0], "id");
        assert_eq!(keys.last().unwrap().as_str(), "local_orientation");
        assert!(v.get("exif_timestamp").is_none());
    }

    #[test]
    fn grouping_is_consecutive_and_no_timestamp_last() {
        let d1 = Utc.with_ymd_and_hms(2020, 1, 2, 23, 0, 0).unwrap();
        let d1b = Utc.with_ymd_and_hms(2020, 1, 2, 1, 0, 0).unwrap();
        let d2 = Utc.with_ymd_and_hms(2020, 1, 1, 10, 0, 0).unwrap();
        let groups = group_by_date(vec![
            row(Some(d1)),
            row(Some(d1b)),
            row(None),
            row(Some(d2)),
            row(Some(d1)),
        ]);
        let dates: Vec<_> = groups
            .iter()
            .map(|g| (g.date.as_str(), g.items.len()))
            .collect();
        assert_eq!(
            dates,
            vec![
                ("2020-01-02T23:00:00Z", 2),
                ("2020-01-01T10:00:00Z", 1),
                ("2020-01-02T23:00:00Z", 1),
                ("No timestamp", 1)
            ]
        );
    }
}
