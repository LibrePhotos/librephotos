//! `clip.embed` (`batch_jobs.batch_calculate_clip_embedding`) and
//! `similarity.build` (`image_similarity.build_image_similarity_index`).

use std::path::Path;

use lp_core::AppState;
use lp_core::codecs::ClipEmbedding;
use lp_ml::clip::SemanticModel;
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
    model_dir(media_root, SemanticModel::ClipVitB32)
}

/// The directory of a semantic-search model.
pub fn model_dir(media_root: &Path, model: SemanticModel) -> String {
    path_str(&media_root.join("data_models").join(model.name()))
}

/// The selected semantic-search model's directory.
pub fn selected_model_dir(state: &AppState) -> String {
    model_dir(&state.config.media_root, state.ml().semantic_model())
}

/// The stored model of `api_photo.clip_embeddings` in SQL: the
/// `clip_embeddings_model` column, NULL = Django's ViT-B/32
/// ([`SemanticModel::stored`]). Compared with `SemanticModel::name()`.
const STORED_MODEL_SQL: &str = "coalesce(clip_embeddings_model, 'clip_vit_b32')";

/// Owners of embeddings that the selected semantic-search model did not
/// produce. Nothing is changed: the similarity index skips those
/// embeddings until `clip.embed` replaces them.
pub async fn mismatched_owners(db: &sqlx::PgPool, model: SemanticModel) -> sqlx::Result<Vec<i32>> {
    sqlx::query_scalar(&format!(
        "SELECT DISTINCT owner_id FROM api_photo \
         WHERE clip_embeddings IS NOT NULL AND {STORED_MODEL_SQL} <> $1 ORDER BY owner_id"
    ))
    .bind(model.name())
    .fetch_all(db)
    .await
}

/// Queue `clip.embed` for every owner of embeddings of another model than
/// the selected one (unless one is already waiting for them), which
/// re-embeds those photos in place. Nothing is deleted: until a photo is
/// re-embedded the index just leaves it out, so search keeps working on the
/// photos that are already converted. Runs at startup and after a site
/// settings change; returns the number of users queued.
pub async fn reembed_mismatched(state: &AppState) -> anyhow::Result<usize> {
    let model = state.ml().semantic_model();
    let users = mismatched_owners(&state.db, model).await?;
    let mut queued = 0;
    for &user_id in &users {
        let waiting: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM job_queue WHERE status = 'queued' \
               AND kind = 'clip.embed' AND payload->'user_id' = to_jsonb($1::int))",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        if waiting {
            continue;
        }
        tracing::info!(
            user_id,
            model = model.name(),
            "embeddings of another semantic-search model found; re-embedding them in place"
        );
        queued += 1;
        lp_jobs::enqueue(
            state,
            "clip.embed",
            serde_json::json!({"user_id": user_id}),
            lp_jobs::EnqueueOptions::tracked(lp_jobs::JobType::CalculateClipEmbeddings, user_id),
        )
        .await?;
    }
    Ok(queued)
}

#[derive(Debug, FromRow)]
struct Missing {
    id: Uuid,
    image_hash: String,
    thumbnail_big: Option<String>,
}

/// Index rebuilds while a long `clip.embed` runs: the first after this many
/// photos, then each time as many photos were embedded as the index held at
/// its previous rebuild (so the rebuilds of a run read ~2x the embeddings).
pub const REINDEX_MIN: i64 = 2000;

/// `clip.embed`: embed the user's photos without an embedding of the
/// selected model (none yet, or another model's), or all of them with
/// `full`. Each embedding is replaced in place, never NULLed first. When
/// other-model embeddings are waiting, the index is rebuilt first (without
/// them) and again as the conversion progresses, so search keeps working on
/// every photo already converted.
pub async fn embed(state: &AppState, user_id: i32, full: bool, job_id: &str) -> anyhow::Result<()> {
    let ml = state.ml();
    // One model for the whole run, even if the setting changes meanwhile:
    // every row is tagged with the model that really produced it.
    let model = ml.semantic_model();
    let via_tagger = ml.semantic_shares_tagger();
    let todo = format!(
        "p.owner_id = $1 AND ($2 OR p.clip_embeddings IS NULL OR {STORED_MODEL_SQL} <> $3)"
    );
    let (count, other): (i64, i64) = sqlx::query_as(&format!(
        "SELECT count(*), count(*) FILTER (WHERE clip_embeddings IS NOT NULL \
           AND {STORED_MODEL_SQL} <> $3) FROM api_photo p WHERE {todo}"
    ))
    .bind(user_id)
    .bind(full)
    .bind(model.name())
    .fetch_one(&state.db)
    .await?;
    let count_i32 = i32::try_from(count).unwrap_or(i32::MAX);
    run::set_progress(&state.db, job_id, 0, count_i32).await?;
    if other > 0 {
        // The index may still hold the other model's embeddings (built
        // before the switch): from now on it holds only this model's.
        tracing::info!(
            user_id,
            photos = other,
            model = model.name(),
            "re-embedding photos of another semantic-search model"
        );
        if let Err(e) = build_index(state, user_id).await {
            tracing::error!(error = %e, "Error building the similarity index");
        }
    }

    let mut done: i64 = 0;
    let mut built_at: i64 = 0;
    let mut built_size: i64 = 0;
    let mut last: Option<Uuid> = None;
    while done < count {
        let batch = sqlx::query_as::<_, Missing>(&format!(
            "SELECT p.id, p.image_hash, t.thumbnail_big FROM api_photo p \
             LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
             WHERE {todo} AND ($4::uuid IS NULL OR p.id > $4) \
             ORDER BY p.id LIMIT $5"
        ))
        .bind(user_id)
        .bind(full)
        .bind(model.name())
        .bind(last)
        .bind(CLIP_BATCH)
        .fetch_all(&state.db)
        .await?;
        let Some(tail) = batch.last() else { break };
        // Page past this batch whatever happens to it: a photo that gets no
        // embedding still matches the filter.
        last = Some(tail.id);
        done += batch.len() as i64;
        if let Err(e) = store_batch(state, model, via_tagger, &batch).await {
            tracing::error!(error = %e, "Error calculating clip embeddings");
        }
        run::set_progress(
            &state.db,
            job_id,
            i32::try_from(done).unwrap_or(i32::MAX),
            count_i32,
        )
        .await?;
        if done < count && done - built_at >= built_size.max(REINDEX_MIN) {
            // A long run: make the photos embedded so far searchable.
            match build_index(state, user_id).await {
                Ok(size) => built_size = size,
                Err(e) => tracing::error!(error = %e, "Error building the similarity index"),
            }
            built_at = done;
        }
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

async fn store_batch(
    state: &AppState,
    model: SemanticModel,
    via_tagger: bool,
    batch: &[Missing],
) -> anyhow::Result<()> {
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
    let ml = state.ml();
    let reply = if via_tagger {
        // The tagger's image tower (already loaded for tags.generate): no
        // second copy of the model in the CLIP slot. Sharing means the
        // tagging model is `model`.
        let mut imgs_emb = Vec::with_capacity(imgs.len());
        let mut magnitudes = Vec::with_capacity(imgs.len());
        for img in &imgs {
            match ml.tags().image_embedding(img, model.name()).await {
                Ok(e) => {
                    magnitudes.push(Some(lp_ml::preprocess::l2_norm(&e)));
                    imgs_emb.push(Some(e.into_iter().map(f64::from).collect()));
                }
                Err(e) => {
                    tracing::warn!(path = %img, error = %e, "clip embeddings: skipping unreadable image");
                    magnitudes.push(None);
                    imgs_emb.push(None);
                }
            }
        }
        lp_sidecars::ClipEmbeddings {
            imgs_emb,
            magnitudes,
        }
    } else {
        let dir = model_dir(&state.config.media_root, model);
        ml.clip().image_embeddings(&imgs, &dir).await?
    };
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
           clip_embeddings_model = $4, last_modified = now() \
         FROM unnest($1::uuid[], $2::jsonb[], $3::float8[]) AS u(id, e, m) WHERE p.id = u.id",
    )
    .bind(&ids)
    .bind(&embeddings)
    .bind(&magnitudes)
    .bind(model.name())
    .execute(&state.db)
    .await?;
    Ok(())
}

#[derive(Debug, FromRow)]
struct Indexed {
    id: Uuid,
    image_hash: String,
    clip_embeddings: String,
}

/// One process-wide rebuild at a time: two interleaved paged rebuilds of
/// one user (a `clip.embed` job and the startup check) would mix their
/// pages in the staging index.
static BUILD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// `get_clip_embeddings()` of the jsonb text: the list, or the list in a
/// JSON string; `None` for anything else or an empty list.
fn decode_embedding(text: &str) -> Option<Vec<f32>> {
    let e = match serde_json::from_str::<Vec<f32>>(text) {
        Ok(e) => e,
        Err(_) => ClipEmbedding::decode(&serde_json::from_str(text).ok()?)?,
    };
    (!e.is_empty()).then_some(e)
}

/// Rebuild the user's similarity index: pages of 5000 photos as one rebuild
/// (the first carries `begin`, the last `commit`; a user without embeddings
/// still sends one empty page so a stale index goes away). Each page is
/// read from the database as it is sent, so memory stays at one page of
/// embeddings rather than all of them. Only the selected semantic-search
/// model's embeddings go in: another model's wait for `clip.embed` to
/// replace them. Returns the index size.
pub async fn build_index(state: &AppState, user_id: i32) -> anyhow::Result<i64> {
    build_index_paged(state, user_id, INDEX_PAGE_SIZE).await
}

/// [`build_index`] in pages of `page_size` photos.
pub async fn build_index_paged(
    state: &AppState,
    user_id: i32,
    page_size: usize,
) -> anyhow::Result<i64> {
    let page_size = page_size.max(1);
    let _one_at_a_time = BUILD_LOCK.lock().await;
    let started = std::time::Instant::now();
    let username: String = sqlx::query_scalar("SELECT username FROM api_user WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    let model = state.ml().semantic_model();
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM api_photo \
         WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL \
           AND {STORED_MODEL_SQL} = $2"
    ))
    .bind(user_id)
    .bind(model.name())
    .fetch_one(&state.db)
    .await?;
    let pages = usize::try_from(total)
        .unwrap_or(0)
        .div_ceil(page_size)
        .max(1);
    let mut after: Option<(String, Uuid)> = None;
    let mut size = 0;
    for page in 0..pages {
        let rows = sqlx::query_as::<_, Indexed>(&format!(
            "SELECT id, image_hash, clip_embeddings::text AS clip_embeddings FROM api_photo \
             WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL \
               AND {STORED_MODEL_SQL} = $5 \
               AND ($2::text IS NULL OR (image_hash, id) > ($2, $3)) \
             ORDER BY image_hash, id LIMIT $4"
        ))
        .bind(user_id)
        .bind(after.as_ref().map(|a| a.0.as_str()))
        .bind(after.as_ref().map(|a| a.1))
        .bind(page_size as i64)
        .bind(model.name())
        .fetch_all(&state.db)
        .await?;
        if let Some(last) = rows.last() {
            after = Some((last.image_hash.clone(), last.id));
        }
        let mut hashes = Vec::with_capacity(rows.len());
        let mut embeddings = Vec::with_capacity(rows.len());
        for r in rows {
            if let Some(e) = decode_embedding(&r.clip_embeddings) {
                hashes.push(r.image_hash);
                embeddings.push(e);
            }
        }
        let where_ = format!(
            "page {} of {pages} of the similarity index of {username}",
            page + 1
        );
        let reply = state
            .ml()
            .similarity()
            .build(&lp_sidecars::SimilarityBuild {
                user_id,
                image_hashes: &hashes,
                image_embeddings: &embeddings,
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
        model = model.name(),
        secs = started.elapsed().as_secs_f64(),
        "built similarity index"
    );
    Ok(size)
}

/// The startup `build_similarity_index` for the in-process index: rebuild
/// every user's index that is missing (e.g. the first start after the
/// Python sidecar, whose `.npz` files it does not read) or holds another
/// number of photos than the database has embeddings of the selected
/// model. Returns how many were rebuilt.
pub async fn rebuild_stale_indices(state: &AppState) -> anyhow::Result<usize> {
    if !state.ml().is_inprocess(lp_ml::Service::Similarity) {
        return Ok(0);
    }
    let users: Vec<(i32, i64)> = sqlx::query_as(&format!(
        "SELECT u.id, count(p.id) FROM api_user u \
         LEFT JOIN api_photo p ON p.owner_id = u.id AND NOT p.hidden \
           AND p.clip_embeddings IS NOT NULL AND p.clip_embeddings <> '[]'::jsonb \
           AND {STORED_MODEL_SQL} = $1 \
         GROUP BY u.id ORDER BY u.id"
    ))
    .bind(state.ml().semantic_model().name())
    .fetch_all(&state.db)
    .await?;
    let mut rebuilt = 0;
    for (user_id, n) in users {
        let media_root = state.config.media_root.clone();
        let stored = tokio::task::spawn_blocking(move || {
            lp_ml::similarity::stored_len(&media_root, user_id)
        })
        .await?;
        let stale = match stored {
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
