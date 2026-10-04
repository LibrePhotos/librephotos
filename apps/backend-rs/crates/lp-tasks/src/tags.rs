//! `tags.generate`: tagging-model tags per photo (`processing_jobs.generate_tags`
//! + `PhotoCaption.generate_tag_captions`).

use lp_core::AppState;
use lp_jobs::JobType;
use serde_json::Value;
use uuid::Uuid;

use crate::fanout::{PHOTO_CONCURRENCY, for_each_photo};
use crate::photos::{self, path_str};
use crate::run;
use crate::search_captions;
use crate::things;
use lp_sidecars::SidecarError;

/// `tag_thing_type`: the AlbumThing type a tagging model files its tags under.
pub fn thing_type(tagging_model: &str) -> String {
    format!("{tagging_model}_tag")
}

pub async fn generate(
    state: &AppState,
    user_id: i32,
    full_scan: bool,
    job_id: &str,
) -> anyhow::Result<()> {
    let model = state.settings().tagging_model.clone();
    let since = if full_scan {
        None
    } else {
        run::last_finished_start(&state.db, user_id, JobType::GenerateTags, false).await?
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo p LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id \
         WHERE p.owner_id = $1 \
           AND (pc.photo_id IS NULL OR pc.captions_json IS NULL OR NOT (pc.captions_json ? $2)) \
           AND ($3::boolean IS FALSE OR p.added_on > $4) \
         ORDER BY p.id",
    )
    .bind(user_id)
    .bind(&model)
    .bind(since.is_some())
    .bind(since.flatten())
    .fetch_all(&state.db)
    .await?;
    if !run::start_items(&state.db, job_id, ids.len() as i64).await? {
        return Ok(());
    }
    for_each_photo(state, job_id, ids, PHOTO_CONCURRENCY, |id| async move {
        tag_photo(state, id).await.map_err(|e| e.to_string())
    })
    .await?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum TagError {
    #[error("Photo {hash}: {source}")]
    Sidecar {
        hash: String,
        #[source]
        source: SidecarError,
    },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// `generate_tag_job` for one photo. Only an unreachable or timed-out
/// sidecar is an error; an error status or an unusable reply is logged and
/// the photo skipped, as in Django.
pub async fn tag_photo(state: &AppState, photo_id: Uuid) -> Result<(), TagError> {
    let Some(photo) = photos::load_one(&state.db, photo_id).await? else {
        return Ok(());
    };
    let model = state.settings().tagging_model.clone();
    let existing: Option<Value> = sqlx::query_scalar(
        "WITH ins AS (INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) \
           VALUES ($1, NULL, now(), now()) ON CONFLICT (photo_id) DO NOTHING RETURNING captions_json) \
         SELECT captions_json FROM ins UNION ALL \
         SELECT captions_json FROM api_photo_caption WHERE photo_id = $1 LIMIT 1",
    )
    .bind(photo_id)
    .fetch_one(&state.db)
    .await?;
    if !state.config.features.scene_classification {
        return Ok(());
    }
    let Some(thumb) = photo.thumbnail_path(&state.config.media_root) else {
        return Ok(());
    };
    if existing
        .as_ref()
        .and_then(|cj| cj.get(&model))
        .is_some_and(|v| !v.is_null())
    {
        return Ok(());
    }
    let user_confidence: f64 = sqlx::query_scalar("SELECT confidence FROM api_user WHERE id = $1")
        .bind(photo.owner_id)
        .fetch_one(&state.db)
        .await?;
    let image_path = path_str(&thumb);
    let ml = state.ml();
    // Semantic search on the tagging model: the same run gives the embedding.
    let result = if ml.semantic_shares_tagger() {
        ml.tags()
            .generate_tags_with_embedding(&image_path, user_confidence, &model)
            .await
            .map(|(v, e)| (v, Some(e)))
    } else {
        ml.tags()
            .generate_tags(&image_path, user_confidence, &model)
            .await
            .map(|v| (v, None))
    };
    let (reply, embedding) = match result {
        Ok(v) => v,
        Err(e @ (SidecarError::Status { .. } | SidecarError::Body { .. })) => {
            tracing::warn!(image = %image_path, error = %e, "tag service gave no tags");
            return Ok(());
        }
        Err(source) => {
            return Err(TagError::Sidecar {
                hash: photo.image_hash,
                source,
            });
        }
    };
    let Some(tags) = reply.get("tags").filter(|t| !t.is_null()).cloned() else {
        return Ok(());
    };
    let titles: Vec<String> = tags
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let mut tx = state.db.begin().await?;
    if let Some(e) = embedding {
        let magnitude = lp_ml::preprocess::l2_norm(&e);
        let e: Vec<f64> = e.into_iter().map(f64::from).collect();
        sqlx::query(
            "UPDATE api_photo SET clip_embeddings = $2, clip_embeddings_magnitude = $3, \
               last_modified = now() WHERE id = $1",
        )
        .bind(photo_id)
        .bind(Value::from(e))
        .bind(magnitude)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE api_photo_caption SET captions_json = jsonb_set( \
           CASE WHEN jsonb_typeof(captions_json) = 'object' THEN captions_json ELSE '{}'::jsonb END, \
           ARRAY[$2], $3), updated_at = now() \
         WHERE photo_id = $1",
    )
    .bind(photo_id)
    .bind(&model)
    .bind(&tags)
    .execute(&mut *tx)
    .await?;
    things::replace_thing_memberships(
        &mut tx,
        photo_id,
        photo.owner_id,
        &thing_type(&model),
        &titles,
    )
    .await?;
    search_captions::rebuild(&mut tx, &[photo_id], &model).await?;
    tx.commit().await?;
    tracing::info!(image = %image_path, model = %model, "generated tags");
    Ok(())
}
