//! `DELETE /photosedit/delete/` with a JSON body (`DeletePhotos`): remove
//! the requester's trashed photos for good (see
//! `lp_db::write::photo_edits::delete`).

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::State;
use lp_auth::AuthUser;
use lp_core::{ApiJson, ApiResult, AppState};
use lp_db::photo_edits as reads;
use lp_db::write::photo_edits::bulk::Selection;
use lp_db::write::photo_edits::delete as svc;
use serde_json::{Value, json};
use uuid::Uuid;

use super::bulk::object;
use super::selection;

pub(super) async fn delete_photos(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let body = object(body)?;
    let sel = selection(&body, true)?;
    let transcoded = state.config.transcoded_dir();
    let mut tx = state.db.begin().await?;

    match sel {
        Selection::SelectAll {
            params,
            excluded_hashes,
        } => {
            let ids = reads::select_all_ids(
                &mut tx,
                user.id,
                user.favorite_min_rating,
                &params,
                &excluded_hashes,
            )
            .await?;
            let after = svc::remove_photos(&mut tx, &ids, &transcoded).await?;
            tx.commit().await?;
            after.run().await;
            Ok(Json(
                json!({"status": true, "count": ids.len(), "failed_count": 0}),
            ))
        }
        Selection::Hashes(hashes) => {
            let mut seen = HashSet::new();
            let unique: Vec<String> = hashes
                .into_iter()
                .filter(|h| seen.insert(h.clone()))
                .collect();
            let rows = svc::trashed_by_hashes(&mut tx, user.id, &unique).await?;
            let mut by_hash: HashMap<&str, Vec<Uuid>> = HashMap::new();
            for (id, h) in &rows {
                by_hash.entry(h.as_str()).or_default().push(*id);
            }
            let ids: Vec<Uuid> = rows.iter().map(|(id, _)| *id).collect();
            let (deleted, not_deleted): (Vec<String>, Vec<String>) = unique
                .into_iter()
                .partition(|h| by_hash.contains_key(h.as_str()));
            let after = svc::remove_photos(&mut tx, &ids, &transcoded).await?;
            tx.commit().await?;
            after.run().await;
            Ok(Json(json!({
                "status": true,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            })))
        }
    }
}
