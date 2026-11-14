//! In-process similarity index (port of `image_similarity/`): one flat
//! inner-product index per user, persisted under `MEDIA_ROOT/similarity`.
//!
//! Searches stat the user's file and reload it when it changed, so a
//! separate `worker` process that rebuilds the index is picked up by `serve`.
//! A user without a file has no similar photos
//! (`lp_tasks::clip::rebuild_stale_indices` rebuilds missing or outdated
//! indices from the database when `serve` starts).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

use async_trait::async_trait;
use lp_sidecars::{SidecarError, SimilarityBuild, SimilarityBuildReply, SimilaritySearchReply};
use serde_json::{Value, json};

use super::SimilarityApi;
use super::index::{self, FlatIndex};
use crate::{Backend, MlContext, Service};

/// `n` when the caller gives none (the sidecar's default).
pub const DEFAULT_N: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
}

struct Live {
    index: Arc<FlatIndex>,
    stamp: Stamp,
}

struct Store {
    dir: PathBuf,
    live: RwLock<HashMap<i32, Live>>,
    staging: Mutex<HashMap<i32, FlatIndex>>,
    /// Serializes writers per process (builds, deletes).
    write: tokio::sync::Mutex<()>,
}

fn stamp(path: &std::path::Path) -> Option<Stamp> {
    let m = std::fs::metadata(path).ok()?;
    Some(Stamp {
        len: m.len(),
        modified: m.modified().ok(),
    })
}

impl Store {
    fn path(&self, user_id: i32) -> PathBuf {
        index::path(&self.dir, user_id)
    }

    /// The user's index as on disk now, loading it when new or changed.
    fn current(&self, user_id: i32) -> anyhow::Result<Option<Arc<FlatIndex>>> {
        let path = self.path(user_id);
        let Some(now) = stamp(&path) else {
            self.live.write().expect("similarity").remove(&user_id);
            return Ok(None);
        };
        if let Some(l) = self.live.read().expect("similarity").get(&user_id)
            && l.stamp == now
        {
            return Ok(Some(l.index.clone()));
        }
        let loaded = Arc::new(FlatIndex::read(&path)?);
        tracing::info!(user_id, size = loaded.len(), "loaded the similarity index");
        self.live.write().expect("similarity").insert(
            user_id,
            Live {
                index: loaded.clone(),
                stamp: now,
            },
        );
        Ok(Some(loaded))
    }

    /// Write `index` and make it the live one.
    fn install(&self, user_id: i32, index: FlatIndex) -> anyhow::Result<usize> {
        let path = self.path(user_id);
        index.write(&path)?;
        let size = index.len();
        let now = stamp(&path).ok_or_else(|| anyhow::anyhow!("{} vanished", path.display()))?;
        self.live.write().expect("similarity").insert(
            user_id,
            Live {
                index: Arc::new(index),
                stamp: now,
            },
        );
        Ok(size)
    }

    fn remove(&self, user_id: i32) -> std::io::Result<()> {
        self.live.write().expect("similarity").remove(&user_id);
        self.staging.lock().expect("similarity").remove(&user_id);
        match std::fs::remove_file(self.path(user_id)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}

pub struct InProcess {
    store: Arc<Store>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        InProcess {
            store: Arc::new(Store {
                dir: ctx.media_root().join("similarity"),
                live: RwLock::new(HashMap::new()),
                staging: Mutex::new(HashMap::new()),
                write: tokio::sync::Mutex::new(()),
            }),
        }
    }

    async fn blocking<R: Send + 'static>(
        &self,
        f: impl FnOnce(&Store) -> R + Send + 'static,
    ) -> Result<R, SidecarError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || f(&store))
            .await
            .map_err(|e| crate::failed(Service::Similarity, e.to_string()))
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// No model: the index lives under `ctx.media_root()/similarity`.
    fn ready(&self) -> bool {
        true
    }
}

fn refused(user_id: i32, e: anyhow::Error) -> SidecarError {
    let message = format!("rebuild for user {user_id} abandoned: {e:#}");
    tracing::error!("{message}");
    crate::bad_input(Service::Similarity, message)
}

fn ok(size: usize) -> SimilarityBuildReply {
    SimilarityBuildReply {
        status: Value::Bool(true),
        index_size: Some(size as i64),
        error: None,
    }
}

#[async_trait]
impl SimilarityApi for InProcess {
    async fn build(
        &self,
        page: &SimilarityBuild<'_>,
    ) -> Result<SimilarityBuildReply, SidecarError> {
        let _writer = self.store.write.lock().await;
        let user_id = page.user_id;
        let (begin, commit) = (page.begin, page.commit);
        let hashes = page.image_hashes.to_vec();
        let embeddings = page.image_embeddings.to_vec();

        self.blocking(move |store| {
            let rebuilding = store
                .staging
                .lock()
                .expect("similarity")
                .contains_key(&user_id);
            if !(begin || commit || rebuilding) {
                // Incremental: add to the live index (the sidecar's plain /build/).
                let mut idx = store
                    .current(user_id)
                    .map_err(|e| crate::failed_from(Service::Similarity, e))?
                    .map(|i| (*i).clone());
                if embeddings.is_empty() {
                    return Ok(ok(idx.map_or(0, |i| i.len())));
                }
                let mut next = idx.take().unwrap_or_default();
                next.add(&hashes, &embeddings)
                    .map_err(|e| crate::bad_input(Service::Similarity, format!("{e:#}")))?;
                let size = store
                    .install(user_id, next)
                    .map_err(|e| crate::failed_from(Service::Similarity, e))?;
                return Ok(ok(size));
            }

            let mut staging = store.staging.lock().expect("similarity");
            if begin {
                tracing::info!(user_id, "rebuilding the similarity index");
                staging.insert(user_id, FlatIndex::new());
            }
            let Some(staged) = staging.get_mut(&user_id) else {
                return Err(refused(
                    user_id,
                    anyhow::anyhow!("no rebuild in progress for user {user_id}"),
                ));
            };
            if !embeddings.is_empty()
                && let Err(e) = staged.add(&hashes, &embeddings)
            {
                staging.remove(&user_id);
                return Err(refused(user_id, e));
            }
            if !commit {
                return Ok(ok(staged.len()));
            }
            let done = staging.remove(&user_id).expect("staged index");
            drop(staging);
            let size = store
                .install(user_id, done)
                .map_err(|e| crate::failed_from(Service::Similarity, e))?;
            tracing::info!(user_id, size, "similarity index rebuilt");
            Ok(ok(size))
        })
        .await?
    }

    async fn search(
        &self,
        user_id: i32,
        embedding: &[f32],
        n: Option<usize>,
        threshold: f64,
    ) -> Result<SimilaritySearchReply, SidecarError> {
        let query = embedding.to_vec();
        let n = n.unwrap_or(DEFAULT_N);
        let result = self
            .blocking(move |store| -> anyhow::Result<Vec<String>> {
                match store.current(user_id)? {
                    Some(idx) => idx.search(&query, n, threshold),
                    None => Ok(Vec::new()),
                }
            })
            .await?
            .map_err(|e| {
                tracing::error!(user_id, error = %format!("{e:#}"), "similarity search failed");
                crate::failed_from(Service::Similarity, e)
            })?;
        Ok(SimilaritySearchReply {
            status: Some(true),
            result: result.into_iter().map(Value::String).collect(),
        })
    }

    async fn delete(&self, user_id: i32) -> Result<Value, SidecarError> {
        let _writer = self.store.write.lock().await;
        self.blocking(move |store| store.remove(user_id))
            .await?
            .map_err(|e| crate::failed(Service::Similarity, e.to_string()))?;
        Ok(json!({"status": true}))
    }
}
