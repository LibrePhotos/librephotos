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
    // Batched inference (GPU) needs enough photos in flight to fill a batch,
    // and the batched writes ([`store_tags`]) some photos to batch.
    let in_flight = lp_ml::batch::policy().in_flight(PHOTO_CONCURRENCY.max(TAG_IN_FLIGHT));
    for_each_photo(state, job_id, ids, in_flight, |id| async move {
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
    #[error("storing tags: {0}")]
    Store(String),
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
    // Semantic search on the tagging model: the same run gives the embedding,
    // stored as that model's (the tagger `model` is the one that ran it).
    let embedding_model = embedding_model_for(state, &model);
    let result = if embedding_model.is_some() {
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
    store_tags(
        state,
        photo_id,
        photo.owner_id,
        &model,
        &reply,
        embedding,
        embedding_model,
    )
    .await?;
    tracing::info!(image = %image_path, model = %model, "generated tags");
    Ok(())
}

/// The semantic-search model whose embedding a run of tagger `model` yields
/// (MobileCLIP as both tagger and search model), if any.
pub fn embedding_model_for(state: &AppState, model: &str) -> Option<lp_ml::clip::SemanticModel> {
    let ml = state.ml();
    Some(ml.semantic_model()).filter(|m| ml.semantic_shares_tagger() && m.name() == model)
}

/// Photos the tags job keeps in flight without batched inference.
const TAG_IN_FLIGHT: usize = 16;

/// One photo's tagger result waiting to be written.
pub struct TagWrite {
    photo_id: Uuid,
    owner_id: i32,
    model: String,
    tags: Value,
    titles: Vec<String>,
    embedding: Option<(Vec<f32>, lp_ml::clip::SemanticModel)>,
}

/// `LP_TAG_STORE_BATCH`: photos per tag-store transaction (`1` = one
/// transaction per photo, as before round 3 #18).
fn store_batch() -> usize {
    static N: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *N.get_or_init(|| {
        std::env::var("LP_TAG_STORE_BATCH")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(1)
    })
}

type StoreQueue = lp_ml::batch::BatchQueue<TagWrite, ()>;

/// The write queue of `state`'s database (one per database: a process may
/// serve several, e.g. the tests).
fn store_queue(state: &AppState) -> std::sync::Arc<StoreQueue> {
    static QUEUES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<StoreQueue>>>,
    > = std::sync::OnceLock::new();
    let opts = state.db.connect_options();
    let key = format!(
        "{}:{}/{}",
        opts.get_host(),
        opts.get_port(),
        opts.get_database().unwrap_or_default()
    );
    QUEUES
        .get_or_init(Default::default)
        .lock()
        .expect("tag store queues")
        .entry(key)
        .or_default()
        .clone()
}

/// Store a tagger reply (`{"tags": {...}}`) and, with `embedding_model`, the
/// run's image embedding as that model's search embedding.
///
/// Writes are batched across concurrent callers (round 3 #18): one caller
/// at a time writes everything queued, up to [`store_batch`] photos per
/// transaction, so the tag albums are locked, recounted and given covers
/// once per batch instead of once per photo; the call returns once its
/// photo is committed.
pub async fn store_tags(
    state: &AppState,
    photo_id: Uuid,
    owner_id: i32,
    model: &str,
    reply: &Value,
    embedding: Option<Vec<f32>>,
    embedding_model: Option<lp_ml::clip::SemanticModel>,
) -> Result<(), TagError> {
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
    let write = TagWrite {
        photo_id,
        owner_id,
        model: model.to_string(),
        tags,
        titles,
        embedding: embedding.zip(embedding_model),
    };
    let queue = store_queue(state);
    let q = &*queue;
    lp_ml::batch::submit(q, write, || async move {
        let pending = q.take(store_batch());
        let (writes, senders): (Vec<TagWrite>, Vec<_>) = pending.into_iter().unzip();
        let result = write_batch(state, &writes).await.map_err(|e| e.to_string());
        for tx in senders {
            let _ = tx.send(result.clone());
        }
        Ok(())
    })
    .await
    .map_err(TagError::Store)
}

/// One transaction for `writes` (grouped by owner and model).
async fn write_batch(state: &AppState, writes: &[TagWrite]) -> sqlx::Result<()> {
    let mut tx = state.db.begin().await?;
    // Rows in id order: concurrent writers of the same photos lock alike.
    let mut order: Vec<&TagWrite> = writes.iter().collect();
    order.sort_by_key(|w| w.photo_id);
    let (mut ids, mut embs, mut mags, mut models) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for w in &order {
        if let Some((e, m)) = &w.embedding {
            ids.push(w.photo_id);
            mags.push(lp_ml::preprocess::l2_norm(e));
            embs.push(Value::from(
                e.iter().map(|&x| f64::from(x)).collect::<Vec<f64>>(),
            ));
            models.push(m.name().to_string());
        }
    }
    if !ids.is_empty() {
        sqlx::query(
            "UPDATE api_photo p SET clip_embeddings = u.e, clip_embeddings_magnitude = u.m,                clip_embeddings_model = u.model, last_modified = now()              FROM unnest($1::uuid[], $2::jsonb[], $3::float8[], $4::text[]) AS u(id, e, m, model)              WHERE p.id = u.id",
        )
        .bind(&ids)
        .bind(&embs)
        .bind(&mags)
        .bind(&models)
        .execute(&mut *tx)
        .await?;
    }
    let mut groups: Vec<((i32, &str), Vec<&TagWrite>)> = Vec::new();
    for w in writes {
        let key = (w.owner_id, w.model.as_str());
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, g)) => g.push(w),
            None => groups.push((key, vec![w])),
        }
    }
    for ((owner_id, model), group) in groups {
        let mut sorted = group.clone();
        sorted.sort_by_key(|w| w.photo_id);
        let ids: Vec<Uuid> = sorted.iter().map(|w| w.photo_id).collect();
        let tags: Vec<Value> = sorted.iter().map(|w| w.tags.clone()).collect();
        sqlx::query(
            "UPDATE api_photo_caption c SET captions_json = jsonb_set(                CASE WHEN jsonb_typeof(c.captions_json) = 'object' THEN c.captions_json ELSE '{}'::jsonb END,                ARRAY[$3], u.tags), updated_at = now()              FROM unnest($1::uuid[], $2::jsonb[]) AS u(id, tags) WHERE c.photo_id = u.id",
        )
        .bind(&ids)
        .bind(&tags)
        .bind(model)
        .execute(&mut *tx)
        .await?;
        // Memberships in the order the photos were tagged.
        let photos: Vec<(Uuid, Vec<String>)> = group
            .iter()
            .map(|w| (w.photo_id, w.titles.clone()))
            .collect();
        things::replace_thing_memberships_many(&mut tx, owner_id, &thing_type(model), &photos)
            .await?;
        search_captions::rebuild(&mut tx, &ids, model).await?;
    }
    tx.commit().await
}
