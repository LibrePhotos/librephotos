//! Batched inference across concurrent calls (OPTIMIZATIONS.md #17).
//!
//! Callers push their prepared input into a [`BatchQueue`] and try to become
//! its leader ([`BatchQueue::try_lead`]); the one leader drains up to
//! [`Policy::max`] queued inputs per model run until the queue is empty,
//! sending every result to its caller, and the others just wait for theirs
//! (no extra thread, no timer). While one batch runs on the GPU the next
//! callers queue up, so the batch size follows the load. (A first version let
//! every caller take the model slot in turn: callers whose result was already
//! sent still queued for the slot and ran whatever had arrived meanwhile as
//! tiny batches, 3x slower than no batching on DirectML.)
//!
//! [`policy`]: `LP_ML_BATCH` (largest batch; `1` = off). Defaults per
//! provider, measured on a GTX 1660 Ti (MobileCLIP-S2 image tower, ms per
//! image at batch 1 / 4 / 8 / 16 / 32 / 64): DirectML 21 / 49 / 25 / 15 /
//! 11 / 9.2 (small batches are slower than single runs, so batches under 16
//! run one by one), CUDA 20 / - / 9.2 / 9.1 / 8.7 / 8.7, CPU 117 / 114 /
//! - / 149 / 111 / 108 (no gain: batching stays off on the CPU).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tokio::sync::{Semaphore, oneshot};

/// How queued inputs are grouped into model runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// Largest batch (1 = no batching).
    pub max: usize,
    /// Smallest batch worth a batched run; fewer inputs run one by one.
    pub min: usize,
}

impl Policy {
    pub const OFF: Policy = Policy { max: 1, min: 1 };

    pub fn enabled(self) -> bool {
        self.max > 1
    }

    /// The runs for `n` queued inputs: chunks of up to `max`; a chunk
    /// smaller than `min` becomes single runs.
    pub fn plan(self, n: usize) -> Vec<usize> {
        let max = self.max.max(1);
        let mut out = Vec::new();
        let mut left = n;
        while left > 0 {
            let take = left.min(max);
            if take >= self.min.max(2) {
                out.push(take);
            } else {
                out.extend(std::iter::repeat_n(1, take));
            }
            left -= take;
        }
        out
    }

    /// Photos an ML job keeps in flight so batches can fill: `base`
    /// without batching, else at least two batches' worth.
    pub fn in_flight(self, base: usize) -> usize {
        if self.enabled() {
            base.max(2 * self.max)
        } else {
            base
        }
    }
}

/// The policy for the loaded runtime's preferred provider, `LP_ML_BATCH`
/// overriding the largest batch.
pub fn policy() -> Policy {
    static P: OnceLock<Policy> = OnceLock::new();
    *P.get_or_init(|| {
        let (max, min) = match crate::runtime::gpu_provider() {
            Some(crate::runtime::DML) => (32, 16),
            Some(_) => (64, 2),
            None => (1, 1),
        };
        let max = std::env::var("LP_ML_BATCH")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(max);
        Policy {
            max,
            min: min.min(max),
        }
    })
}

/// Blocking preprocessing slots (decode + resize of the next photos), one
/// per hardware thread: with many photos in flight the preparation must
/// not run all at once (memory) nor starve the rest of the process.
pub fn prep_permits() -> &'static Semaphore {
    static S: OnceLock<Semaphore> = OnceLock::new();
    S.get_or_init(|| {
        Semaphore::new(
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4),
        )
    })
}

type Pending<I, O> = (I, oneshot::Sender<Result<O, String>>);

/// Inputs waiting for the next batched model run.
pub struct BatchQueue<I, O> {
    queue: Mutex<VecDeque<Pending<I, O>>>,
    leading: AtomicBool,
}

impl<I, O> Default for BatchQueue<I, O> {
    fn default() -> Self {
        BatchQueue {
            queue: Mutex::new(VecDeque::new()),
            leading: AtomicBool::new(false),
        }
    }
}

/// Held by the one caller that runs the queue; dropping it (also when the
/// leader's future is cancelled) lets the next caller lead.
pub struct Lead<'a>(&'a AtomicBool);

impl Drop for Lead<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl<I, O> BatchQueue<I, O> {
    /// Become the leader unless someone else is. The leader runs batches
    /// while the queue is not empty, drops the [`Lead`], and then checks the
    /// queue once more (and leads again if something arrived in between).
    pub fn try_lead(&self) -> Option<Lead<'_>> {
        self.leading
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Lead(&self.leading))
    }

    /// Queue an input; the receiver gets its result once a batch ran it.
    pub fn push(&self, input: I) -> oneshot::Receiver<Result<O, String>> {
        let (tx, rx) = oneshot::channel();
        self.queue
            .lock()
            .expect("batch queue")
            .push_back((input, tx));
        rx
    }

    /// Up to `max` queued inputs, oldest first.
    pub fn take(&self, max: usize) -> Vec<Pending<I, O>> {
        let mut q = self.queue.lock().expect("batch queue");
        let n = q.len().min(max.max(1));
        q.drain(..n).collect()
    }

    /// Inputs queued now.
    pub fn len(&self) -> usize {
        self.queue.lock().expect("batch queue").len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.lock().expect("batch queue").is_empty()
    }

    /// Fail everything queued (the model could not be loaded).
    pub fn fail_all(&self, error: &str) {
        let drained: Vec<_> = self.queue.lock().expect("batch queue").drain(..).collect();
        for (_, tx) in drained {
            let _ = tx.send(Err(error.to_string()));
        }
    }
}

/// Queue `input` and, unless another caller leads, run rounds of the queue
/// through `round` (one model run of up to a batch: take, run, send) until it
/// is empty; then wait for `input`'s own result. `round` errors fail
/// everything still queued.
pub async fn submit<I, O, F, Fut>(
    queue: &BatchQueue<I, O>,
    input: I,
    mut round: F,
) -> Result<O, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let rx = queue.push(input);
    loop {
        let Some(lead) = queue.try_lead() else {
            break;
        };
        while !queue.is_empty() {
            if let Err(e) = round().await {
                queue.fail_all(&e);
            }
        }
        drop(lead);
        if queue.is_empty() {
            break;
        }
    }
    rx.await.map_err(|e| e.to_string())?
}

/// Run `pending` in the runs [`Policy::plan`] gives through `run`, which
/// gets one group of inputs (a single one for the one-by-one runs) and
/// must return one result per input, in order.
pub fn run_planned<I, O>(
    policy: Policy,
    pending: Vec<Pending<I, O>>,
    mut run: impl FnMut(Vec<I>) -> anyhow::Result<Vec<O>>,
) {
    let mut rest = pending.into_iter();
    for size in policy.plan(rest.len()) {
        let group: Vec<Pending<I, O>> = rest.by_ref().take(size).collect();
        let (inputs, senders): (Vec<I>, Vec<_>) = group.into_iter().unzip();
        match run(inputs) {
            Ok(outs) if outs.len() == senders.len() => {
                for (o, tx) in outs.into_iter().zip(senders) {
                    let _ = tx.send(Ok(o));
                }
            }
            Ok(outs) => {
                let e = format!("batch of {} gave {} results", senders.len(), outs.len());
                for tx in senders {
                    let _ = tx.send(Err(e.clone()));
                }
            }
            Err(e) => {
                let e = format!("{e:#}");
                for tx in senders {
                    let _ = tx.send(Err(e.clone()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans() {
        let dml = Policy { max: 64, min: 16 };
        assert_eq!(dml.plan(0), Vec::<usize>::new());
        assert_eq!(dml.plan(3), vec![1, 1, 1]);
        assert_eq!(dml.plan(16), vec![16]);
        assert_eq!(dml.plan(70), vec![64, 1, 1, 1, 1, 1, 1]);
        assert_eq!(dml.plan(100), vec![64, 36]);
        let cuda = Policy { max: 8, min: 2 };
        assert_eq!(cuda.plan(9), vec![8, 1]);
        assert_eq!(cuda.plan(10), vec![8, 2]);
        assert_eq!(Policy::OFF.plan(3), vec![1, 1, 1]);
        assert_eq!(Policy::OFF.in_flight(4), 4);
        assert_eq!(dml.in_flight(4), 128);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_callers_are_served_in_batches() {
        use std::sync::Arc;
        let q: Arc<BatchQueue<u32, u32>> = Arc::new(BatchQueue::default());
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let policy = Policy { max: 8, min: 2 };
        let mut handles = Vec::new();
        for i in 0..200u32 {
            let (q, sizes) = (q.clone(), sizes.clone());
            handles.push(tokio::spawn(async move {
                let q2 = q.clone();
                submit(&q, i, move || {
                    let (q, sizes) = (q2.clone(), sizes.clone());
                    async move {
                        let pending = q.take(policy.max);
                        tokio::task::spawn_blocking(move || {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                            run_planned(policy, pending, |xs| {
                                sizes.lock().unwrap().push(xs.len());
                                Ok(xs.into_iter().map(|x| x * 2).collect())
                            });
                        })
                        .await
                        .map_err(|e| e.to_string())
                    }
                })
                .await
            }));
        }
        for (i, h) in handles.into_iter().enumerate() {
            assert_eq!(h.await.unwrap(), Ok(i as u32 * 2));
        }
        let sizes = sizes.lock().unwrap();
        assert_eq!(sizes.iter().sum::<usize>(), 200);
        assert!(
            sizes.iter().any(|&n| n > 1),
            "some calls were batched: {sizes:?}"
        );
        assert!(q.is_empty());
    }

    #[test]
    fn planned_runs_answer_everyone_in_order() {
        let q: BatchQueue<u32, u32> = BatchQueue::default();
        let rxs: Vec<_> = (0..5).map(|i| q.push(i)).collect();
        let mut batches = Vec::new();
        run_planned(Policy { max: 4, min: 2 }, q.take(10), |xs| {
            batches.push(xs.len());
            let add = if xs.len() == 1 { 100 } else { 0 };
            Ok(xs.into_iter().map(|x| x * 10 + add).collect())
        });
        assert_eq!(batches, vec![4, 1]);
        let got: Vec<_> = rxs
            .into_iter()
            .map(|mut r| r.try_recv().unwrap().unwrap())
            .collect();
        assert_eq!(got, vec![0, 10, 20, 30, 140]);
        assert!(q.is_empty());
    }
}
