//! Job kind -> handler. Each crate contributes handlers through its own
//! `pub fn register_jobs(reg: &mut HandlerRegistry)`; `lp-server` calls
//! them all. Kinds are dotted names (`scan.user`, `zip.build`, ...).

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::Arc;

use futures::future::BoxFuture;
use lp_core::AppState;

use crate::queue::QueuedJob;

/// What a handler gets: the shared state and the claimed row (`payload`,
/// `lrj_id`, attempts, ...).
#[derive(Clone)]
pub struct JobCtx {
    pub state: AppState,
    pub job: QueuedJob,
}

pub type HandlerFn = Arc<dyn Fn(JobCtx) -> BoxFuture<'static, anyhow::Result<()>> + Send + Sync>;

#[derive(Default, Clone)]
pub struct HandlerRegistry {
    handlers: BTreeMap<String, HandlerFn>,
}

impl HandlerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Panics on a duplicate kind, so collisions between areas surface at startup.
    pub fn register<F, Fut>(&mut self, kind: &str, handler: F)
    where
        F: Fn(JobCtx) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        let f: HandlerFn = Arc::new(move |ctx| Box::pin(handler(ctx)));
        if self.handlers.insert(kind.to_string(), f).is_some() {
            panic!("job kind {kind:?} registered twice");
        }
    }

    pub fn get(&self, kind: &str) -> Option<&HandlerFn> {
        self.handlers.get(kind)
    }

    pub fn kinds(&self) -> Vec<String> {
        self.handlers.keys().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.handlers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.handlers.is_empty()
    }
}
