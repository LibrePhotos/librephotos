//! Face dashboard: `FaceIncompleteListViewSet` (bare array of buckets),
//! `FaceListView` (DRF page of faces), `SetFacePersonLabel` and `DeleteFaces`.
//! All of them only ever see the requester's own faces.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::people_faces::{self as db, AnalysisMethod, FaceFilter, UNKNOWN_PERSON_NAME};
use lp_db::write::people_faces as write;
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    absolute_url, canonical_uri, face_ids, media_url, py_float, status_message, stripped_str,
};
use crate::common::{DrfPage, PageRequest};

fn min_confidence(q: &QueryMap) -> ApiResult<f64> {
    q.get("min_confidence").map_or(Ok(0.0), py_float)
}

fn method(q: &QueryMap) -> ApiResult<AnalysisMethod> {
    match q.get("analysis_method").unwrap_or("clustering") {
        "clustering" => Ok(AnalysisMethod::Clustering),
        "classification" => Ok(AnalysisMethod::Classification),
        // Django leaves its filter unbound for any other value and crashes.
        other => Err(ApiError::internal(format!(
            "unknown analysis_method {other:?}"
        ))),
    }
}

#[derive(Debug, Serialize)]
struct IncompleteOut {
    id: i32,
    name: String,
    kind: String,
    face_count: i64,
}

/// `GET /api/faces/incomplete/?inferred=&analysis_method=&min_confidence=`:
/// the persons with faces in the requested bucket, then "Unknown - Other".
pub async fn incomplete(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
) -> ApiResult<Json<Vec<Value>>> {
    let inferred = q.get("inferred").unwrap_or("").to_lowercase() == "true";
    let min = min_confidence(&q)?;
    let mode = if inferred {
        Some((method(&q)?, min))
    } else {
        None
    };
    let (persons, unknown) = tokio::try_join!(
        db::incomplete_persons(&state.db, user.id, mode),
        db::unknown_face_count(&state.db, user.id, mode),
    )?;
    let mut out: Vec<Value> = persons
        .into_iter()
        .map(|p| {
            serde_json::to_value(IncompleteOut {
                id: p.id,
                name: p.name,
                kind: p.kind,
                face_count: p.face_count,
            })
        })
        .collect::<Result<_, _>>()?;
    if unknown > 0 {
        out.push(json!({
            "id": 0,
            "name": UNKNOWN_PERSON_NAME,
            "face_count": unknown,
            "kind": UNKNOWN_PERSON_NAME,
        }));
    }
    Ok(Json(out))
}

/// `PersonFaceListSerializer`, in its field order.
#[derive(Debug, Serialize)]
pub struct FaceOut {
    id: i32,
    image: Option<String>,
    face_url: Option<String>,
    photo: Option<Uuid>,
    photo_image_hash: Option<String>,
    #[serde(serialize_with = "lp_core::time::ser_drf_opt")]
    timestamp: Option<DateTime<Utc>>,
    person_label_probability: f64,
}

/// `GET /api/faces/?person=&page=&inferred=&order_by=[&analysis_method=&min_confidence=]`
/// (`RegularResultsSetPagination`: 100 per page, `page_size` up to 200).
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Json<DrfPage<FaceOut>>> {
    // "0" means None; any other value goes to the ORM as is, which parses it
    // like `int()` and crashes (500) on anything else. An empty value is only
    // falsy where the view tests it (the inferred branches).
    let person = match q.get("person").unwrap_or("0") {
        "0" => None,
        p => Some(p),
    };
    let min = min_confidence(&q)?;
    // An empty analysis_method is falsy in Django: the labelled-face query.
    let labeled = (q.get("inferred").unwrap_or("").to_lowercase() == "false"
        && person.is_some_and(|p| !p.is_empty()))
        || q.get("analysis_method") == Some("");
    let person = match person {
        Some("") if !labeled => None,
        Some(p) => Some(
            p.trim()
                .replace('_', "")
                .parse::<i32>()
                .map_err(|_| ApiError::internal(format!("person {p:?} is not a number")))?,
        ),
        None => None,
    };
    let filter = if labeled {
        FaceFilter::Labeled(person)
    } else {
        FaceFilter::Inferred {
            method: method(&q)?,
            person,
            min_confidence: min,
        }
    };
    let by_date = q.get("order_by").unwrap_or("").to_lowercase() == "date";
    let use_cluster = matches!(
        filter,
        FaceFilter::Inferred {
            method: AnalysisMethod::Clustering,
            ..
        }
    );

    let mut req = PageRequest::from_query(&q, "page_size", 100, 200)?;
    let mut rows = Vec::new();
    let count = if req.page == i64::MAX {
        let count = db::count_faces(&state.db, user.id, filter).await?;
        req = req.valid_for(count)?;
        rows = db::list_faces(
            &state.db,
            user.id,
            filter,
            by_date,
            req.page_size,
            req.offset(),
        )
        .await?;
        count
    } else {
        let page = db::list_faces(
            &state.db,
            user.id,
            filter,
            by_date,
            req.page_size,
            req.offset(),
        )
        .await?;
        match page.first() {
            Some(first) => {
                let count = first.total;
                rows = page;
                count
            }
            None => {
                let count = db::count_faces(&state.db, user.id, filter).await?;
                req = req.valid_for(count)?;
                count
            }
        }
    };
    let results = rows
        .into_iter()
        .map(|r| {
            let url = r.image.as_deref().filter(|i| !i.is_empty()).map(media_url);
            FaceOut {
                id: r.id,
                image: url.as_deref().map(|u| absolute_url(&headers, u)),
                face_url: url,
                photo: r.photo_id,
                photo_image_hash: r.image_hash,
                timestamp: r.exif_timestamp,
                person_label_probability: if use_cluster {
                    r.cluster_probability
                } else {
                    r.classification_probability
                },
            }
        })
        .collect();
    Ok(Json(DrfPage::new(
        &headers,
        &canonical_uri(&uri),
        req,
        count,
        results,
    )))
}

/// `FaceListSerializer` (no request context, so `image` is relative).
#[derive(Debug, Serialize)]
struct LabeledOut {
    id: i32,
    image: Option<String>,
    face_url: Option<String>,
    photo: Option<Uuid>,
    #[serde(serialize_with = "lp_core::time::ser_drf_opt")]
    timestamp: Option<DateTime<Utc>>,
    person: Option<i32>,
    person_label_probability: f64,
    person_name: String,
}

/// `POST /api/labelfaces` `{face_ids, person_name}`: label the requester's
/// faces as `person_name` (created on demand), or push them back to
/// unknown with "Unknown - Other". S19 side effects in one transaction.
pub async fn label(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let person_name = stripped_str(&body, "person_name")?;
    if person_name.is_empty() {
        return Ok(status_message(
            StatusCode::BAD_REQUEST,
            "person_name must not be empty",
        ));
    }
    let target = if person_name == UNKNOWN_PERSON_NAME {
        None
    } else {
        if db::is_cluster_label(&state.db, user.id, &person_name).await? {
            return Ok(status_message(
                StatusCode::BAD_REQUEST,
                format!(
                    "\"{person_name}\" is the label of a face cluster, not a person. Name the face \
                     instead of confirming the cluster."
                ),
            ));
        }
        Some(person_name.as_str())
    };
    let ids = face_ids(&body)?;
    let tagging_model = state.settings().tagging_model.clone();
    let (person, faces) =
        write::label_faces(&state.db, user.id, &ids, target, &tagging_model).await?;
    let photos: Vec<uuid::Uuid> = faces.iter().filter_map(|f| f.photo_id).collect();
    lp_ingest::face_tags::queue(&state, &user, &photos).await;
    let updated: Vec<LabeledOut> = faces
        .into_iter()
        .map(|f| {
            let url = f.image.as_deref().filter(|i| !i.is_empty()).map(media_url);
            LabeledOut {
                id: f.id,
                image: url.clone(),
                face_url: url,
                photo: f.photo_id,
                timestamp: f.exif_timestamp,
                person: person.as_ref().map(|p| p.0),
                person_label_probability: f.cluster_probability,
                person_name: person
                    .as_ref()
                    .map_or(UNKNOWN_PERSON_NAME.to_string(), |p| p.1.clone()),
            }
        })
        .collect();
    Ok(Json(json!({
        "status": true,
        "results": updated,
        "updated": updated,
        "not_updated": [],
    }))
    .into_response())
}

/// `POST /api/deletefaces` `{face_ids}`: soft-delete the requester's faces.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let ids = face_ids(&body)?;
    let rows = write::delete_faces(&state.db, user.id, &ids).await?;
    let deleted: Vec<String> = rows
        .iter()
        .map(|(_, image)| media_url(image.as_deref().unwrap_or("")))
        .collect();
    Ok(Json(json!({
        "status": true,
        "results": deleted,
        "not_deleted": [],
        "deleted": deleted,
    }))
    .into_response())
}
