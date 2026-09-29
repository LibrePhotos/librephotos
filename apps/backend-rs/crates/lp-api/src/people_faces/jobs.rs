//! Face jobs and the face scatter plot: `TrainFaceView`, `ScanFacesView`
//! (a GET that starts a job) and `ClusterFaceView`.

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::codecs::FaceEncoding;
use lp_core::{ApiResult, AppState};
use lp_db::people_faces as db;
use lp_jobs::EnqueueOptions;
use lp_jobs::lrj::JobType;
use serde_json::{Value, json};

use super::pca::pca_scores;
use super::{media_url, status_message};

/// `POST /api/trainfaces`: queue `faces.cluster` (owned by `lp-tasks`), which
/// back-fills encodings, clusters, then queues `faces.train`; like Django the
/// returned job id is the clustering job's.
pub async fn train_faces(State(state): State<AppState>, user: AuthUser) -> ApiResult<Response> {
    if !state.config.features.face_cluster {
        return Ok(status_message(
            StatusCode::FORBIDDEN,
            "Face clustering is disabled",
        ));
    }
    let queued = lp_jobs::enqueue(
        &state,
        "faces.cluster",
        json!({"user_id": user.id}),
        EnqueueOptions::tracked(JobType::ClusterAllFaces, user.id),
    )
    .await;
    Ok(match queued {
        Ok(q) => Json(json!({"status": true, "job_id": q.lrj_id})).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to queue face training");
            Json(json!({"status": false})).into_response()
        }
    })
}

/// `GET|POST /api/scanfaces`: queue `faces.scan` (owned by `lp-tasks`).
pub async fn scan_faces(State(state): State<AppState>, user: AuthUser) -> ApiResult<Response> {
    if !state.config.features.face_detection {
        return Ok(status_message(
            StatusCode::FORBIDDEN,
            "Face detection is disabled",
        ));
    }
    let queued = lp_jobs::enqueue(
        &state,
        "faces.scan",
        json!({"user_id": user.id, "full_scan": true}),
        EnqueueOptions::tracked(JobType::ScanFaces, user.id),
    )
    .await;
    Ok(match queued {
        Ok(q) => Json(json!({"status": true, "job_id": q.lrj_id})).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "could not start the face scan");
            status_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not start the face scan.",
            )
        }
    })
}

/// seaborn's "deep" palette, cycled (`api.color_palettes.hex_palette`).
const DEEP_PALETTE: [&str; 10] = [
    "#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3", "#937860", "#da8bc3", "#8c8c8c",
    "#ccb974", "#64b5cd",
];

/// `GET|POST /api/clusterfaces` (`face_classify.cluster_faces`): every
/// encoded face of the requester projected on 3 principal components.
///
/// Faces whose encoding does not decode or has another length than the
/// first one are left out (Django fails the whole request on them).
pub async fn cluster_faces(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let (faces, persons) = tokio::try_join!(
        db::viz_faces(&state.db, user.id),
        db::viz_persons(&state.db, user.id),
    )?;
    let mut rows = Vec::with_capacity(faces.len());
    let mut kept = Vec::with_capacity(faces.len());
    for face in faces {
        let Ok(enc) = FaceEncoding::decode(&face.encoding) else {
            continue;
        };
        if rows
            .first()
            .is_some_and(|f: &Vec<f64>| f.len() != enc.len())
        {
            continue;
        }
        rows.push(enc);
        kept.push(face);
    }
    if kept.is_empty() {
        return Ok(Json(json!({"status": true, "data": []})));
    }
    let scores = state.blocking(move || pca_scores(&rows, 3)).await?;
    let colors: HashMap<i32, &str> = persons
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (*id, DEEP_PALETTE[i % DEEP_PALETTE.len()]))
        .collect();
    let names: HashMap<i32, &str> = persons.iter().map(|(id, n)| (*id, n.as_str())).collect();
    let data: Vec<Value> = kept
        .iter()
        .zip(scores)
        .map(|(face, vis)| {
            let person = face.person_id.filter(|id| names.contains_key(id));
            let person_id = person.unwrap_or(-1);
            json!({
                "person_id": person_id,
                "person_name": person.and_then(|id| names.get(&id).copied()).unwrap_or("unknown"),
                "person_label_is_inferred": person.is_none(),
                "color": colors.get(&person_id).copied().unwrap_or("#000000"),
                "face_url": face.image.as_deref().map(media_url).unwrap_or_default(),
                "value": {"x": vis[0], "y": vis[1], "size": vis[2]},
            })
        })
        .collect();
    Ok(Json(json!({"status": true, "data": data})))
}
