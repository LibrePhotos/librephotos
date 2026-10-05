//! ML inside the scan (round 3 #19, `LP_SCAN_INLINE_ML`): tags, the search
//! embedding and faces of a freshly rendered photo, from the big thumbnail's
//! pixels the scan still holds in memory, instead of the `tags.generate` /
//! `faces.scan` follow-ups decoding the WebP again once the whole scan is done.
//!
//! The ML code lives above this crate (`lp-tasks`), which installs a
//! [`PhotoMlHook`] at start-up ([`install`]). A scan with the hook enabled
//! hands every photo it rendered to [`InlineMl::submit`] after the photo's
//! rows are written; the work runs as its own task (at most
//! [`InlineMl::in_flight`] at once, so GPU batches can fill while the scan
//! renders the next photos), and the scan waits for all of them at the end
//! ([`InlineMl::finish`]) before it queues the follow-ups, which then find
//! nothing left to do for these photos.

use std::sync::{Arc, Mutex, OnceLock};

use futures::future::BoxFuture;
use image::RgbImage;
use lp_core::AppState;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use uuid::Uuid;

/// Where the inline ML's pixels come from (`LP_SCAN_INLINE_ML_SOURCE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The big WebP as written, decoded once (libwebp) for the pHash and the
    /// models: the same pixels the `tags.generate` / `faces.scan` follow-ups
    /// would read from the file (`webp`).
    Webp,
    /// libvips' RGB of the big thumbnail before the WebP encode (`pixels`):
    /// no decode at all, but the models see the image without the Q95 loss.
    Pixels,
}

/// `LP_SCAN_INLINE_ML_SOURCE`: `webp` (default) or `pixels`.
pub fn source() -> Source {
    static S: OnceLock<Source> = OnceLock::new();
    *S.get_or_init(|| {
        match std::env::var("LP_SCAN_INLINE_ML_SOURCE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "pixels" | "rgb" | "memory" => Source::Pixels,
            "" | "webp" => Source::Webp,
            other => {
                tracing::warn!(value = %other, "LP_SCAN_INLINE_ML_SOURCE: expected webp or pixels");
                Source::Webp
            }
        }
    })
}

/// What the scan calls for every photo it rendered.
pub trait PhotoMlHook: Send + Sync {
    /// Inline ML applies to scans right now (features on, in-process models,
    /// `LP_SCAN_INLINE_ML`).
    fn enabled(&self, state: &AppState) -> bool;
    /// Photos in flight a scan allows (enough to fill a batch).
    fn in_flight(&self) -> usize;
    /// Tags + embedding + faces of one photo from its big thumbnail's pixels.
    fn run(
        &self,
        state: AppState,
        photo_id: Uuid,
        big: Arc<RgbImage>,
    ) -> BoxFuture<'static, anyhow::Result<()>>;
}

static HOOK: OnceLock<Arc<dyn PhotoMlHook>> = OnceLock::new();

/// Install the hook (once per process; later calls are ignored).
pub fn install(hook: Arc<dyn PhotoMlHook>) {
    let _ = HOOK.set(hook);
}

/// The inline ML of one scan job.
pub struct InlineMl {
    hook: Arc<dyn PhotoMlHook>,
    permits: Arc<Semaphore>,
    tasks: Mutex<JoinSet<()>>,
    in_flight: usize,
    submitted: std::sync::atomic::AtomicUsize,
}

impl InlineMl {
    /// `Some` when a hook is installed and enabled for this state.
    pub fn for_scan(state: &AppState) -> Option<Arc<InlineMl>> {
        let hook = HOOK.get()?.clone();
        if !hook.enabled(state) {
            return None;
        }
        let in_flight = hook.in_flight().max(1);
        Some(Arc::new(InlineMl {
            hook,
            permits: Arc::new(Semaphore::new(in_flight)),
            tasks: Mutex::new(JoinSet::new()),
            in_flight,
            submitted: std::sync::atomic::AtomicUsize::new(0),
        }))
    }

    pub fn in_flight(&self) -> usize {
        self.in_flight
    }

    /// Photos handed over so far.
    pub fn submitted(&self) -> usize {
        self.submitted.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Start the ML of one photo (waits while `in_flight` photos run).
    pub async fn submit(&self, state: &AppState, photo_id: Uuid, big: RgbImage) {
        let Ok(permit) = self.permits.clone().acquire_owned().await else {
            return;
        };
        self.submitted
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let fut = self.hook.run(state.clone(), photo_id, Arc::new(big));
        let mut tasks = self.tasks.lock().expect("inline tasks");
        // Reap finished tasks so the set does not grow with the library.
        while tasks.try_join_next().is_some() {}
        tasks.spawn(async move {
            let _permit = permit;
            if let Err(e) = fut.await {
                tracing::warn!(photo = %photo_id, error = %format!("{e:#}"), "inline ML failed");
            }
        });
    }

    /// Wait for every submitted photo.
    pub async fn finish(&self) {
        let mut tasks = std::mem::take(&mut *self.tasks.lock().expect("inline tasks"));
        while tasks.join_next().await.is_some() {}
    }
}
