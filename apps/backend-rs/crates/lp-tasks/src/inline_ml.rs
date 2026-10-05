//! ML inside the scan (round 3 #19): the [`lp_ingest::inline::PhotoMlHook`]
//! that tags a freshly rendered photo, stores its search embedding and finds
//! its faces from the big thumbnail's pixels the scan still holds, instead of
//! the `tags.generate` / `faces.scan` follow-ups decoding the WebP again once
//! the scan is over. The follow-ups still run and pick up whatever this
//! missed (videos, RAW previews, failures).
//!
//! `LP_SCAN_INLINE_ML`: `auto` (default: on when ONNX Runtime runs on a GPU,
//! where the scan and the models then overlap), `1`/`on`, `0`/`off`. Needs
//! the in-process tagger and face models and `LP_ML_PIPELINE` on.

use std::sync::Arc;

use futures::future::BoxFuture;
use image::RgbImage;
use lp_core::AppState;
use lp_ml::Service;
use serde_json::Value;
use uuid::Uuid;

use crate::photos::{self, TaskPhoto};
use crate::{faces, tags};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Setting {
    Auto,
    On,
    Off,
}

impl Setting {
    pub fn parse(v: &str) -> Option<Setting> {
        Some(match v.trim().to_ascii_lowercase().as_str() {
            "" | "auto" => Setting::Auto,
            "1" | "on" | "true" | "yes" => Setting::On,
            "0" | "off" | "false" | "no" => Setting::Off,
            _ => return None,
        })
    }

    pub fn from_env() -> Setting {
        static S: std::sync::OnceLock<Setting> = std::sync::OnceLock::new();
        *S.get_or_init(|| {
            let v = std::env::var("LP_SCAN_INLINE_ML").unwrap_or_default();
            Setting::parse(&v).unwrap_or_else(|| {
                tracing::warn!(value = %v, "LP_SCAN_INLINE_ML: expected auto, 1 or 0");
                Setting::Auto
            })
        })
    }
}

/// Photos a scan keeps in its inline ML when nothing batches.
const IN_FLIGHT: usize = 8;

struct Hook;

impl lp_ingest::inline::PhotoMlHook for Hook {
    fn enabled(&self, state: &AppState) -> bool {
        let f = &state.config.features;
        if !(f.scene_classification || f.face_detection) || !lp_ml::pipeline() {
            return false;
        }
        let ml = state.ml();
        if (f.scene_classification && !ml.is_inprocess(Service::Tags))
            || (f.face_detection && !ml.is_inprocess(Service::Face))
        {
            return false;
        }
        match Setting::from_env() {
            Setting::On => true,
            Setting::Off => false,
            // Not yet measured (round 3 #19): opt-in until then.
            Setting::Auto => false,
        }
    }

    fn in_flight(&self) -> usize {
        lp_ml::batch::policy().in_flight(IN_FLIGHT)
    }

    fn run(
        &self,
        state: AppState,
        photo_id: Uuid,
        big: Arc<RgbImage>,
    ) -> BoxFuture<'static, anyhow::Result<()>> {
        Box::pin(async move { run(&state, photo_id, big).await })
    }
}

/// Install the hook (`register_jobs`).
pub fn install() {
    lp_ingest::inline::install(Arc::new(Hook));
}

async fn run(state: &AppState, photo_id: Uuid, big: Arc<RgbImage>) -> anyhow::Result<()> {
    let Some(photo) = photos::load_one(&state.db, photo_id).await? else {
        return Ok(());
    };
    let f = &state.config.features;
    let tagging = async {
        if f.scene_classification {
            tag_from_pixels(state, &photo, big.clone()).await
        } else {
            Ok(())
        }
    };
    let detecting = async {
        if f.face_detection {
            faces::extract_faces_from_pixels(state, &photo, big.clone())
                .await
                .map(|_| ())
                .map_err(anyhow::Error::from)
        } else {
            Ok(())
        }
    };
    let (t, d) = tokio::join!(tagging, detecting);
    t.and(d)
}

/// `tags::tag_photo` on pixels in memory.
async fn tag_from_pixels(
    state: &AppState,
    photo: &TaskPhoto,
    big: Arc<RgbImage>,
) -> anyhow::Result<()> {
    let model = state.settings().tagging_model.clone();
    let existing: Option<Value> = sqlx::query_scalar(
        "WITH ins AS (INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) \
           VALUES ($1, NULL, now(), now()) ON CONFLICT (photo_id) DO NOTHING RETURNING captions_json) \
         SELECT captions_json FROM ins UNION ALL \
         SELECT captions_json FROM api_photo_caption WHERE photo_id = $1 LIMIT 1",
    )
    .bind(photo.id)
    .fetch_one(&state.db)
    .await?;
    if existing
        .as_ref()
        .and_then(|cj| cj.get(&model))
        .is_some_and(|v| !v.is_null())
    {
        return Ok(());
    }
    let (reply, embedding) = state.ml().tags().generate_tags_rgb(big, &model).await?;
    let embedding_model = tags::embedding_model_for(state, &model);
    tags::store_tags(
        state,
        photo.id,
        photo.owner_id,
        &model,
        &reply,
        Some(embedding),
        embedding_model,
    )
    .await?;
    Ok(())
}
