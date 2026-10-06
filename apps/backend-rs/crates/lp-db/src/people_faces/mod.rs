//! Read queries and row types for the `people_faces` area (owned by that area).
//!
//! Ports of `PersonViewSet.get_queryset`, `FaceIncompleteListViewSet`,
//! `FaceListView` and the inputs of `face_classify.cluster_faces`. Every
//! face query is scoped to the requester's own photos (`photo__owner`).

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{DjUuid, DjUuidOpt, Exec, Qb};
use crate::scope;

pub const UNKNOWN_PERSON_NAME: &str = "Unknown - Other";
pub const KIND_USER: &str = "USER";
pub const KIND_CLUSTER: &str = "CLUSTER";
pub const KIND_UNKNOWN: &str = "UNKNOWN";

/// A `PersonSerializer` row: the person, its explicit cover and its first
/// face on the requester's photos (the list view's fallback annotations).
#[derive(Debug, Clone, FromRow)]
pub struct PersonRow {
    pub id: i32,
    pub name: String,
    pub face_count: i32,
    pub cover_face_id: Option<i32>,
    pub cover_face_image: Option<String>,
    pub cover_photo_hash: Option<String>,
    pub cover_photo_video: Option<bool>,
    pub first_face_image: Option<String>,
    pub first_face_photo_hash: Option<String>,
    pub first_face_photo_video: Option<bool>,
    /// `COUNT(*) OVER ()` of the unpaginated list (0 for single lookups).
    pub total: i64,
}

fn person_select(qb: &mut Qb<'_>, user_id: i32, user_kind_only: bool) {
    qb.push(
        "SELECT p.id, p.name, p.face_count, p.cover_face_id, cf.image AS cover_face_image, \
           cp.image_hash AS cover_photo_hash, cp.video AS cover_photo_video, \
           ff.image AS first_face_image, ff.image_hash AS first_face_photo_hash, \
           ff.video AS first_face_photo_video, COUNT(*) OVER () AS total \
         FROM api_person p \
         LEFT JOIN api_face cf ON cf.id = p.cover_face_id \
         LEFT JOIN api_photo cp ON cp.id = p.cover_photo_id \
         LEFT JOIN LATERAL (SELECT f.image, ph.image_hash, ph.video FROM api_face f \
             JOIN api_photo ph ON ph.id = f.photo_id \
             WHERE f.person_id = p.id AND ",
    );
    scope::owned_by(qb, "ph", user_id);
    qb.push(" ORDER BY f.id LIMIT 1) ff ON TRUE WHERE p.cluster_owner_id = ");
    qb.push_bind(user_id);
    if user_kind_only {
        qb.push(" AND p.kind = 'USER'");
    }
}

/// DRF `SearchFilter` on `name`: every term must be contained, any case.
fn push_search(qb: &mut Qb<'_>, terms: &[String]) {
    for term in terms {
        qb.push(" AND UPPER(p.name::text) LIKE UPPER(");
        qb.push_bind(format!("%{}%", scope::like_escape(term)));
        qb.push(")");
    }
}

/// One page of the requester's user-labelled persons, ordered by name.
pub async fn list_persons<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    search: &[String],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<PersonRow>> {
    let mut qb = Qb::new("");
    person_select(&mut qb, user_id, true);
    push_search(&mut qb, search);
    qb.push(" ORDER BY p.name, p.id LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    qb.build_query_as::<PersonRow>().fetch_all(db).await
}

pub async fn count_persons<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    search: &[String],
) -> sqlx::Result<i64> {
    let mut qb = Qb::new(
        "SELECT COUNT(*) FROM api_person p WHERE p.kind = 'USER' AND p.cluster_owner_id = ",
    );
    qb.push_bind(user_id);
    push_search(&mut qb, search);
    qb.build_query_scalar::<i64>().fetch_one(db).await
}

/// `PersonViewSet.get_object()`: a user-labelled person of the requester
/// (the list's `?search=` narrows the detail routes too, as in DRF).
pub async fn person_for_owner<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    person_id: i64,
    search: &[String],
) -> sqlx::Result<Option<PersonRow>> {
    let mut qb = Qb::new("");
    person_select(&mut qb, user_id, true);
    qb.push(" AND p.id = ");
    qb.push_bind(person_id);
    push_search(&mut qb, search);
    qb.build_query_as::<PersonRow>().fetch_optional(db).await
}

/// A person of the requester of any kind (`PersonSerializer.create` can
/// hand back a cluster that already carries the name).
pub async fn owned_person_any_kind<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    person_id: i32,
) -> sqlx::Result<Option<PersonRow>> {
    let mut qb = Qb::new("");
    person_select(&mut qb, user_id, false);
    qb.push(" AND p.id = ");
    qb.push_bind(person_id);
    qb.build_query_as::<PersonRow>().fetch_optional(db).await
}

/// `Photo.objects.owned_by(user)` looked up by image hash first, then by
/// primary key (`PersonSerializer.update`, cover photo).
pub async fn owned_photo_by_hash_or_id<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    photo_ref: &str,
) -> sqlx::Result<Option<Uuid>> {
    let as_uuid = Uuid::parse_str(photo_ref).ok();
    crate::sql::query_scalar::<_, Uuid>(
        "SELECT id FROM ( \
           (SELECT 0 AS k, id FROM api_photo WHERE owner_id = $1 AND image_hash = $2 ORDER BY id LIMIT 1) \
           UNION ALL \
           (SELECT 1 AS k, id FROM api_photo WHERE owner_id = $1 AND id = $3) \
         ) x ORDER BY k LIMIT 1",
    )
    .bind(user_id)
    .bind(photo_ref)
    .bind(as_uuid)
    .fetch_optional(db)
    .await
}

/// Which face query the incomplete list and the face list mirror.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AnalysisMethod {
    Clustering,
    Classification,
}

#[derive(Debug, Clone, FromRow)]
pub struct IncompletePerson {
    pub id: i32,
    pub name: String,
    pub kind: String,
    pub face_count: i64,
}

/// `FaceIncompleteListViewSet.get_queryset`: the requester's persons with at
/// least one face in the requested bucket, ordered by name. `inferred`
/// `None` = labelled faces of user-labelled persons.
pub async fn incomplete_persons<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    inferred: Option<(AnalysisMethod, f64)>,
) -> sqlx::Result<Vec<IncompletePerson>> {
    let mut qb = Qb::new(
        "SELECT p.id, p.name, p.kind, COUNT(f.id) AS face_count FROM api_person p \
         JOIN api_face f ON ",
    );
    match inferred {
        None => {
            qb.push("f.person_id = p.id AND NOT f.deleted");
        }
        Some((AnalysisMethod::Clustering, min)) => {
            qb.push(
                "f.cluster_person_id = p.id AND NOT f.deleted AND f.person_id IS NULL \
                 AND f.cluster_probability >= ",
            );
            qb.push_bind(min);
        }
        Some((AnalysisMethod::Classification, min)) => {
            qb.push(
                "f.classification_person_id = p.id AND NOT f.deleted AND f.person_id IS NULL \
                 AND f.classification_probability >= ",
            );
            qb.push_bind(min);
        }
    }
    qb.push(" JOIN api_photo ph ON ph.id = f.photo_id AND ");
    scope::owned_by(&mut qb, "ph", user_id);
    qb.push(" WHERE p.cluster_owner_id = ");
    qb.push_bind(user_id);
    if inferred.is_none() {
        qb.push(" AND p.kind = 'USER'");
    }
    qb.push(" GROUP BY p.id ORDER BY p.name, p.id");
    qb.build_query_as::<IncompletePerson>().fetch_all(db).await
}

/// The "Unknown - Other" bucket size of the incomplete list.
pub async fn unknown_face_count<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    inferred: Option<(AnalysisMethod, f64)>,
) -> sqlx::Result<i64> {
    let mut qb = Qb::new(
        "SELECT COUNT(*) FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id \
         WHERE NOT f.deleted AND f.person_id IS NULL AND ",
    );
    scope::owned_by(&mut qb, "ph", user_id);
    match inferred {
        None => {}
        Some((AnalysisMethod::Clustering, min)) => {
            qb.push(" AND (f.cluster_person_id IS NULL OR f.cluster_probability <= ");
            qb.push_bind(min);
            qb.push(")");
        }
        Some((AnalysisMethod::Classification, min)) => {
            qb.push(" AND f.classification_probability <= ");
            qb.push_bind(min);
        }
    }
    qb.build_query_scalar::<i64>().fetch_one(db).await
}

/// `FaceListView.get_queryset` filter. `person` `None` is the unknown bucket.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FaceFilter {
    /// `person = person` (labelled faces, `-id` order).
    Labeled(Option<i32>),
    /// Inferred faces by clustering or classification, by probability.
    Inferred {
        method: AnalysisMethod,
        person: Option<i32>,
        min_confidence: f64,
    },
}

#[derive(Debug, Clone, FromRow)]
pub struct FaceListRow {
    pub id: i32,
    pub image: Option<String>,
    #[sqlx(try_from = "DjUuidOpt")]
    pub photo_id: Option<Uuid>,
    pub image_hash: Option<String>,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub cluster_probability: f64,
    pub classification_probability: f64,
    pub total: i64,
}

fn push_face_filter(qb: &mut Qb<'_>, user_id: i32, filter: FaceFilter) {
    qb.push(" WHERE ");
    scope::owned_by(qb, "ph", user_id);
    qb.push(" AND NOT f.deleted AND ");
    let opt_eq = |qb: &mut Qb<'_>, col: &str, v: Option<i32>| match v {
        Some(id) => {
            qb.push(format!("f.{col} = "));
            qb.push_bind(id);
        }
        None => {
            qb.push(format!("f.{col} IS NULL"));
        }
    };
    match filter {
        FaceFilter::Labeled(person) => opt_eq(qb, "person_id", person),
        FaceFilter::Inferred {
            method: AnalysisMethod::Classification,
            person,
            min_confidence,
        } => {
            qb.push("f.person_id IS NULL AND ");
            match person {
                None => {
                    qb.push("f.classification_probability <= ");
                    qb.push_bind(min_confidence);
                }
                Some(id) => {
                    qb.push("f.classification_person_id = ");
                    qb.push_bind(id);
                    qb.push(" AND f.classification_probability >= ");
                    qb.push_bind(min_confidence);
                }
            }
        }
        FaceFilter::Inferred {
            method: AnalysisMethod::Clustering,
            person,
            min_confidence,
        } => {
            qb.push("f.person_id IS NULL AND ");
            match person {
                None => {
                    qb.push("(f.cluster_person_id IS NULL OR f.cluster_probability <= ");
                    qb.push_bind(min_confidence);
                    qb.push(")");
                }
                Some(id) => {
                    qb.push("f.cluster_person_id = ");
                    qb.push_bind(id);
                    qb.push(" AND f.cluster_probability >= ");
                    qb.push_bind(min_confidence);
                }
            }
        }
    }
}

/// One page of `FaceListView`, with the unpaginated count in `total`.
pub async fn list_faces<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    filter: FaceFilter,
    order_by_date: bool,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<FaceListRow>> {
    let mut qb = Qb::new(
        "SELECT f.id, f.image, f.photo_id, ph.image_hash, ph.exif_timestamp, \
           f.cluster_probability, f.classification_probability, COUNT(*) OVER () AS total \
         FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id",
    );
    push_face_filter(&mut qb, user_id, filter);
    qb.push(" ORDER BY ");
    if order_by_date {
        qb.push("ph.exif_timestamp, ");
    }
    qb.push(match filter {
        FaceFilter::Labeled(_) => "f.id DESC",
        FaceFilter::Inferred {
            method: AnalysisMethod::Clustering,
            ..
        } => "f.cluster_probability DESC, f.id",
        FaceFilter::Inferred {
            method: AnalysisMethod::Classification,
            ..
        } => "f.classification_probability DESC, f.id",
    });
    qb.push(" LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    qb.build_query_as::<FaceListRow>().fetch_all(db).await
}

pub async fn count_faces<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    filter: FaceFilter,
) -> sqlx::Result<i64> {
    let mut qb = Qb::new("SELECT COUNT(*) FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id");
    push_face_filter(&mut qb, user_id, filter);
    qb.build_query_scalar::<i64>().fetch_one(db).await
}

/// A face for the scatter plot of `/api/clusterfaces`.
#[derive(Debug, Clone, FromRow)]
pub struct VizFace {
    pub id: i32,
    pub image: Option<String>,
    pub encoding: String,
    pub person_id: Option<i32>,
}

/// `collect_visualizable_faces`: the requester's non-deleted faces carrying
/// an encoding. Same statement shape (and so the same row order) as the
/// unordered queryset Django pages through. Not prepared: a cached generic
/// plan joins the other way round and so returns the rows in another order.
pub async fn viz_faces<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<Vec<VizFace>> {
    crate::sql::query_as::<_, VizFace>(
        "SELECT api_face.id, api_face.image, api_face.encoding, api_face.person_id FROM api_face \
         INNER JOIN api_photo ON (api_face.photo_id = api_photo.id) \
         WHERE (api_photo.owner_id = $1 AND NOT api_face.deleted)",
    )
    .persistent(false)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map(|faces| {
        faces
            .into_iter()
            .filter(|f| !f.encoding.is_empty())
            .collect()
    })
}

/// `build_person_color_map`: persons with a face on the requester's photos,
/// in the order Postgres returns Django's `DISTINCT` query (colors are
/// assigned in that order, so the statement is kept identical and, like
/// [`viz_faces`], unprepared).
pub async fn viz_persons<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<Vec<(i32, String)>> {
    crate::sql::query_as::<_, (i32, String, String, DjUuidOpt, Option<i32>, i32, Option<i32>, DateTime<Utc>)>(
        "SELECT DISTINCT api_person.id, api_person.name, api_person.kind, api_person.cover_photo_id, \
           api_person.cover_face_id, api_person.face_count, api_person.cluster_owner_id, \
           api_person.last_modified FROM api_person \
         INNER JOIN api_face ON (api_person.id = api_face.person_id) \
         INNER JOIN api_photo ON (api_face.photo_id = api_photo.id) \
         WHERE api_photo.owner_id = $1",
    )
    .persistent(false)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map(|rows| rows.into_iter().map(|r| (r.0, r.1)).collect())
}

/// `Person.objects.filter(name=, cluster_owner=, kind__in=(CLUSTER, UNKNOWN))`:
/// a face cluster's label, which must not be confirmed as a person's name.
pub async fn is_cluster_label<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    name: &str,
) -> sqlx::Result<bool> {
    crate::sql::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM api_person WHERE name = $1 AND cluster_owner_id = $2 \
           AND kind IN ('CLUSTER', 'UNKNOWN'))",
    )
    .bind(name)
    .bind(user_id)
    .fetch_one(db)
    .await
}

/// The photo `/api/addface` draws on, with its big thumbnail and the boxes
/// (top, right, bottom, left) of its non-deleted faces.
#[derive(Debug, Clone, FromRow)]
pub struct AddFacePhoto {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub image_hash: String,
    pub thumbnail_big: Option<String>,
    pub boxes: Vec<Vec<i32>>,
}

#[derive(FromRow)]
struct AddFacePhotoRow {
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
    image_hash: String,
    thumbnail_big: Option<String>,
    boxes: sqlx::types::Json<Vec<Vec<i32>>>,
}

/// `Photo.objects.owned_by(user).filter(**_get_photo_filter_kwargs(ref)).first()`.
pub async fn add_face_photo<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    photo_ref: &str,
) -> sqlx::Result<Option<AddFacePhoto>> {
    let is_uuid = photo_ref.len() == 36 && photo_ref.matches('-').count() == 4;
    let as_uuid = if is_uuid {
        Uuid::parse_str(photo_ref).ok()
    } else {
        None
    };
    let mut qb = Qb::new(
        "SELECT p.id, p.image_hash, t.thumbnail_big, \
           COALESCE((SELECT jsonb_agg(jsonb_build_array(f.location_top, f.location_right, \
               f.location_bottom, f.location_left) ORDER BY f.id) \
             FROM api_face f WHERE f.photo_id = p.id AND NOT f.deleted), '[]'::jsonb) AS boxes \
         FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    match as_uuid {
        Some(id) => {
            qb.push(" AND p.id = ");
            qb.push_bind(id);
        }
        None => {
            qb.push(" AND p.image_hash = ");
            qb.push_bind(photo_ref.to_string());
        }
    }
    qb.push(" ORDER BY p.id LIMIT 1");
    let row = qb
        .build_query_as::<AddFacePhotoRow>()
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| AddFacePhoto {
        id: r.id,
        image_hash: r.image_hash,
        thumbnail_big: r.thumbnail_big,
        boxes: r.boxes.0,
    }))
}
