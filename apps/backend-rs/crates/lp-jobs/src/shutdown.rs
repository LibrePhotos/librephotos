//! Graceful shutdown as a handler sees it. The worker runs every handler
//! inside [`scope`] with its shutdown token; a long handler checks
//! [`shutting_down`] at its safe points (between scan file groups, between
//! zip entries, ...) and returns [`interrupted`] there. The worker then hands
//! the row back to the queue (not a failed attempt) instead of failing it,
//! so the next start picks the job up again. Handlers still running when
//! the grace period ends are aborted and handed back the same way.

use std::future::Future;

use tokio_util::sync::CancellationToken;

tokio::task_local! {
    static SHUTDOWN: CancellationToken;
}

/// Run `fut` with `token` as the shutdown signal [`shutting_down`] reads.
pub fn scope<F: Future>(token: CancellationToken, fut: F) -> impl Future<Output = F::Output> {
    SHUTDOWN.scope(token, fut)
}

/// True once the worker running this job is shutting down. Only the task
/// the worker spawned sees it (not tasks a handler spawns itself); false
/// outside a worker.
pub fn shutting_down() -> bool {
    SHUTDOWN
        .try_with(CancellationToken::is_cancelled)
        .unwrap_or(false)
}

/// The error a handler returns when it stopped at a safe point because of
/// shutdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Interrupted;

impl std::fmt::Display for Interrupted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("interrupted by shutdown; handed back to the queue")
    }
}

impl std::error::Error for Interrupted {}

pub fn interrupted() -> anyhow::Error {
    anyhow::Error::new(Interrupted)
}

pub fn is_interrupted(e: &anyhow::Error) -> bool {
    e.chain().any(|c| c.is::<Interrupted>())
}

/// Resolves on the first shutdown request the process gets: Ctrl-C, and
/// SIGTERM (Docker, systemd, Kubernetes) on Unix; Ctrl-Break and closing
/// the console window or logging off on Windows.
pub async fn signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "cannot listen for SIGTERM");
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => tracing::info!("Ctrl-C: shutting down"),
            _ = term.recv() => tracing::info!("SIGTERM: shutting down"),
        }
    }
    #[cfg(windows)]
    {
        use tokio::signal::windows;
        let (mut brk, mut close, mut shut) = match (
            windows::ctrl_break(),
            windows::ctrl_close(),
            windows::ctrl_shutdown(),
        ) {
            (Ok(b), Ok(c), Ok(s)) => (b, c, s),
            _ => {
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => tracing::info!("Ctrl-C: shutting down"),
            _ = brk.recv() => tracing::info!("Ctrl-Break: shutting down"),
            _ = close.recv() => tracing::info!("console closed: shutting down"),
            _ = shut.recv() => tracing::info!("system shutdown: shutting down"),
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_inside_the_scope() {
        assert!(!shutting_down());
        let token = CancellationToken::new();
        let t = token.clone();
        scope(token.clone(), async move {
            assert!(!shutting_down());
            t.cancel();
            assert!(shutting_down());
        })
        .await;
        assert!(!shutting_down());
        let e = interrupted().context("scan");
        assert!(is_interrupted(&e));
        assert!(!is_interrupted(&anyhow::anyhow!("other")));
    }
}
