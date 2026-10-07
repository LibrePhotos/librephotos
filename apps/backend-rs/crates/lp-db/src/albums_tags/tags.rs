//! `Tag` reads.

use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;

use super::things_places::{HasTotal, fetch_paged};
use super::{Paged, json_list, photo_hash_json, push_search};
use crate::db::{DjUuid, Exec, Qb, sql};
use crate::scope;

/// `TagSerializer`: `{id, name, photo_count}`.
#[derive(Debug, Clone, FromRow, serde::Serialize)]
pub struct TagRow {
    pub id: i32,
    pub name: String,
    pub photo_count: i32,
}

/// `TagListSerializer` row.
#[derive(Debug, Clone, FromRow)]
pub struct TagListRow {
    pub id: i32,
    pub name: String,
    pub photo_count: i32,
    pub cover_photos: Json<serde_json::Value>,
    pub total_count: i64,
}

impl HasTotal for TagListRow {
    fn total(&self) -> i64 {
        self.total_count
    }
}

/// A photo reference as `_get_photo_filter_kwargs` reads it: a UUID when it
/// looks like one (36 chars, 4 dashes, parses), else an image hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhotoRef {
    Id(Uuid),
    Hash(String),
}

impl PhotoRef {
    pub fn parse(value: &str) -> PhotoRef {
        if value.len() == 36
            && value.matches('-').count() == 4
            && let Ok(id) = Uuid::parse_str(value)
        {
            return PhotoRef::Id(id);
        }
        PhotoRef::Hash(value.to_string())
    }
}

pub async fn list<'e, E>(
    db: E,
    owner_id: i32,
    photo: Option<&PhotoRef>,
    search: &[String],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<TagListRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        let mut qb = Qb::new("");
        qb.push_with(|d| {
            format!(
                "SELECT t.id, t.name, t.photo_count, \
                   (SELECT {list} FROM ( \
                      SELECT {ph} AS j, cl.id AS lid FROM api_tag_photos cl \
                        JOIN api_photo p ON p.id = cl.photo_id \
                        WHERE cl.tag_id = t.id AND ",
                list = json_list(d, "c.j", "c.lid"),
                ph = photo_hash_json(d, "p"),
            )
        });
        scope::visible_manager(&mut qb, "p");
        qb.push(
            " ORDER BY cl.id LIMIT 4) c) AS cover_photos, count(*) OVER () AS total_count \
             FROM api_tag t WHERE t.owner_id = ",
        );
        qb.push_bind(owner_id);
        match photo {
            Some(PhotoRef::Id(id)) => {
                qb.push(" AND EXISTS (SELECT 1 FROM api_tag_photos fl WHERE fl.tag_id = t.id AND fl.photo_id = ");
                qb.push_bind(*id);
                qb.push(")");
            }
            Some(PhotoRef::Hash(hash)) => {
                qb.push(
                    " AND EXISTS (SELECT 1 FROM api_tag_photos fl JOIN api_photo fp ON fp.id = fl.photo_id \
                       WHERE fl.tag_id = t.id AND fp.image_hash = ",
                );
                qb.push_bind(hash.clone());
                qb.push(")");
            }
            None => {}
        }
        push_search(&mut qb, &["t.name"], search);
        qb.push(" ORDER BY t.name, t.id LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

/// The owner's tag `id` (another account's id behaves like a missing one).
pub async fn owned<'e>(db: impl Exec<'e>, id: i32, owner_id: i32) -> sqlx::Result<Option<TagRow>> {
    crate::sql::query_as(
        "SELECT id, name, photo_count FROM api_tag WHERE id = $1 AND owner_id = $2",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
}

pub async fn by_name<'e>(
    db: impl Exec<'e>,
    name: &str,
    owner_id: i32,
) -> sqlx::Result<Option<TagRow>> {
    crate::sql::query_as(
        "SELECT id, name, photo_count FROM api_tag WHERE name = $1 AND owner_id = $2",
    )
    .bind(name)
    .bind(owner_id)
    .fetch_optional(db)
    .await
}

/// Whether another of the owner's tags already uses `name`.
pub async fn name_taken<'e>(
    db: impl Exec<'e>,
    name: &str,
    owner_id: i32,
    except: Option<i32>,
) -> sqlx::Result<bool> {
    crate::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_tag WHERE name = $1 AND owner_id = $2 \
           AND ($3 IS NULL OR id <> $3))",
    )
    .bind(name)
    .bind(owner_id)
    .bind(except)
    .fetch_one(db)
    .await
}

/// `(id, image_hash)` of the owner's photos matching any of `ids` / `hashes`.
pub async fn owned_photos_matching<'e>(
    db: impl Exec<'e>,
    owner_id: i32,
    ids: &[Uuid],
    hashes: &[String],
) -> sqlx::Result<Vec<(Uuid, String)>> {
    let d = db.dialect();
    let rows: Vec<(DjUuid, String)> = crate::sql::query_as(format!(
        "SELECT id, image_hash FROM api_photo WHERE owner_id = $1 AND ({} OR {})",
        sql::any_sql(d, "id", 2),
        sql::any_sql(d, "image_hash", 3)
    ))
    .bind(owner_id)
    .bind(ids)
    .bind(hashes)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(id, h)| (id.0, h)).collect())
}
