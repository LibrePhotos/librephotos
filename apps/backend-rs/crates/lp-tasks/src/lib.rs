//! Background follow-ups that call the ML sidecars or external services
//! (04 §3). Job kinds (payloads carry ids only):
//!
//! | kind | payload | Django |
//! | --- | --- | --- |
//! | `faces.scan` | `{user_id, full_scan?}` (`/api/scanfaces` sends `full_scan: true`) | `scan_faces` |
//! | `faces.cluster` | `{user_id}` | `generate_face_embeddings` + `cluster_all_faces` |
//! | `faces.train` | `{user_id}` | `train_faces` |
//! | `tags.generate` | `{user_id, full_scan?}` | `generate_tags` |
//! | `geo.locate` | `{user_id, full_scan?}` | `add_geolocation` |
//! | `clip.embed` | `{user_id}` | `batch_calculate_clip_embedding` |
//! | `similarity.build` | `{user_id}` | `build_image_similarity_index` |
//! | `ocr.generate` | `{user_id, full_scan?}` | `generate_ocr` |
//! | `media.classify` | `{user_id}` | `classify_media` |
//! | `captions.generate` | `{photo_id}` | `generate_captions_im2txt` |
//! | `models.download` | `{user_id}` | `download_models` |
//! | `nextcloud.scan` | `{user_id}` | `nextcloud.directory_watcher.scan_photos` |
//!
//! A job enqueued with `EnqueueOptions::tracked` reports on that
//! LongRunningJob; one enqueued without gets its own, as Django's
//! `get_or_create_job` does. Synchronous entry points for other areas:
//! [`captions::generate_im2txt`] (`/photosedit/generateim2txt`),
//! [`geocode::search_location`] (`/geocode/search`), and the ML services
//! on `state.ml()` (`face_cluster().pca` for `/clusterfaces`,
//! `similarity().search`, `clip().query_embedding`), in-process or sidecar.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod captions;
pub mod clip;
pub mod detect;
pub mod exif;
pub mod faces;
pub mod fanout;
pub mod geocode;
pub mod inline_ml;
pub mod models;
pub mod nextcloud;
pub mod ocr;
pub mod photos;
pub mod run;
pub mod search_captions;
pub mod tags;
pub mod things;

use lp_jobs::{HandlerRegistry, JobCtx, JobType};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct UserPayload {
    user_id: i32,
    #[serde(default)]
    full_scan: Option<bool>,
    /// faces.scan after a scan with inline ML: skip the photos it covered.
    #[serde(default)]
    skip_inline: bool,
}

#[derive(Debug, Deserialize)]
struct PhotoPayload {
    photo_id: Uuid,
}

fn user_payload(ctx: &JobCtx) -> anyhow::Result<UserPayload> {
    serde_json::from_value(ctx.job.payload.clone())
        .map_err(|e| anyhow::anyhow!("{} payload: {e}", ctx.job.kind))
}

/// Run a user job on its LongRunningJob: created when the enqueuer did not
/// make one, failed with the error when the work errors.
async fn tracked<F, Fut>(ctx: &JobCtx, job_type: JobType, work: F) -> anyhow::Result<()>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    let payload = user_payload(ctx)?;
    let db = &ctx.state.db;
    let job_id = run::begin(db, ctx.job.lrj_id.as_deref(), job_type, payload.user_id).await?;
    if let Err(e) = work(job_id.clone()).await {
        tracing::error!(kind = %ctx.job.kind, error = %e, "task failed");
        run::fail(db, &job_id, &e.to_string()).await?;
        return Err(e);
    }
    Ok(())
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    inline_ml::install();
    reg.register(models::KIND, models::download);
    reg.register(nextcloud::KIND, nextcloud::job);
    reg.register("faces.scan", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p = user_payload(&ctx)?;
        let full = p.full_scan.unwrap_or(false);
        let state = ctx.state.clone();
        tracked(&ctx, JobType::ScanFaces, |job_id| async move {
            faces::scan_with(&state, p.user_id, full, p.skip_inline, &job_id).await
        })
        .await
    });
    reg.register("faces.cluster", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p = user_payload(&ctx)?;
        faces::generate_face_embeddings(&ctx.state, p.user_id).await?;
        faces::cluster::cluster_all_faces(&ctx.state, p.user_id, ctx.job.lrj_id.as_deref()).await?;
        Ok(())
    });
    reg.register("faces.train", |ctx: JobCtx| async move {
        let p = user_payload(&ctx)?;
        faces::cluster::train_faces(&ctx.state, p.user_id, ctx.job.lrj_id.as_deref()).await?;
        Ok(())
    });
    reg.register("tags.generate", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p = user_payload(&ctx)?;
        let full = p.full_scan.unwrap_or(false);
        let state = ctx.state.clone();
        tracked(&ctx, JobType::GenerateTags, |job_id| async move {
            tags::generate(&state, p.user_id, full, &job_id).await
        })
        .await
    });
    reg.register("geo.locate", |ctx: JobCtx| async move {
        let p = user_payload(&ctx)?;
        let full = p.full_scan.unwrap_or(false);
        let state = ctx.state.clone();
        tracked(&ctx, JobType::AddGeolocation, |job_id| async move {
            geocode::locate(&state, p.user_id, full, &job_id).await
        })
        .await
    });
    reg.register("clip.embed", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p = user_payload(&ctx)?;
        let db = &ctx.state.db;
        let job_id = run::begin(
            db,
            ctx.job.lrj_id.as_deref(),
            JobType::CalculateClipEmbeddings,
            p.user_id,
        )
        .await?;
        // `embed` fails the job itself when only the index build failed.
        clip::embed(&ctx.state, p.user_id, p.full_scan.unwrap_or(false), &job_id).await
    });
    reg.register("similarity.build", |ctx: JobCtx| async move {
        let p = user_payload(&ctx)?;
        let db = &ctx.state.db;
        match clip::build_index(&ctx.state, p.user_id).await {
            Ok(_) => {
                if let Some(id) = ctx.job.lrj_id.as_deref() {
                    run::complete(db, id).await?;
                }
                Ok(())
            }
            Err(e) => {
                if let Some(id) = ctx.job.lrj_id.as_deref() {
                    run::fail(db, id, &e.to_string()).await?;
                }
                Err(e)
            }
        }
    });
    reg.register("ocr.generate", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p = user_payload(&ctx)?;
        let full = p.full_scan.unwrap_or(false);
        let state = ctx.state.clone();
        tracked(&ctx, JobType::GenerateOcr, |job_id| async move {
            ocr::generate(&state, p.user_id, full, &job_id).await
        })
        .await
    });
    reg.register("media.classify", |ctx: JobCtx| async move {
        let p = user_payload(&ctx)?;
        let state = ctx.state.clone();
        tracked(&ctx, JobType::ClassifyMedia, |job_id| async move {
            ocr::classify_media(&state, p.user_id, &job_id).await
        })
        .await
    });
    reg.register("captions.generate", |ctx: JobCtx| async move {
        models::wait_for_download(&ctx.state).await;
        let p: PhotoPayload = serde_json::from_value(ctx.job.payload.clone())
            .map_err(|e| anyhow::anyhow!("captions.generate payload: {e}"))?;
        let outcome = captions::generate_im2txt(&ctx.state, p.photo_id).await?;
        if let Some(id) = ctx.job.lrj_id.as_deref() {
            if outcome.ok() {
                run::complete(&ctx.state.db, id).await?;
            } else {
                run::fail(&ctx.state.db, id, "Failed to generate caption").await?;
            }
        }
        Ok(())
    });
}
