//! `clip.embed` (`batch_jobs.batch_calculate_clip_embedding`) and
//! `similarity.build` (`image_similarity.build_image_similarity_index`).

use std::path::Path;

use lp_core::AppState;
use lp_core::codecs::ClipEmbedding;
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::photos::{media_path, path_str};
use crate::run;

/// Photos per CLIP request (`BATCH_SIZE`).
pub const CLIP_BATCH: i64 = 64;
/// Embeddings per similarity `/build/` request (`INDEX_PAGE_SIZE`).
pub const INDEX_PAGE_SIZE: usize = 5000;

/// `settings.CLIP_ROOT`, the model directory the CLIP sidecar is told to use.
pub fn clip_model_dir(media_root: &Path) -> String {
    path_str(&media_root.join("data_models").join("clip_vit_b32"))
}

#[derive(Debug, FromRow)]
struct Missing {
    id: Uuid,
    image_hash: String,
    thumbnail_big: Option<String>,
}

pub async fn embed(state: &AppState, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo WHERE owner_id = $1 AND clip_embeddings IS NULL",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    let count_i32 = i32::try_from(count).unwrap_or(i32::MAX);
    run::set_progress(&state.db, job_id, 0, count_i32).await?;
    let model = clip_model_dir(&state.config.media_root);

    let mut done: i64 = 0;
    let mut last: Option<Uuid> = None;
    while done < count {
        let batch = sqlx::query_as::<_, Missing>(
            "SELECT p.id, p.image_hash, t.thumbnail_big FROM api_photo p \
             LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
             WHERE p.owner_id = $1 AND p.clip_embeddings IS NULL \
               AND ($2::uuid IS NULL OR p.id > $2) \
             ORDER BY p.id LIMIT $3",
        )
        .bind(user_id)
        .bind(last)
        .bind(CLIP_BATCH)
        .fetch_all(&state.db)
        .await?;
        let Some(tail) = batch.last() else { break };
        // Page past this batch whatever happens to it: a photo that gets no
        // embedding still matches the filter.
        last = Some(tail.id);
        done += batch.len() as i64;
        if let Err(e) = store_batch(state, &model, &batch).await {
            tracing::error!(error = %e, "Error calculating clip embeddings");
        }
        run::set_progress(
            &state.db,
            job_id,
            i32::try_from(done).unwrap_or(i32::MAX),
            count_i32,
        )
        .await?;
    }

    if let Err(e) = build_index(state, user_id).await {
        // The embeddings are stored; only the index is stale.
        tracing::error!(error = %e, "Error building the similarity index");
        run::fail(&state.db, job_id, &e.to_string()).await?;
        return Err(e);
    }
    run::complete(&state.db, job_id).await?;
    Ok(())
}

async fn store_batch(state: &AppState, model: &str, batch: &[Missing]) -> anyhow::Result<()> {
    let valid: Vec<(&Missing, String)> = batch
        .iter()
        .filter_map(|m| {
            let rel = m.thumbnail_big.as_deref().filter(|t| !t.is_empty())?;
            let path = media_path(&state.config.media_root, rel);
            path.exists().then(|| (m, path_str(&path)))
        })
        .collect();
    if valid.is_empty() {
        return Ok(());
    }
    let imgs: Vec<String> = valid.iter().map(|(_, p)| p.clone()).collect();
    let reply = state.ml().clip().image_embeddings(&imgs, model).await?;
    let mut ids = Vec::new();
    let mut embeddings = Vec::new();
    let mut magnitudes = Vec::new();
    for (i, (photo, _)) in valid.iter().enumerate() {
        let Some(Some(emb)) = reply.imgs_emb.get(i) else {
            tracing::warn!(photo = %photo.image_hash, "No CLIP embedding: unreadable thumbnail");
            continue;
        };
        ids.push(photo.id);
        embeddings.push(Value::from(emb.clone()));
        magnitudes.push(reply.magnitudes.get(i).copied().flatten());
    }
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE api_photo p SET clip_embeddings = u.e, clip_embeddings_magnitude = u.m, \
           last_modified = now() \
         FROM unnest($1::uuid[], $2::jsonb[], $3::float8[]) AS u(id, e, m) WHERE p.id = u.id",
    )
    .bind(&ids)
    .bind(&embeddings)
    .bind(&magnitudes)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[derive(Debug, FromRow)]
struct Indexed {
    image_hash: String,
    clip_embeddings: Value,
}

/// Rebuild the user's similarity index: pages of 5000 as one rebuild (the
/// first carries `begin`, the last `commit`; a user without embeddings
/// still sends one empty page so a stale index goes away). Returns its size.
pub async fn build_index(state: &AppState, user_id: i32) -> anyhow::Result<i64> {
    let started = std::time::Instant::now();
    let rows = sqlx::query_as::<_, Indexed>(
        "SELECT image_hash, clip_embeddings FROM api_photo \
         WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL \
         ORDER BY image_hash",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let username: String = sqlx::query_scalar("SELECT username FROM api_user WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    let mut hashes = Vec::with_capacity(rows.len());
    let mut embeddings = Vec::with_capacity(rows.len());
    for r in rows {
        if let Some(e) = ClipEmbedding::decode(&r.clip_embeddings).filter(|e| !e.is_empty()) {
            hashes.push(r.image_hash);
            embeddings.push(e);
        }
    }
    let pages = hashes.len().div_ceil(INDEX_PAGE_SIZE).max(1);
    let mut size = 0;
    for page in 0..pages {
        let lo = (page * INDEX_PAGE_SIZE).min(hashes.len());
        let hi = ((page + 1) * INDEX_PAGE_SIZE).min(hashes.len());
        let where_ = format!(
            "page {} of {pages} of the similarity index of {username}",
            page + 1
        );
        let reply = state
            .ml()
            .similarity()
            .build(&lp_sidecars::SimilarityBuild {
                user_id,
                image_hashes: &hashes[lo..hi],
                image_embeddings: &embeddings[lo..hi],
                begin: page == 0,
                commit: page + 1 == pages,
            })
            .await
            .map_err(|e| anyhow::anyhow!("{where_} failed: {}", e.detail()))?;
        if reply.status != Value::Bool(true) {
            anyhow::bail!(
                "{where_} was refused: {{'status': {}, 'error': {:?}}}",
                reply.status,
                reply.error.unwrap_or_default()
            );
        }
        size = reply.index_size.unwrap_or(0);
    }
    tracing::info!(
        size,
        secs = started.elapsed().as_secs_f64(),
        "built similarity index"
    );
    Ok(size)
}

/// The startup `build_similarity_index` for the in-process index: rebuild
/// every user's index that is missing (e.g. the first start after the
/// Python sidecar, whose `.npz` files it does not read) or holds another
/// number of photos than the database. Returns how many were rebuilt.
pub async fn rebuild_stale_indices(state: &AppState) -> anyhow::Result<usize> {
    if !state.ml().is_inprocess(lp_ml::Service::Similarity) {
        return Ok(0);
    }
    let users: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT u.id, count(p.id) FROM api_user u \
         LEFT JOIN api_photo p ON p.owner_id = u.id AND NOT p.hidden \
           AND p.clip_embeddings IS NOT NULL \
         GROUP BY u.id ORDER BY u.id",
    )
    .fetch_all(&state.db)
    .await?;
    let mut rebuilt = 0;
    for (user_id, n) in users {
        let stale = match lp_ml::similarity::stored_len(&state.config.media_root, user_id) {
            None => n > 0,
            Some(stored) => i64::try_from(stored).ok() != Some(n),
        };
        if !stale {
            continue;
        }
        match build_index(state, user_id).await {
            Ok(_) => rebuilt += 1,
            Err(e) => tracing::error!(user_id, error = %e, "similarity index rebuild failed"),
        }
    }
    Ok(rebuilt)
}
