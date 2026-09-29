//! Postgres job queue, LongRunningJob helpers and the worker (04).
//!
//! Enqueue: `lp_jobs::enqueue(&state, "zip.build", json!({...}), EnqueueOptions::tracked(JobType::DownloadPhotos, user.id))`.
//! Handle: in your crate's `register_jobs`, `reg.register("zip.build", my_handler)`.
//! Cancellation is cooperative: check `ctx.is_cancelled().await` every ~100 items.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod lrj;
pub mod maintenance;
pub mod queue;
pub mod registry;
pub mod schedules;
pub mod services;
pub mod worker;

pub use lrj::{JobErrors, JobType, LongRunningJob, Progress};
pub use queue::{EnqueueOptions, Enqueued, LrjSpec, QueuedJob, enqueue, enqueue_in, wake};
pub use registry::{HandlerRegistry, JobCtx};
pub use worker::{Worker, WorkerTiming};
