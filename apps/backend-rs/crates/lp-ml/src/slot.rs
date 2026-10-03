//! Lazily loaded models with idle unload: what `service/_common.py` gives
//! every sidecar (`last_request_time` stamped when a request starts, `busy`
//! while one runs, `/unload-model` from the watchdog after 120 s idle,
//! refused while busy), for in-process models.
//!
//! A [`ModelSlot<T>`] holds up to `concurrency` loaded instances of `T` (e.g.
//! a struct with the ONNX sessions and tokenizer of one model). A call
//! borrows one instance exclusively (`ort::Session::run` takes `&mut self`),
//! so `concurrency` is both the in-flight limit and the number of copies in
//! memory. The instances are keyed (model dir / model name): a call with
//! another key drops the pool and loads the new model.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::Semaphore;

use crate::Service;

/// Read-only view of a slot for status reporting and the idle reaper.
pub trait SlotInfo: Send + Sync {
    fn service(&self) -> Service;
    fn label(&self) -> &str;
    /// Instances currently in memory (0 = unloaded).
    fn loaded(&self) -> usize;
    fn in_flight(&self) -> usize;
    /// When the last call started.
    fn last_used(&self) -> Option<SystemTime>;
    /// Drop every loaded instance unless a call is running. True when
    /// something was unloaded.
    fn unload(&self) -> bool;
}

/// All slots of a process, for `/api/services` and the reaper.
#[derive(Default)]
pub struct Registry {
    slots: Mutex<Vec<Weak<dyn SlotInfo>>>,
}

impl Registry {
    pub fn register(&self, slot: Weak<dyn SlotInfo>) {
        let mut slots = self.slots.lock().expect("slot registry");
        slots.retain(|s| s.strong_count() > 0);
        slots.push(slot);
    }

    pub fn slots(&self) -> Vec<Arc<dyn SlotInfo>> {
        self.slots
            .lock()
            .expect("slot registry")
            .iter()
            .filter_map(Weak::upgrade)
            .collect()
    }

    pub fn of(&self, service: Service) -> Vec<Arc<dyn SlotInfo>> {
        self.slots()
            .into_iter()
            .filter(|s| s.service() == service)
            .collect()
    }

    /// Unload every slot idle for at least `idle`; returns how many unloaded.
    pub fn unload_idle(&self, idle: Duration) -> usize {
        let now = SystemTime::now();
        let mut n = 0;
        for s in self.slots() {
            if s.loaded() == 0 || s.in_flight() > 0 {
                continue;
            }
            let idle_for = s
                .last_used()
                .and_then(|t| now.duration_since(t).ok())
                .unwrap_or(Duration::MAX);
            if idle_for >= idle && s.unload() {
                tracing::info!(
                    service = s.service().name(),
                    model = s.label(),
                    "idle model unloaded"
                );
                n += 1;
            }
        }
        if n > 0 {
            release_memory();
        }
        n
    }

    /// Unload everything of `service` that is not in use (services "stop").
    pub fn unload_service(&self, service: Service) -> bool {
        let mut any = false;
        for s in self.of(service) {
            any |= s.unload();
        }
        if any {
            release_memory();
        }
        any
    }
}

/// `release_memory()`: hand freed heap pages back to the OS. glibc keeps
/// them mapped otherwise, and the resident size barely drops after an unload.
pub fn release_memory() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        unsafe extern "C" {
            safe fn malloc_trim(pad: usize) -> i32;
        }
        malloc_trim(0);
    }
}

struct Pool<T> {
    key: Option<String>,
    idle: Vec<T>,
    /// Instances alive: idle ones plus the ones borrowed by running calls.
    alive: usize,
}

struct Inner<T> {
    service: Service,
    label: String,
    permits: Arc<Semaphore>,
    pool: Mutex<Pool<T>>,
    in_flight: AtomicUsize,
    /// Unix millis of the last call start; 0 = never.
    last_used_ms: AtomicU64,
}

impl<T: Send + 'static> SlotInfo for Inner<T> {
    fn service(&self) -> Service {
        self.service
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn loaded(&self) -> usize {
        self.pool.lock().expect("model pool").alive
    }
    fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::SeqCst)
    }
    fn last_used(&self) -> Option<SystemTime> {
        match self.last_used_ms.load(Ordering::SeqCst) {
            0 => None,
            ms => Some(UNIX_EPOCH + Duration::from_millis(ms)),
        }
    }
    fn unload(&self) -> bool {
        let mut pool = self.pool.lock().expect("model pool");
        if self.in_flight.load(Ordering::SeqCst) > 0 || pool.idle.is_empty() {
            return false;
        }
        let dropped = std::mem::take(&mut pool.idle);
        pool.alive -= dropped.len();
        pool.key = None;
        drop(pool);
        drop(dropped);
        true
    }
}

/// A lazily loaded, idle-unloaded model shared by all calls of a service.
pub struct ModelSlot<T> {
    inner: Arc<Inner<T>>,
}

impl<T> Clone for ModelSlot<T> {
    fn clone(&self) -> Self {
        ModelSlot {
            inner: self.inner.clone(),
        }
    }
}

struct InFlight<'a>(&'a AtomicUsize);
impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl<T: Send + 'static> ModelSlot<T> {
    /// A slot registered for status and idle unload. `concurrency` >= 1.
    pub fn new(registry: &Registry, service: Service, label: &str, concurrency: usize) -> Self {
        let inner = Arc::new(Inner {
            service,
            label: label.to_string(),
            permits: Arc::new(Semaphore::new(concurrency.max(1))),
            pool: Mutex::new(Pool {
                key: None,
                idle: Vec::new(),
                alive: 0,
            }),
            in_flight: AtomicUsize::new(0),
            last_used_ms: AtomicU64::new(0),
        });
        let weak: Weak<Inner<T>> = Arc::downgrade(&inner);
        registry.register(weak as Weak<dyn SlotInfo>);
        ModelSlot { inner }
    }

    pub fn info(&self) -> &dyn SlotInfo {
        &*self.inner
    }

    /// Run `f` on a loaded instance for `key`, loading one with `load` when
    /// none is idle. Both run on the blocking pool. Waits for a free permit
    /// when `concurrency` calls are already running.
    pub async fn run<R, L, F>(&self, key: &str, load: L, f: F) -> anyhow::Result<R>
    where
        R: Send + 'static,
        L: FnOnce() -> anyhow::Result<T> + Send + 'static,
        F: FnOnce(&mut T) -> anyhow::Result<R> + Send + 'static,
    {
        let permit = self.inner.permits.clone().acquire_owned().await?;
        let inner = self.inner.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            inner.in_flight.fetch_add(1, Ordering::SeqCst);
            let _guard = InFlight(&inner.in_flight);
            inner.last_used_ms.store(now_ms(), Ordering::SeqCst);
            let taken = {
                let mut pool = inner.pool.lock().expect("model pool");
                if pool.key.as_deref() != Some(key.as_str()) {
                    let stale = std::mem::take(&mut pool.idle);
                    pool.alive -= stale.len();
                    pool.key = Some(key.clone());
                }
                let t = pool.idle.pop();
                if t.is_none() {
                    // Reserved before loading so `loaded()` counts it.
                    pool.alive += 1;
                }
                t
            };
            let mut instance = match taken {
                Some(t) => t,
                None => {
                    let started = std::time::Instant::now();
                    match load() {
                        Ok(t) => {
                            tracing::info!(
                                service = inner.service.name(),
                                model = %inner.label,
                                key = %key,
                                secs = started.elapsed().as_secs_f64(),
                                "model loaded"
                            );
                            t
                        }
                        Err(e) => {
                            inner.pool.lock().expect("model pool").alive -= 1;
                            return Err(e);
                        }
                    }
                }
            };
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut instance)));
            let mut pool = inner.pool.lock().expect("model pool");
            match result {
                Ok(r) => {
                    if pool.key.as_deref() == Some(key.as_str()) {
                        pool.idle.push(instance);
                    } else {
                        pool.alive -= 1;
                    }
                    r
                }
                Err(panic) => {
                    // An instance a panic unwound through is not reused.
                    pool.alive -= 1;
                    let msg = panic
                        .downcast_ref::<&str>()
                        .map(|s| s.to_string())
                        .or_else(|| panic.downcast_ref::<String>().cloned())
                        .unwrap_or_else(|| "panic".into());
                    Err(anyhow::anyhow!("{} inference panicked: {msg}", inner.label))
                }
            }
        })
        .await?
    }

    /// Drop the loaded instances unless a call is running.
    pub fn unload(&self) -> bool {
        self.inner.unload()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(1)
        .max(1)
}

/// Background idle reaper: every `period`, unload slots idle for `idle`.
/// Stops when the registry is dropped.
pub fn spawn_reaper(registry: Weak<Registry>, idle: Duration, period: Duration) {
    let spawned = std::thread::Builder::new()
        .name("lp-ml-reaper".into())
        .spawn(move || {
            loop {
                std::thread::sleep(period);
                let Some(reg) = registry.upgrade() else {
                    break;
                };
                reg.unload_idle(idle);
            }
        });
    if let Err(e) = spawned {
        tracing::warn!(error = %e, "could not start the idle model reaper");
    }
}
